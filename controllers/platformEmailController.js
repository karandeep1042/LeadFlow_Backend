import PlatformEmailTemplate from '../models/PlatformEmailTemplate.js';
import { DEFAULT_PLATFORM_TEMPLATES } from '../utils/defaultPlatformTemplates.js';
import { sendTestPlatformEmail } from '../utils/emailService.js';

/**
 * Ensure default templates exist in DB
 */
export const ensurePlatformTemplatesExist = async () => {
  for (const tpl of DEFAULT_PLATFORM_TEMPLATES) {
    const exists = await PlatformEmailTemplate.findOne({ key: tpl.key });
    if (!exists) {
      await PlatformEmailTemplate.create(tpl);
    }
  }
};

/**
 * 1. Get All Platform Email Templates
 */
export const getPlatformTemplates = async (req, res) => {
  try {
    await ensurePlatformTemplatesExist();
    const templates = await PlatformEmailTemplate.find().sort({ category: 1, key: 1 });
    return res.status(200).json({ success: true, data: { templates } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Get Platform Email Template by Key
 */
export const getPlatformTemplateByKey = async (req, res) => {
  try {
    const { key } = req.params;
    let template = await PlatformEmailTemplate.findOne({ key });
    if (!template) {
      const defaultTpl = DEFAULT_PLATFORM_TEMPLATES.find((t) => t.key === key);
      if (defaultTpl) {
        template = await PlatformEmailTemplate.create(defaultTpl);
      } else {
        return res.status(404).json({ success: false, message: 'Platform template not found' });
      }
    }
    return res.status(200).json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Update Platform Email Template
 */
export const updatePlatformTemplate = async (req, res) => {
  try {
    const { key } = req.params;
    const { subject, body } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ success: false, message: 'Subject and body are required.' });
    }

    let template = await PlatformEmailTemplate.findOne({ key });
    if (!template) {
      const defaultTpl = DEFAULT_PLATFORM_TEMPLATES.find((t) => t.key === key);
      if (!defaultTpl) {
        return res.status(404).json({ success: false, message: 'Platform template not found' });
      }
      template = await PlatformEmailTemplate.create({
        ...defaultTpl,
        subject,
        body,
      });
    } else {
      template.subject = subject;
      template.body = body;
      await template.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Platform email template updated successfully.',
      data: template,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Reset Platform Email Template to Factory Default
 */
export const resetPlatformTemplate = async (req, res) => {
  try {
    const { key } = req.params;
    const defaultTpl = DEFAULT_PLATFORM_TEMPLATES.find((t) => t.key === key);
    if (!defaultTpl) {
      return res.status(404).json({ success: false, message: 'Default template definition not found' });
    }

    const template = await PlatformEmailTemplate.findOneAndUpdate(
      { key },
      {
        subject: defaultTpl.defaultSubject,
        body: defaultTpl.defaultBody,
        name: defaultTpl.name,
        category: defaultTpl.category,
        description: defaultTpl.description,
        availableTags: defaultTpl.availableTags,
        defaultSubject: defaultTpl.defaultSubject,
        defaultBody: defaultTpl.defaultBody,
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Template reset to system default.',
      data: template,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Send Test Preview Email
 */
export const sendTestEmail = async (req, res) => {
  try {
    const { key } = req.params;
    const { targetEmail, subject, body } = req.body;

    const emailToSend = targetEmail || req.user.email;
    if (!emailToSend) {
      return res.status(400).json({ success: false, message: 'Target recipient email required.' });
    }

    const result = await sendTestPlatformEmail({
      to: emailToSend,
      templateKey: key,
      customSubject: subject,
      customBody: body,
    });

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error || 'Failed to dispatch test email.' });
    }

    return res.status(200).json({
      success: true,
      message: `Test preview email successfully dispatched to ${emailToSend}`,
      messageId: result.messageId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
