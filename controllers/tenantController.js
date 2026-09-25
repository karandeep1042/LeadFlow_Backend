import Brokerage from '../models/Brokerage.js';
import User from '../models/User.js';
import Lead from '../models/Lead.js';
import Document from '../models/Document.js';

export const getTenants = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const tenants = await Brokerage.find(filter).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: { tenants } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTenant = async (req, res) => {
  try {
    const { name, city, subdomain, adminName, adminEmail, adminPassword } = req.body;
    if (!name || !adminEmail || !adminPassword) {
      return res.status(400).json({ success: false, message: 'Brokerage name, admin email, and password required.' });
    }

    const brokerage = await Brokerage.create({
      name,
      city: city || 'Berlin',
      subdomain: subdomain || name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      status: 'active',
    });

    await User.create({
      name: adminName || `${name} Admin`,
      email: adminEmail.toLowerCase().trim(),
      password: adminPassword,
      role: 'brokerage_admin',
      brokerageId: brokerage._id,
      status: 'active',
    });

    return res.status(201).json({ success: true, data: brokerage });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTenantStatus = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const tenant = await Brokerage.findByIdAndUpdate(tenantId, { status }, { new: true });
    return res.status(200).json({ success: true, data: tenant });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTenantMetrics = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const brokerage = await Brokerage.findById(tenantId);
    if (!brokerage) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const totalLeads = await Lead.countDocuments({ brokerageId: tenantId });
    const wonLeads = await Lead.countDocuments({ brokerageId: tenantId, stage: 'Won' });
    const totalDocs = await Document.countDocuments({ brokerageId: tenantId });
    const verifiedDocs = await Document.countDocuments({ brokerageId: tenantId, status: 'verified' });
    const rejectedDocs = await Document.countDocuments({ brokerageId: tenantId, status: 'rejected' });

    return res.status(200).json({
      success: true,
      data: {
        totalLeads,
        wonLeads,
        totalDocs,
        verifiedDocs,
        rejectedDocs,
        metrics: brokerage.metrics,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPlatformOverviewMetrics = async (req, res) => {
  try {
    const totalBrokerages = await Brokerage.countDocuments();
    const activeBrokerages = await Brokerage.countDocuments({ status: 'active' });
    const suspendedBrokerages = await Brokerage.countDocuments({ status: 'suspended' });
    const totalWon = await Lead.countDocuments({ stage: 'Won' });
    const verifiedDocs = await Document.countDocuments({ status: 'verified' });
    const rejectedDocs = await Document.countDocuments({ status: 'rejected' });

    return res.status(200).json({
      success: true,
      data: {
        totalBrokerages,
        activeBrokerages,
        suspendedBrokerages,
        totalMortgagesAcquired: totalWon,
        totalVolumeEur: totalWon * 435000,
        documentAcceptedRate: verifiedDocs + rejectedDocs > 0 ? ((verifiedDocs / (verifiedDocs + rejectedDocs)) * 100).toFixed(1) : 0,
        documentRejectedRate: verifiedDocs + rejectedDocs > 0 ? ((rejectedDocs / (verifiedDocs + rejectedDocs)) * 100).toFixed(1) : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
