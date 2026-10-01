import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import Brokerage from '../models/Brokerage.js';
import User from '../models/User.js';
import Lead from '../models/Lead.js';
import Document from '../models/Document.js';
import EmailTemplate from '../models/EmailTemplate.js';
import StageTrigger from '../models/StageTrigger.js';
import { DEFAULT_STAGE_CONFIGS, DEFAULT_ACCOUNT_TEMPLATES } from '../utils/defaultAutomations.js';
import { seedDefaultIngestionSources } from '../utils/defaultIngestionSources.js';
import {
  sendBrokerageWelcomeEmail,
  sendBrokerageSuspendedEmail,
  sendBrokerageReactivatedEmail,
} from '../utils/emailService.js';
import { emitToBrokerage, emitToPlatformAdmins } from '../utils/socket.js';
import { validatePasswordStrength } from './authController.js';
import { notifyBrokerageRegistered } from '../services/notificationService.js';
import cacheService from '../services/cacheService.js';

/**
 * 1. Get All Tenants with Enhanced Metrics and Filters
 */
export const getTenants = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      filter.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const matchingAdmins = await User.find({
        role: 'brokerage_admin',
        $or: [{ name: regex }, { email: regex }],
      }).select('brokerageId');
      const adminBrokerageIds = matchingAdmins.map((u) => u.brokerageId).filter(Boolean);

      filter.$or = [
        { name: regex },
        { city: regex },
        { _id: { $in: adminBrokerageIds } },
      ];
    }

    const brokerages = await Brokerage.find(filter)
      .populate('primaryAdminId', 'name email phone status createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const enhancedTenants = await Promise.all(
      brokerages.map(async (tenant) => {
        let admin = tenant.primaryAdminId;
        if (!admin) {
          admin = await User.findOne({
            brokerageId: tenant._id,
            role: 'brokerage_admin',
          })
            .select('name email phone status createdAt')
            .lean();
        }

        const [advisorsCount, clientsCount, totalLeads, wonLeads, totalDocs, verifiedDocs, rejectedDocs] =
          await Promise.all([
            User.countDocuments({ brokerageId: tenant._id, role: 'advisor' }),
            User.countDocuments({ brokerageId: tenant._id, role: 'client' }),
            Lead.countDocuments({ brokerageId: tenant._id }),
            Lead.countDocuments({ brokerageId: tenant._id, stage: 'Won' }),
            Document.countDocuments({ brokerageId: tenant._id }),
            Document.countDocuments({ brokerageId: tenant._id, status: 'verified' }),
            Document.countDocuments({ brokerageId: tenant._id, status: 'rejected' }),
          ]);

        return {
          ...tenant,
          id: tenant._id,
          adminContact: admin || {
            name: 'Unassigned Admin',
            email: `admin@${tenant.subdomain || 'brokerage'}.de`,
            phone: tenant.phone || '',
          },
          stats: {
            advisorsCount,
            clientsCount,
            totalLeads,
            wonLeads,
            totalDocs,
            verifiedDocs,
            rejectedDocs,
            wonVolumeEur: wonLeads * 450000,
          },
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: { tenants: enhancedTenants },
    });
  } catch (error) {
    console.error('getTenants error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Create New Brokerage Tenant (Auto-verified Admin & Template Seeding)
 */
export const createTenant = async (req, res) => {
  try {
    const { name, city, phone, subdomain, adminName, adminEmail, adminPassword } = req.body;

    if (!name || !adminName || !adminEmail || !adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'Brokerage name, admin contact name, email, and password are required.',
      });
    }

    const passwordValidation = validatePasswordStrength(adminPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user account with this admin email already exists.',
      });
    }

    const slug = subdomain
      ? subdomain.toLowerCase().trim().replace(/[^a-z0-9-]/g, '')
      : name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const brokerage = await Brokerage.create({
      name: name.trim(),
      city: city || 'Berlin',
      phone: phone || '',
      subdomain: slug,
      status: 'active',
    });

    const adminUser = await User.create({
      name: adminName.trim(),
      email: normalizedEmail,
      password: adminPassword,
      role: 'brokerage_admin',
      brokerageId: brokerage._id,
      memberships: [
        {
          brokerageId: brokerage._id,
          role: 'brokerage_admin',
          status: 'active',
          joinedAt: new Date(),
        },
      ],
      phone: phone || '',
      status: 'active',
      mustChangePassword: true,
      isTemporaryPassword: true,
    });

    brokerage.primaryAdminId = adminUser._id;
    await brokerage.save();

    // Automatically seed default email templates for this new brokerage
    for (const tpl of DEFAULT_ACCOUNT_TEMPLATES) {
      const exists = await EmailTemplate.findOne({ brokerageId: brokerage._id, name: tpl.name });
      if (!exists) {
        await EmailTemplate.create({
          brokerageId: brokerage._id,
          name: tpl.name,
          subject: tpl.subject,
          body: tpl.body,
          description: tpl.description || '',
        });
      }
    }

    // Automatically seed default stage triggers for this new brokerage
    for (const cfg of DEFAULT_STAGE_CONFIGS) {
      const exists = await StageTrigger.findOne({ brokerageId: brokerage._id, stage: cfg.stage });
      if (!exists) {
        let tpl = await EmailTemplate.findOne({ brokerageId: brokerage._id, name: cfg.templateName });
        if (!tpl) {
          tpl = await EmailTemplate.create({
            brokerageId: brokerage._id,
            name: cfg.templateName,
            subject: cfg.subject,
            body: cfg.body,
            description: `Automated trigger template for stage: ${cfg.stage}`,
          });
        }
        await StageTrigger.create({
          brokerageId: brokerage._id,
          stage: cfg.stage,
          stageLabel: cfg.stageLabel,
          isActive: true,
          emailTemplateId: tpl._id,
          autoTaskEnabled: true,
          defaultTaskTitle: cfg.taskTitle,
          defaultTaskPriority: cfg.taskPriority,
          defaultTaskDueHours: cfg.taskDueHours,
        });
      }
    }

    // Automatically seed default webhook ingestion sources
    await seedDefaultIngestionSources(brokerage._id);

    // Dispatch Platform Welcome Email
    sendBrokerageWelcomeEmail({
      to: adminUser.email,
      adminName: adminUser.name,
      brokerageName: brokerage.name,
      temporaryPassword: adminPassword,
      loginUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
    }).catch((err) => console.warn('Brokerage welcome email dispatch error:', err.message));

    const responsePayload = {
      ...brokerage.toObject(),
      id: brokerage._id,
      adminContact: {
        name: adminUser.name,
        email: adminUser.email,
        phone: adminUser.phone,
        status: adminUser.status,
      },
      stats: {
        advisorsCount: 0,
        clientsCount: 0,
        totalLeads: 0,
        wonLeads: 0,
        totalDocs: 0,
        verifiedDocs: 0,
        rejectedDocs: 0,
        wonVolumeEur: 0,
      },
    };

    emitToPlatformAdmins('tenant:created', responsePayload);
    notifyBrokerageRegistered({ brokerage, adminUser });

    return res.status(201).json({
      success: true,
      message: 'Brokerage organization provisioned successfully.',
      data: responsePayload,
    });
  } catch (error) {
    console.error('createTenant error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. Update Tenant Status (Suspend / Reactivate with Real-time Socket & Platform Email)
 */
export const updateTenantStatus = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { status, reason } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be "active" or "suspended".' });
    }

    const brokerage = await Brokerage.findById(tenantId);
    if (!brokerage) {
      return res.status(404).json({ success: false, message: 'Brokerage tenant not found' });
    }

    brokerage.status = status;
    if (status === 'suspended') {
      brokerage.banReason = reason || 'Subscription compliance review and security suspension.';
      brokerage.suspendedAt = new Date();
    } else {
      brokerage.banReason = '';
      brokerage.suspendedAt = null;
    }
    await brokerage.save();

    // Look up primary admin user to send email notice
    const adminUser = await User.findOne({ brokerageId: tenantId, role: 'brokerage_admin' });
    if (adminUser) {
      if (status === 'suspended') {
        sendBrokerageSuspendedEmail({
          to: adminUser.email,
          adminName: adminUser.name,
          brokerageName: brokerage.name,
          banReason: brokerage.banReason,
        }).catch((err) => console.warn('Brokerage ban email error:', err.message));
      } else {
        sendBrokerageReactivatedEmail({
          to: adminUser.email,
          adminName: adminUser.name,
          brokerageName: brokerage.name,
          loginUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
        }).catch((err) => console.warn('Brokerage reactivated email error:', err.message));
      }
    }

    // Emit Real-time Socket status event to tenant room and platform admins
    emitToBrokerage(tenantId, 'brokerage:status_changed', {
      brokerageId: tenantId,
      status,
      banReason: brokerage.banReason,
    });
    emitToPlatformAdmins('tenant:status_changed', {
      tenantId,
      status,
      banReason: brokerage.banReason,
    });

    // Invalidate tenant dashboard cache
    await Promise.all([
      cacheService.del(cacheService.generateKey(tenantId, 'dash', 'stats')),
      cacheService.del(cacheService.generateKey(tenantId, 'tenant', 'metrics')),
    ]).catch(() => {});

    return res.status(200).json({
      success: true,
      message: `Brokerage has been ${status === 'suspended' ? 'suspended' : 'reactivated'} successfully.`,
      data: brokerage,
    });
  } catch (error) {
    console.error('updateTenantStatus error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. Update Tenant Basic Information
 */
export const updateTenantDetails = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { name, city, phone, subdomain } = req.body;

    const brokerage = await Brokerage.findById(tenantId);
    if (!brokerage) {
      return res.status(404).json({ success: false, message: 'Brokerage tenant not found' });
    }

    if (name) brokerage.name = name.trim();
    if (city) brokerage.city = city.trim();
    if (phone !== undefined) brokerage.phone = phone.trim();
    if (subdomain) brokerage.subdomain = subdomain.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');

    await brokerage.save();

    await Promise.all([
      cacheService.del(cacheService.generateKey(tenantId, 'dash', 'stats')),
      cacheService.del(cacheService.generateKey(tenantId, 'tenant', 'metrics')),
    ]).catch(() => {});

    emitToPlatformAdmins('tenant:updated', brokerage);

    return res.status(200).json({
      success: true,
      message: 'Brokerage details updated successfully.',
      data: brokerage,
    });
  } catch (error) {
    console.error('updateTenantDetails error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * 5. Get Detailed Tenant Metrics for Slide-over Drawer
 */
export const getTenantMetrics = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const brokerage = await Brokerage.findById(tenantId);
    if (!brokerage) return res.status(404).json({ success: false, message: 'Tenant not found' });

    const [
      totalLeads,
      wonLeads,
      newLeads,
      contactedLeads,
      docCollectionLeads,
      bankSubmissionLeads,
      lostLeads,
      totalDocs,
      verifiedDocs,
      rejectedDocs,
      pendingDocs,
      advisors,
    ] = await Promise.all([
      Lead.countDocuments({ brokerageId: tenantId }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'Won' }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'New' }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'Contacted' }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'Document Collection' }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'Bank Submission' }),
      Lead.countDocuments({ brokerageId: tenantId, stage: 'Lost' }),
      Document.countDocuments({ brokerageId: tenantId }),
      Document.countDocuments({ brokerageId: tenantId, status: 'verified' }),
      Document.countDocuments({ brokerageId: tenantId, status: 'rejected' }),
      Document.countDocuments({ brokerageId: tenantId, status: 'pending' }),
      User.find({ brokerageId: tenantId, role: 'advisor' })
        .select('name email phone status createdAt')
        .lean(),
    ]);

    const advisorsWithLeadCount = await Promise.all(
      advisors.map(async (adv) => {
        const activeLeadsCount = await Lead.countDocuments({
          brokerageId: tenantId,
          assignedAdvisorId: adv._id,
          stage: { $nin: ['Won', 'Lost'] },
        });
        const wonLeadsCount = await Lead.countDocuments({
          brokerageId: tenantId,
          assignedAdvisorId: adv._id,
          stage: 'Won',
        });
        return {
          ...adv,
          id: adv._id,
          activeLeadsCount,
          wonLeadsCount,
        };
      })
    );

    const conversionRate = totalLeads > 0 ? ((wonLeads / totalLeads) * 100).toFixed(1) : '0.0';
    const totalVolumeEur = wonLeads * 450000;

    return res.status(200).json({
      success: true,
      data: {
        totalLeads,
        wonLeads,
        totalDocs,
        verifiedDocs,
        rejectedDocs,
        pendingDocs,
        conversionRate,
        totalVolumeEur,
        stageBreakdown: {
          new: newLeads,
          contacted: contactedLeads,
          documentCollection: docCollectionLeads,
          bankSubmission: bankSubmissionLeads,
          won: wonLeads,
          lost: lostLeads,
        },
        documentHealth: {
          acceptanceRate: verifiedDocs + rejectedDocs > 0 ? ((verifiedDocs / (verifiedDocs + rejectedDocs)) * 100).toFixed(1) : 100,
          rejectionRate: verifiedDocs + rejectedDocs > 0 ? ((rejectedDocs / (verifiedDocs + rejectedDocs)) * 100).toFixed(1) : 0,
        },
        advisors: advisorsWithLeadCount,
      },
    });
  } catch (error) {
    console.error('getTenantMetrics error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Get Platform Overview Metrics & Cross-tenant Analytics
 */
export const getPlatformOverviewMetrics = async (req, res) => {
  try {
    const [
      totalBrokerages,
      activeBrokerages,
      suspendedBrokerages,
      totalLeads,
      newLeads,
      contactedLeads,
      docsCollectionLeads,
      bankSubmissionLeads,
      totalWon,
      totalLost,
      totalDocs,
      verifiedDocs,
      rejectedDocs,
      pendingDocs,
      brokerages,
    ] = await Promise.all([
      Brokerage.countDocuments(),
      Brokerage.countDocuments({ status: 'active' }),
      Brokerage.countDocuments({ status: 'suspended' }),
      Lead.countDocuments(),
      Lead.countDocuments({ stage: 'New' }),
      Lead.countDocuments({ stage: 'Contacted' }),
      Lead.countDocuments({ stage: 'Document Collection' }),
      Lead.countDocuments({ stage: 'Bank Submission' }),
      Lead.countDocuments({ stage: 'Won' }),
      Lead.countDocuments({ stage: 'Lost' }),
      Document.countDocuments(),
      Document.countDocuments({ status: 'verified' }),
      Document.countDocuments({ status: 'rejected' }),
      Document.countDocuments({ status: 'pending' }),
      Brokerage.find().select('name city subdomain status phone createdAt').lean(),
    ]);

    const leaderboard = await Promise.all(
      brokerages.map(async (b) => {
        const [wonCases, totalBrokerageLeads, advisorsCount] = await Promise.all([
          Lead.countDocuments({ brokerageId: b._id, stage: 'Won' }),
          Lead.countDocuments({ brokerageId: b._id }),
          User.countDocuments({ brokerageId: b._id, role: 'advisor' }),
        ]);

        const conversionRate = totalBrokerageLeads > 0 ? ((wonCases / totalBrokerageLeads) * 100).toFixed(1) : '0.0';

        return {
          id: b._id,
          name: b.name,
          city: b.city,
          status: b.status,
          wonCases,
          wonVolumeEur: wonCases * 450000,
          totalLeads: totalBrokerageLeads,
          advisorsCount,
          conversionRate,
        };
      })
    );

    leaderboard.sort((a, b) => b.wonVolumeEur - a.wonVolumeEur);

    const docTotalProcessed = verifiedDocs + rejectedDocs;
    const documentAcceptedRate = docTotalProcessed > 0 ? ((verifiedDocs / docTotalProcessed) * 100).toFixed(1) : '94.2';
    const documentRejectedRate = docTotalProcessed > 0 ? ((rejectedDocs / docTotalProcessed) * 100).toFixed(1) : '5.8';

    return res.status(200).json({
      success: true,
      data: {
        totalBrokerages,
        activeBrokerages,
        suspendedBrokerages,
        totalLeads,
        totalMortgagesAcquired: totalWon,
        totalVolumeEur: totalWon * 450000,
        totalDocs,
        verifiedDocs,
        rejectedDocs,
        pendingDocs,
        documentAcceptedRate: Number(documentAcceptedRate),
        documentRejectedRate: Number(documentRejectedRate),
        funnel: [
          { stage: 'Stage 01: Lead Ingestion', count: newLeads, percent: totalLeads > 0 ? ((newLeads / totalLeads) * 100).toFixed(0) : 0 },
          { stage: 'Stage 02: Initial Consultation', count: contactedLeads, percent: totalLeads > 0 ? ((contactedLeads / totalLeads) * 100).toFixed(0) : 0 },
          { stage: 'Stage 03: Document Collection', count: docsCollectionLeads, percent: totalLeads > 0 ? ((docsCollectionLeads / totalLeads) * 100).toFixed(0) : 0 },
          { stage: 'Stage 04: Bank Submission', count: bankSubmissionLeads, percent: totalLeads > 0 ? ((bankSubmissionLeads / totalLeads) * 100).toFixed(0) : 0 },
          { stage: 'Stage 05: Won & Funded', count: totalWon, percent: totalLeads > 0 ? ((totalWon / totalLeads) * 100).toFixed(0) : 0 },
        ],
        leaderboard,
      },
    });
  } catch (error) {
    console.error('getPlatformOverviewMetrics error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Live SMTP Connection Health Check
 */
export const testSmtpConnection = async (req, res) => {
  try {
    const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
    const emailPass = (process.env.EMAIL_PASS || process.env.SMTP_PASS || '').replace(/\s+/g, '');

    let transporter;
    if (emailUser && emailPass) {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPass },
      });
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      return res.status(200).json({
        success: true,
        message: 'Using Ethereal / JSON Mail Transport in development mode.',
        details: { host: 'ethereal.email (mock)', secure: false, status: 'Ready' },
      });
    }

    await transporter.verify();
    return res.status(200).json({
      success: true,
      message: 'SMTP Transport verified successfully. Outgoing platform emails operational.',
      details: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        user: emailUser,
        status: 'Connected & Verified',
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `SMTP Connection Failed: ${error.message}`,
    });
  }
};

/**
 * 8. Update Super Admin Profile
 */
export const updateSuperAdminProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Superadmin account not found' });

    if (name) user.name = name.trim();
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== user.email) {
        const exists = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
        if (exists) {
          return res.status(400).json({ success: false, message: 'Email is already in use by another user.' });
        }
        user.email = normalizedEmail;
      }
    }
    if (phone !== undefined) user.phone = phone.trim();

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Platform administrator profile updated successfully.',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 9. Update Super Admin Password
 */
export const updateSuperAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'Superadmin account not found' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password does not match.' });
    }

    const validation = validatePasswordStrength(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Platform administrator password updated successfully.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

