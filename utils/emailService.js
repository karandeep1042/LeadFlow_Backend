import nodemailer from 'nodemailer';

let transporterPromise = null;

const getTransporter = async () => {
  if (transporterPromise) return transporterPromise;

  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = (process.env.EMAIL_PASS || process.env.SMTP_PASS || '').replace(/\s+/g, '');

  if (emailUser && emailPass) {
    console.log(`[Email Service] Initializing live Gmail/SMTP transporter for: ${emailUser}`);
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      })
    );
  } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    );
  } else {
    transporterPromise = nodemailer.createTestAccount().then((testAccount) => {
      console.log('Created Ethereal test mail account:', testAccount.user);
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }).catch((err) => {
      console.warn('Ethereal fallback:', err.message);
      return nodemailer.createTransport({ jsonTransport: true });
    });
  }

  return transporterPromise;
};

/**
 * Sends an email invitation to a newly invited Mortgage Advisor
 */
export const sendAdvisorInvitationEmail = async ({
  to,
  name,
  inviterName = 'Brokerage Administrator',
  brokerageName = 'LeadFlow Brokerage',
  inviteLink,
  temporaryPassword,
}) => {
  try {
    const transporter = await getTransporter();
    const loginUrl = inviteLink || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/signin`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
          <div style="background: #0f172a; padding: 28px 24px; text-align: center; color: #ffffff;">
            <h2 style="margin: 0 0 6px 0; font-size: 20px;">Welcome to ${brokerageName}</h2>
            <p style="margin: 0; font-size: 13px; color: #94a3b8;">LeadFlow German Mortgage Operating System</p>
          </div>
          <div style="padding: 28px 24px;">
            <p style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 0;">Hello ${name},</p>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              You have been invited by <strong>${inviterName}</strong> to join the <strong>${brokerageName}</strong> team on LeadFlow as a licensed Mortgage Advisor.
            </p>
            <div style="background-color: #f1f5f9; border-left: 4px solid #2563eb; border-radius: 6px; padding: 14px 18px; margin: 20px 0;">
              <div style="margin-bottom: 6px; font-size: 13px;"><span style="color: #64748b;">Login Email:</span> <strong>${to}</strong></div>
              <div style="font-size: 13px;"><span style="color: #64748b;">Temporary Password:</span> <strong style="color: #2563eb;">${temporaryPassword}</strong></div>
            </div>
            <div style="text-align: center; margin: 28px 0 20px 0;">
              <a href="${loginUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">
                Sign In to Workspace
              </a>
            </div>
            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin-bottom: 0;">
              Please change your temporary password immediately upon your first sign in.
            </p>
          </div>
          <div style="background-color: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
            &copy; ${new Date().getFullYear()} LeadFlow SaaS &bull; German Mortgage Platform
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"${brokerageName} via LeadFlow" <${process.env.EMAIL_FROM || 'no-reply@leadflow.de'}>`,
      to,
      subject: `Invitation to join ${brokerageName} on LeadFlow`,
      text: `Hello ${name},\n\nYou have been invited by ${inviterName} to join ${brokerageName} on LeadFlow.\n\nYour login details:\nEmail: ${to}\nTemporary Password: ${temporaryPassword}\nLogin URL: ${loginUrl}\n\nPlease sign in and update your password.`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Advisor invitation sent to ${to}. Preview URL: ${previewUrl}`);
    } else {
      console.log(`[Email Sent] Advisor invitation sent to ${to}. Message ID: ${info.messageId}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
    };
  } catch (error) {
    console.error('[Email Service Error]', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

export const sendLeadAdvisorAssignedEmail = async ({
  lead,
  advisor,
  brokerageName = 'LeadFlow Brokerage',
  previousAdvisor = null,
}) => {
  try {
    const transporter = await getTransporter();
    const portalUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
    const borrowerName = `${lead.firstName || 'Valued'} ${lead.lastName || 'Client'}`.trim();
    const advisorName = advisor.name || 'Your Mortgage Specialist';
    const advisorEmail = advisor.email || '';
    const advisorPhone = advisor.phone || '+49 30 1234567';

    const stageDescriptions = {
      New: { label: 'Stage 01: Lead Ingestion & Qualification', desc: 'Your advisor will evaluate your purchase plans and get in touch shortly.' },
      Contacted: { label: 'Stage 02: Initial Consultation & Budget', desc: 'Your advisor is preparing your borrowing capacity calculation and bank options.' },
      'Document Collection': { label: 'Stage 03: Document Collection & Audit', desc: 'Your advisor is managing your German mortgage document checklist.' },
      'Bank Submission': { label: 'Stage 04: Bank Submission', desc: 'Your mortgage dossier is submitted to German partner banks. We are tracking approvals.' },
      Won: { label: 'Stage 05: Loan Approval & Offer', desc: 'Congratulations! Your loan offer is approved. Your advisor will guide your notary steps.' },
      Lost: { label: 'Stage 06: Notary Appointment & Closing', desc: 'Your advisor is assisting with final closing coordination and registration.' },
    };

    const stageInfo = stageDescriptions[lead.stage] || {
      label: `Stage: ${lead.stage}`,
      desc: 'Your assigned mortgage advisor is guiding your application forward.',
    };

    const isReassigned = Boolean(previousAdvisor && String(previousAdvisor._id || previousAdvisor.id) !== String(advisor._id || advisor.id));

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
          <div style="background: #0f172a; padding: 24px; text-align: center; color: #ffffff;">
            <div style="font-size: 11px; text-transform: uppercase; color: #60a5fa; font-weight: 700; margin-bottom: 4px;">${brokerageName} &bull; Expat Mortgage Desk</div>
            <h2 style="margin: 0; font-size: 20px; color: #ffffff;">${isReassigned ? 'Your Mortgage Advisor Has Been Updated' : 'Meet Your Dedicated Mortgage Advisor'}</h2>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 0;">Dear ${borrowerName},</p>
            <p style="font-size: 14px; line-height: 1.6; color: #475569;">
              ${isReassigned ? `We have updated your primary advisor at <strong>${brokerageName}</strong> to <strong>${advisorName}</strong>.` : `We are pleased to introduce your dedicated Mortgage Advisor at <strong>${brokerageName}</strong>.`}
            </p>
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
              <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Your Mortgage Specialist</div>
              <div style="font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">${advisorName}</div>
              <div style="font-size: 13px; color: #475569;">
                <div><strong>Email:</strong> <a href="mailto:${advisorEmail}" style="color: #2563eb;">${advisorEmail}</a></div>
                <div><strong>Phone:</strong> ${advisorPhone}</div>
              </div>
            </div>
            <div style="background-color: #eff6ff; border-left: 4px solid #2563eb; border-radius: 6px; padding: 12px 14px; margin: 16px 0;">
              <div style="font-size: 11px; font-weight: 800; color: #1e40af; text-transform: uppercase;">Current Stage: ${stageInfo.label}</div>
              <p style="font-size: 13px; color: #1e3a8a; margin: 4px 0 0 0;">${stageInfo.desc}</p>
            </div>
            <div style="text-align: center; margin: 20px 0 12px 0;">
              <a href="${portalUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block;">Access Client Portal &rarr;</a>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 12px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
            &copy; ${new Date().getFullYear()} ${brokerageName} &bull; LeadFlow Mortgage Platform
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"${brokerageName}" <${process.env.EMAIL_FROM || 'no-reply@leadflow.de'}>`,
      to: lead.email,
      subject: `Your Mortgage Advisor: ${advisorName} [${stageInfo.label}]`,
      text: `Hello ${borrowerName},\n\nYour mortgage application at ${brokerageName} is assigned to Mortgage Advisor: ${advisorName}.\nEmail: ${advisorEmail}\nPhone: ${advisorPhone}\nCurrent Stage: ${stageInfo.label}\n\nClient Portal: ${portalUrl}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Advisor notification sent to ${lead.email}. Preview: ${previewUrl}`);
    }
    return { success: true, messageId: info.messageId, previewUrl: previewUrl || null };
  } catch (error) {
    console.error('[Advisor Assignment Email Error]', error);
    return { success: false, error: error.message };
  }
};
