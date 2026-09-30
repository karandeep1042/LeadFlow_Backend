import User from '../models/User.js';
import Lead from '../models/Lead.js';
import Brokerage from '../models/Brokerage.js';
import { sendAdvisorInvitationEmail } from '../utils/emailService.js';
import cacheService from '../services/cacheService.js';

export const getAdvisors = async (req, res) => {
  try {
    const brokerageId = req.user.brokerageId;
    const cacheKey = cacheService.generateKey(brokerageId, 'team', 'advisors');

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const advisors = await User.find({
      $or: [
        { brokerageId, role: 'advisor' },
        { memberships: { $elemMatch: { brokerageId, role: 'advisor' } } },
      ],
    })
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .lean();

    // Enrich advisors with active case count and mortgage volume
    const enriched = await Promise.all(
      advisors.map(async (adv) => {
        const activeLeads = await Lead.find({
          brokerageId,
          assignedAdvisorId: adv._id,
          stage: { $nin: ['Won', 'Lost'] },
        }).select('loanAmount');

        const activeCases = activeLeads.length;
        const totalVolume = activeLeads.reduce((acc, lead) => acc + (lead.loanAmount || 0), 0);

        return {
          ...adv,
          id: adv._id.toString(),
          activeCases,
          volume: totalVolume > 0 ? `€${(totalVolume / 1000000).toFixed(1)}M` : '€0',
          totalVolumeEur: totalVolume,
        };
      })
    );

    const responsePayload = { success: true, data: { advisors: enriched } };
    cacheService.set(cacheKey, responsePayload, 900).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const inviteAdvisor = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Advisor full name is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Advisor email address is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    // 1. Self-invitation check
    if (req.user && req.user.email && req.user.email.toLowerCase().trim() === cleanEmail) {
      return res.status(400).json({
        success: false,
        message: 'You cannot invite yourself to the organization.',
      });
    }

    // 2. Existing user check
    const existing = await User.findOne({ email: cleanEmail });
    const brokerage = await Brokerage.findById(req.user.brokerageId);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    if (existing) {
      const alreadyMember =
        (existing.memberships &&
          existing.memberships.some(
            (m) =>
              m.brokerageId &&
              m.brokerageId.toString() === req.user.brokerageId.toString() &&
              m.role === 'advisor'
          )) ||
        (existing.brokerageId &&
          existing.brokerageId.toString() === req.user.brokerageId.toString() &&
          existing.role === 'advisor');

      if (alreadyMember) {
        return res.status(400).json({
          success: false,
          message: 'An advisor with this email already belongs to your organization.',
        });
      }

      // Add new advisor membership to existing user
      if (!existing.memberships) existing.memberships = [];
      existing.memberships.push({
        brokerageId: req.user.brokerageId,
        role: 'advisor',
        status: 'active',
        joinedAt: new Date(),
      });
      await existing.save();

      // Invalidate Team and Dashboard caches
      await Promise.all([
        cacheService.del(cacheService.generateKey(req.user.brokerageId, 'team', 'advisors')),
        cacheService.del(cacheService.generateKey(req.user.brokerageId, 'dash', 'stats')),
      ]).catch(() => {});

      // Send email notice
      const emailResult = await sendAdvisorInvitationEmail({
        to: existing.email,
        name: existing.name || name.trim(),
        inviterName: req.user.name || 'Brokerage Admin',
        brokerageName: brokerage ? brokerage.name : 'LeadFlow Brokerage',
        temporaryPassword: 'Use your existing LeadFlow account password to sign in.',
        inviteLink: `${clientUrl}/auth/signin`,
      });

      const existingObj = existing.toObject();
      delete existingObj.password;
      delete existingObj.refreshToken;

      return res.status(201).json({
        success: true,
        message: `Advisor role added successfully for existing account (${existing.email}).`,
        data: {
          ...existingObj,
          id: existing._id.toString(),
          activeCases: 0,
          volume: '€0',
          totalVolumeEur: 0,
        },
        emailSent: emailResult?.success || false,
      });
    }

    // 3. New User: Temporary password generation
    const tempPassword = password || ('LdF-' + Math.random().toString(36).substring(2, 8) + '!9');

    // 4. Create advisor user with initial membership
    const advisor = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: tempPassword,
      role: 'advisor',
      brokerageId: req.user.brokerageId,
      memberships: [
        {
          brokerageId: req.user.brokerageId,
          role: 'advisor',
          status: 'active',
          joinedAt: new Date(),
        },
      ],
      phone: phone ? phone.trim() : '',
      status: 'active',
      mustChangePassword: true,
      isTemporaryPassword: true,
    });

    // Invalidate Team and Dashboard caches
    await Promise.all([
      cacheService.del(cacheService.generateKey(req.user.brokerageId, 'team', 'advisors')),
      cacheService.del(cacheService.generateKey(req.user.brokerageId, 'dash', 'stats')),
    ]).catch(() => {});

    // 5. Send Email Invitation
    const emailResult = await sendAdvisorInvitationEmail({
      to: advisor.email,
      name: advisor.name,
      inviterName: req.user.name || 'Brokerage Admin',
      brokerageName: brokerage ? brokerage.name : 'LeadFlow Brokerage',
      temporaryPassword: tempPassword,
      inviteLink: `${clientUrl}/auth/signin`,
    });

    const advisorObj = advisor.toObject();
    delete advisorObj.password;
    delete advisorObj.refreshToken;

    return res.status(201).json({
      success: true,
      message: `Advisor invited successfully. An invitation email was sent to ${advisor.email}`,
      data: {
        ...advisorObj,
        id: advisor._id.toString(),
        activeCases: 0,
        volume: '€0',
        totalVolumeEur: 0,
      },
      emailSent: emailResult.success,
    });
  } catch (error) {
    console.error('Error inviting advisor:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdvisorStatus = async (req, res) => {
  try {
    const { advisorId } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended', 'invited'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid advisor status' });
    }

    const advisor = await User.findById(advisorId);
    if (!advisor) {
      return res.status(404).json({ success: false, message: 'Advisor not found' });
    }

    let updated = false;
    if (advisor.memberships && advisor.memberships.length > 0) {
      for (const m of advisor.memberships) {
        if (
          m.brokerageId &&
          m.brokerageId.toString() === req.user.brokerageId.toString() &&
          m.role === 'advisor'
        ) {
          m.status = status;
          updated = true;
        }
      }
    }

    if (
      !updated &&
      advisor.brokerageId &&
      advisor.brokerageId.toString() === req.user.brokerageId.toString() &&
      advisor.role === 'advisor'
    ) {
      advisor.status = status;
      updated = true;
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Advisor not found in your brokerage' });
    }

    await advisor.save();

    // Invalidate Team and Dashboard caches
    await Promise.all([
      cacheService.del(cacheService.generateKey(req.user.brokerageId, 'team', 'advisors')),
      cacheService.del(cacheService.generateKey(req.user.brokerageId, 'dash', 'stats')),
    ]).catch(() => {});

    const advisorObj = advisor.toObject();
    delete advisorObj.password;
    delete advisorObj.refreshToken;

    return res.status(200).json({
      success: true,
      message: `Advisor status updated to ${status}`,
      data: {
        ...advisorObj,
        id: advisor._id.toString(),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

