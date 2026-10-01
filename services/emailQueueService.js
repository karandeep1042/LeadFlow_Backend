import EmailQueue from '../models/EmailQueue.js';
import { getRawTransporter } from '../utils/emailService.js';

// Exponential backoff delays (30s, 60s, 120s, 300s, 900s)
const BACKOFF_DELAYS = [30 * 1000, 60 * 1000, 120 * 1000, 300 * 1000, 900 * 1000];

let isQueueProcessing = false;
let workerIntervalId = null;

export const enqueueEmail = async ({
  to,
  subject,
  html,
  text = '',
  from = null,
  brokerageId = null,
  templateType = 'general',
  initialError = 'Email provider unavailable',
}) => {
  try {
    if (!to || !subject || !html) return null;
    const normalizedEmail = to.toLowerCase().trim();

    const duplicate = await EmailQueue.findOne({
      to: normalizedEmail,
      subject,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 30 * 1000) },
    });
    if (duplicate) return duplicate;

    const firstRetryAt = new Date(Date.now() + BACKOFF_DELAYS[0]);
    const queueItem = await EmailQueue.create({
      brokerageId,
      to: normalizedEmail,
      subject,
      html,
      text,
      from,
      templateType,
      status: 'pending',
      attempts: 1,
      maxAttempts: 5,
      nextAttemptAt: firstRetryAt,
      lastError: initialError ? String(initialError).slice(0, 500) : 'Transport error',
    });

    console.log(`[Email Queue] Enqueued failed email for "${normalizedEmail}". Next retry at ${firstRetryAt.toLocaleTimeString()}`);
    return queueItem;
  } catch (err) {
    console.error('[Email Queue] Error enqueuing email:', err.message);
    return null;
  }
};

export const processEmailQueue = async (batchSize = 25) => {
  if (isQueueProcessing) return;
  isQueueProcessing = true;

  try {
    await EmailQueue.updateMany(
      { status: 'processing', updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } },
      { $set: { status: 'pending' } }
    );

    const now = new Date();
    const pendingItems = await EmailQueue.find({
      status: 'pending',
      nextAttemptAt: { $lte: now },
    }).sort({ nextAttemptAt: 1 }).limit(batchSize);

    if (pendingItems.length === 0) {
      isQueueProcessing = false;
      return;
    }

    console.log(`[Email Queue Worker] Processing ${pendingItems.length} due email(s)...`);
    const transporter = await getRawTransporter();
    if (!transporter) {
      console.warn('[Email Queue Worker] No SMTP transporter available. Retries paused.');
      isQueueProcessing = false;
      return;
    }

    for (const item of pendingItems) {
      const claimed = await EmailQueue.findOneAndUpdate(
        { _id: item._id, status: 'pending' },
        { status: 'processing' },
        { new: true }
      );
      if (!claimed) continue;

      try {
        const mailOptions = {
          from: claimed.from || process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@leadflow.de',
          to: claimed.to,
          subject: claimed.subject,
          html: claimed.html,
          text: claimed.text || undefined,
        };

        await transporter.sendMail(mailOptions);
        claimed.status = 'sent';
        claimed.sentAt = new Date();
        claimed.lastError = null;
        await claimed.save();

        console.log(`[Email Queue Worker] SUCCESS: Dispatched email to "${claimed.to}" (Subject: "${claimed.subject}") on attempt ${claimed.attempts}.`);
      } catch (sendErr) {
        const newAttempts = (claimed.attempts || 1) + 1;
        const isExhausted = newAttempts >= claimed.maxAttempts;

        if (isExhausted) {
          claimed.status = 'failed';
          claimed.attempts = newAttempts;
          claimed.lastError = `Max retries (${claimed.maxAttempts}) exhausted: ${sendErr.message}`;
          await claimed.save();
          console.warn(`[Email Queue Worker] DLQ: Email to "${claimed.to}" permanently failed after ${newAttempts} attempts.`);
        } else {
          const delayMs = BACKOFF_DELAYS[Math.min(newAttempts - 1, BACKOFF_DELAYS.length - 1)];
          claimed.status = 'pending';
          claimed.attempts = newAttempts;
          claimed.nextAttemptAt = new Date(Date.now() + delayMs);
          claimed.lastError = sendErr.message ? sendErr.message.slice(0, 500) : 'Send failed';
          await claimed.save();
          console.warn(`[Email Queue Worker] Retry ${newAttempts}/${claimed.maxAttempts} failed for "${claimed.to}". Next retry in ${Math.round(delayMs / 1000)}s.`);
        }
      }
    }
  } catch (err) {
    console.error('[Email Queue Worker] Execution error:', err.message);
  } finally {
    isQueueProcessing = false;
  }
};

export const initEmailQueueWorker = (intervalMs = 30000) => {
  if (workerIntervalId) clearInterval(workerIntervalId);
  console.log(`[Email Queue Worker] Initialized background polling every ${Math.round(intervalMs / 1000)}s.`);

  setTimeout(() => {
    processEmailQueue().catch((e) => console.warn('[Email Queue Worker Boot]:', e.message));
  }, 5000);

  workerIntervalId = setInterval(() => {
    processEmailQueue().catch((e) => console.warn('[Email Queue Worker Periodic]:', e.message));
  }, intervalMs);

  return workerIntervalId;
};

export const flushEmailQueue = async () => {
  console.log('[Email Queue Worker] Manual queue flush requested.');
  return processEmailQueue();
};

export const getEmailQueueStats = async ({ limit = 50, status = null } = {}) => {
  try {
    const [pendingCount, processingCount, sentCount, failedCount, totalCount] = await Promise.all([
      EmailQueue.countDocuments({ status: 'pending' }),
      EmailQueue.countDocuments({ status: 'processing' }),
      EmailQueue.countDocuments({ status: 'sent' }),
      EmailQueue.countDocuments({ status: 'failed' }),
      EmailQueue.countDocuments(),
    ]);

    const filter = {};
    if (status && ['pending', 'processing', 'sent', 'failed'].includes(status)) {
      filter.status = status;
    }

    const recentItems = await EmailQueue.find(filter)
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 50)
      .lean();

    return {
      success: true,
      counts: {
        pending: pendingCount,
        processing: processingCount,
        sent: sentCount,
        failed: failedCount,
        total: totalCount,
      },
      items: recentItems,
    };
  } catch (err) {
    console.error('[Email Queue Service] getEmailQueueStats error:', err.message);
    return {
      success: false,
      counts: { pending: 0, processing: 0, sent: 0, failed: 0, total: 0 },
      items: [],
      error: err.message,
    };
  }
};

export const retryFailedEmailJob = async (jobId) => {
  try {
    const job = await EmailQueue.findById(jobId);
    if (!job) {
      return { success: false, message: 'Queue item not found.' };
    }

    job.status = 'pending';
    job.attempts = Math.max(0, (job.attempts || 1) - 1);
    job.nextAttemptAt = new Date();
    job.lastError = 'Manual retry requested';
    await job.save();

    setTimeout(() => {
      processEmailQueue().catch((e) => console.warn('[Email Queue Worker Retry]:', e.message));
    }, 500);

    return { success: true, message: `Email to "${job.to}" queued for immediate retry.`, job };
  } catch (err) {
    console.error('[Email Queue Service] retryFailedEmailJob error:', err.message);
    return { success: false, message: err.message };
  }
};

export const retryAllFailedJobs = async () => {
  try {
    const result = await EmailQueue.updateMany(
      { status: 'failed' },
      {
        $set: {
          status: 'pending',
          nextAttemptAt: new Date(),
          lastError: 'Bulk manual retry requested',
        },
      }
    );

    setTimeout(() => {
      processEmailQueue().catch((e) => console.warn('[Email Queue Worker RetryAll]:', e.message));
    }, 500);

    return {
      success: true,
      message: `Reset ${result.modifiedCount} failed email(s) for retry.`,
      modifiedCount: result.modifiedCount,
    };
  } catch (err) {
    console.error('[Email Queue Service] retryAllFailedJobs error:', err.message);
    return { success: false, message: err.message };
  }
};

export const deleteEmailQueueJob = async (jobId) => {
  try {
    const result = await EmailQueue.findByIdAndDelete(jobId);
    if (!result) {
      return { success: false, message: 'Queue item not found.' };
    }
    return { success: true, message: 'Queue item deleted successfully.' };
  } catch (err) {
    console.error('[Email Queue Service] deleteEmailQueueJob error:', err.message);
    return { success: false, message: err.message };
  }
};
