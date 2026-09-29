import crypto from 'crypto';
import IngestionSource from '../models/IngestionSource.js';
import Lead from '../models/Lead.js';
import Task from '../models/Task.js';
import { emitToBrokerage } from '../utils/socket.js';
import { notifyLeadIngestion } from '../services/notificationService.js';
import cacheService from '../services/cacheService.js';

const invalidateIntegrationCaches = async (brokerageId) => {
  if (!brokerageId) return;
  try {
    await Promise.all([
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'leads', '*')),
      cacheService.del(cacheService.generateKey(brokerageId, 'dash', 'stats')),
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'tasks', '*')),
    ]);
  } catch (err) {
    console.warn('[Cache] Error invalidating integration caches:', err.message);
  }
};

export const getSources = async (req, res) => {
  try {
    const sources = await IngestionSource.find({ ...req.tenantFilter }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: { sources } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createSource = async (req, res) => {
  try {
    const { name, provider, fieldMapping } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Source name is required' });

    const rawKey = `lf_live_${crypto.randomBytes(24).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const source = await IngestionSource.create({
      brokerageId: req.user.brokerageId,
      name: name.trim(),
      provider: provider || 'custom',
      apiKeyPrefix: rawKey.substring(0, 12) + '...',
      apiKeyHash,
      fieldMapping: fieldMapping || {},
      status: 'active',
      totalLeadsIngested: 0,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    return res.status(201).json({
      success: true,
      message: 'Webhook source created successfully',
      data: source,
      rawApiKey: rawKey,
      webhookUrl: `${baseUrl}/api/integrations/webhook/${source._id}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSource = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const { name, provider, fieldMapping, status } = req.body;

    const updates = {};
    if (name) updates.name = name.trim();
    if (provider) updates.provider = provider;
    if (fieldMapping) updates.fieldMapping = fieldMapping;
    if (status) updates.status = status;

    const source = await IngestionSource.findOneAndUpdate(
      { _id: sourceId, ...req.tenantFilter },
      { $set: updates },
      { new: true }
    );

    if (!source) return res.status(404).json({ success: false, message: 'Ingestion source not found' });
    return res.status(200).json({ success: true, message: 'Source updated successfully', data: source });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteSource = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const source = await IngestionSource.findOneAndDelete({ _id: sourceId, ...req.tenantFilter });
    if (!source) return res.status(404).json({ success: false, message: 'Ingestion source not found' });
    return res.status(200).json({ success: true, message: 'Source deleted', data: { sourceId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const testWebhook = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const { dryRun } = req.query;
    const payload = req.body;

    const source = await IngestionSource.findOne({ _id: sourceId, ...req.tenantFilter });
    if (!source) return res.status(404).json({ success: false, message: 'Ingestion source not found' });

    const mapping = source.fieldMapping || {};
    const parsedLead = {
      brokerageId: source.brokerageId,
      sourceId: source._id,
      sourceName: source.name,
      firstName: payload[mapping.firstName] || payload.first_name || payload.firstName || payload.name || 'Unknown',
      lastName: payload[mapping.lastName] || payload.last_name || payload.lastName || '',
      email: (payload[mapping.email] || payload.email || '').toLowerCase().trim(),
      phone: payload[mapping.phone] || payload.phone || payload.phone_number || '',
      loanAmount: Number(payload[mapping.loanAmount] || payload.loan_amount || payload.loanAmount || 0),
      purchasePrice: Number(payload.purchase_price || payload.purchasePrice || 0),
      city: payload.city || 'Berlin',
      visaType: payload.visa_type || payload.visaType || 'EU Blue Card',
      employmentType: payload.employment_type || payload.employmentType || 'Employed',
      monthlyNetIncome: Number(payload.monthly_net_income || payload.monthlyNetIncome || 0),
      notes: payload[mapping.notes] || payload.notes || payload.message || '',
      stage: 'New',
    };

    if (!parsedLead.email) {
      return res.status(400).json({ success: false, message: 'Parsed email is missing in payload' });
    }

    const existing = await Lead.findOne({ brokerageId: source.brokerageId, email: parsedLead.email });
    parsedLead.isDuplicate = Boolean(existing);
    if (existing) {
      parsedLead.duplicateOf = existing._id;
    }

    if (dryRun === 'true' || dryRun === true) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        parsedLead,
        isDuplicate: Boolean(existing),
      });
    }

    const createdLead = await Lead.create(parsedLead);
    source.lastPayloadReceivedAt = new Date();
    source.totalLeadsIngested += 1;
    await source.save();

    await Task.create({
      brokerageId: source.brokerageId,
      leadId: createdLead._id,
      title: `Initial reachout for inbound lead: ${createdLead.firstName} ${createdLead.lastName}`,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      priority: 'high',
      stage: 'New',
      isAutoGenerated: true,
      status: 'pending',
    }).catch(() => null);

    const populated = await Lead.findById(createdLead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    emitToBrokerage(source.brokerageId, 'lead:created', populated);

    notifyLeadIngestion({ brokerageId: source.brokerageId, lead: populated });

    await invalidateIntegrationCaches(source.brokerageId);

    return res.status(200).json({
      success: true,
      dryRun: false,
      lead: populated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateSourceStatus = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const { status } = req.body;
    const source = await IngestionSource.findOneAndUpdate(
      { _id: sourceId, ...req.tenantFilter },
      { status },
      { new: true }
    );
    return res.status(200).json({ success: true, data: source });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const handleInboundWebhook = async (req, res) => {
  try {
    const { sourceId } = req.params;
    const payload = req.body;

    const source = await IngestionSource.findById(sourceId);
    if (!source) return res.status(404).json({ success: false, message: 'Webhook endpoint not found' });
    if (source.status === 'inactive') return res.status(403).json({ success: false, message: 'Webhook ingestion source is inactive' });

    const mapping = source.fieldMapping || {};
    const parsedLead = {
      brokerageId: source.brokerageId,
      sourceId: source._id,
      sourceName: source.name,
      firstName: payload[mapping.firstName] || payload.first_name || payload.firstName || payload.name || 'Unknown',
      lastName: payload[mapping.lastName] || payload.last_name || payload.lastName || '',
      email: (payload[mapping.email] || payload.email || '').toLowerCase().trim(),
      phone: payload[mapping.phone] || payload.phone || payload.phone_number || '',
      loanAmount: Number(payload[mapping.loanAmount] || payload.loan_amount || payload.loanAmount || 0),
      purchasePrice: Number(payload.purchase_price || payload.purchasePrice || 0),
      city: payload.city || 'Berlin',
      visaType: payload.visa_type || payload.visaType || 'EU Blue Card',
      employmentType: payload.employment_type || payload.employmentType || 'Employed',
      monthlyNetIncome: Number(payload.monthly_net_income || payload.monthlyNetIncome || 0),
      notes: payload[mapping.notes] || payload.notes || payload.message || '',
      stage: 'New',
    };

    if (!parsedLead.email) {
      return res.status(400).json({ success: false, message: 'Email is required in webhook payload' });
    }

    const existing = await Lead.findOne({ brokerageId: source.brokerageId, email: parsedLead.email });
    if (existing) {
      parsedLead.isDuplicate = true;
      parsedLead.duplicateOf = existing._id;
    }

    const createdLead = await Lead.create(parsedLead);
    source.lastPayloadReceivedAt = new Date();
    source.totalLeadsIngested += 1;
    await source.save();

    await Task.create({
      brokerageId: source.brokerageId,
      leadId: createdLead._id,
      title: `Contact inbound lead: ${createdLead.firstName} ${createdLead.lastName}`,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      priority: 'high',
      stage: 'New',
      isAutoGenerated: true,
      status: 'pending',
    }).catch(() => null);

    const populated = await Lead.findById(createdLead._id)
      .populate('assignedAdvisorId', 'name email phone role')
      .populate('clientId', 'name email phone role status')
      .populate('duplicateOf', 'firstName lastName email stage');

    emitToBrokerage(source.brokerageId, 'lead:created', populated);

    notifyLeadIngestion({ brokerageId: source.brokerageId, lead: populated });

    await invalidateIntegrationCaches(source.brokerageId);

    return res.status(201).json({
      success: true,
      message: 'Inbound lead received and processed successfully',
      leadId: createdLead._id,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
