import EmailTemplate from '../models/EmailTemplate.js';
import StageTrigger from '../models/StageTrigger.js';
import { DEFAULT_STAGE_CONFIGS } from '../utils/defaultAutomations.js';

export const getTemplates = async (req, res) => {
  try {
    const templates = await EmailTemplate.find({ ...req.tenantFilter });
    return res.status(200).json({ success: true, data: { templates } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveTemplate = async (req, res) => {
  try {
    const { name, subject, body, description } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ success: false, message: 'Name, subject, and body are required' });
    }

    const template = await EmailTemplate.create({
      brokerageId: req.user.brokerageId,
      name,
      subject,
      body,
      description: description || '',
    });

    return res.status(201).json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const { name, subject, body, description } = req.body;
    const template = await EmailTemplate.findOneAndUpdate(
      { _id: templateId, ...req.tenantFilter },
      { name, subject, body, description },
      { new: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    return res.status(200).json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTriggers = async (req, res) => {
  try {
    let triggers = await StageTrigger.find({ ...req.tenantFilter }).populate('emailTemplateId');

    // Auto-seed default triggers & templates if empty for this brokerage
    if (triggers.length === 0 && req.user?.brokerageId) {
      for (const config of DEFAULT_STAGE_CONFIGS) {
        const template = await EmailTemplate.create({
          brokerageId: req.user.brokerageId,
          name: config.templateName,
          subject: config.subject,
          body: config.body,
          description: `Automated template for ${config.stageLabel}`,
        });

        await StageTrigger.create({
          brokerageId: req.user.brokerageId,
          stage: config.stage,
          emailTemplateId: template._id,
          taskTitle: config.taskTitle,
          taskPriority: config.taskPriority,
          taskDueHours: config.taskDueHours,
          isActive: true,
        });
      }

      triggers = await StageTrigger.find({ ...req.tenantFilter }).populate('emailTemplateId');
    }

    return res.status(200).json({ success: true, data: { triggers } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTrigger = async (req, res) => {
  try {
    const { stage, emailTemplateId, subject, body, taskTitle, taskDueHours, taskPriority, isActive } = req.body;

    let templateRef = emailTemplateId;
    if (subject && body) {
      if (emailTemplateId) {
        await EmailTemplate.findOneAndUpdate(
          { _id: emailTemplateId, ...req.tenantFilter },
          { subject, body }
        );
      } else {
        const newTemp = await EmailTemplate.create({
          brokerageId: req.user.brokerageId,
          name: `Template for ${stage}`,
          subject,
          body,
        });
        templateRef = newTemp._id;
      }
    }

    const trigger = await StageTrigger.findOneAndUpdate(
      { brokerageId: req.user.brokerageId, stage },
      {
        emailTemplateId: templateRef,
        taskTitle,
        taskDueHours: taskDueHours !== undefined ? taskDueHours : 2,
        taskPriority: taskPriority || 'medium',
        isActive: isActive !== undefined ? isActive : true,
      },
      { upsert: true, new: true }
    ).populate('emailTemplateId');

    return res.status(200).json({ success: true, data: trigger });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleTriggerStatus = async (req, res) => {
  try {
    const { triggerId } = req.params;
    const { isActive } = req.body;
    const trigger = await StageTrigger.findOneAndUpdate(
      { _id: triggerId, ...req.tenantFilter },
      { isActive },
      { new: true }
    ).populate('emailTemplateId');

    if (!trigger) return res.status(404).json({ success: false, message: 'Stage trigger not found' });
    return res.status(200).json({ success: true, data: trigger });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

