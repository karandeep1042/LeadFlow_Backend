import crypto from 'crypto';
import User from '../models/User.js';
import Brokerage from '../models/Brokerage.js';
import IngestionSource from '../models/IngestionSource.js';
import EmailTemplate from '../models/EmailTemplate.js';
import StageTrigger from '../models/StageTrigger.js';
import Lead from '../models/Lead.js';
import Task from '../models/Task.js';
import { DEFAULT_STAGE_CONFIGS } from './defaultAutomations.js';
import { DEMO_LEADS_CONFIG } from './defaultLeads.js';

export const seedDefaultDemoAccounts = async () => {

  try {
    // 1. Ensure Default Demo Brokerage exists
    let demoBrokerage = await Brokerage.findOne({ subdomain: 'hypo-expat-berlin' });
    if (!demoBrokerage) {
      demoBrokerage = await Brokerage.create({
        name: 'HypoExpat Berlin GmbH',
        subdomain: 'hypo-expat-berlin',
        city: 'Berlin',
        status: 'active',
        metrics: {
          totalLeadsIngested: 84,
          acquiredClientsCount: 28,
          documentsAcceptedCount: 420,
          documentsRejectedCount: 38,
          totalMortgageVolumeEur: 14200000,
        },
      });
      console.log('[Seed]: Demo Brokerage created.');
    }

    // 2. Demo Users configuration
    const demoAccounts = [
      {
        name: 'Super Admin',
        email: 'platformadmin@gmail.com',
        password: 'Password@123',
        role: 'platform_admin',
        brokerageId: null,
      },
      {
        name: 'Klaus Becker',
        email: 'brokerageadmin@gmail.com',
        password: 'Password@123',
        role: 'brokerage_admin',
        brokerageId: demoBrokerage._id,
      },
      {
        name: 'Sarah Jenkins',
        email: 'mortgageadvisor@gmail.com',
        password: 'Password@123',
        role: 'advisor',
        brokerageId: demoBrokerage._id,
      },
      {
        name: 'Alex Müller',
        email: 'client@gmail.com',
        password: 'Password@123',
        role: 'client',
        brokerageId: demoBrokerage._id,
      },
    ];

    for (const acc of demoAccounts) {
      const exists = await User.findOne({ email: acc.email });
      if (!exists) {
        await User.create(acc);
        console.log(`[Seed]: Created demo user: ${acc.email} (${acc.role})`);
      }
    }

    // 3. Demo Ingestion Webhook Sources
    const sampleSources = [
      {
        name: 'Immobilienscout24 Expat Leads',
        provider: 'custom',
        apiKeyPrefix: 'lf_live_immo...',
        apiKeyHash: crypto.createHash('sha256').update('lf_live_immoscout_demo_key_123').digest('hex'),
        status: 'active',
        totalLeadsIngested: 42,
        lastPayloadReceivedAt: new Date(Date.now() - 15 * 60 * 1000),
        fieldMapping: {
          firstName: 'first_name',
          lastName: 'last_name',
          email: 'email',
          phone: 'phone',
          loanAmount: 'loan_amount',
          notes: 'notes',
        },
      },
      {
        name: 'Typeform Expat Mortgage Funnel',
        provider: 'typeform',
        apiKeyPrefix: 'lf_live_type...',
        apiKeyHash: crypto.createHash('sha256').update('lf_live_typeform_demo_key_456').digest('hex'),
        status: 'active',
        totalLeadsIngested: 28,
        lastPayloadReceivedAt: new Date(Date.now() - 65 * 60 * 1000),
        fieldMapping: {
          firstName: 'firstName',
          lastName: 'lastName',
          email: 'email',
          phone: 'phone',
          loanAmount: 'loanAmount',
          notes: 'notes',
        },
      },
    ];

    for (const src of sampleSources) {
      const exists = await IngestionSource.findOne({ brokerageId: demoBrokerage._id, name: src.name });
      if (!exists) {
        await IngestionSource.create({
          brokerageId: demoBrokerage._id,
          ...src,
        });
        console.log(`[Seed]: Created demo IngestionSource: ${src.name}`);
      }
    }

    // 4. Seed Stage Automation Triggers & Templates
    for (const config of DEFAULT_STAGE_CONFIGS) {
      const existingTrigger = await StageTrigger.findOne({ brokerageId: demoBrokerage._id, stage: config.stage });
      if (!existingTrigger) {
        let template = await EmailTemplate.findOne({ brokerageId: demoBrokerage._id, name: config.templateName });
        if (!template) {
          template = await EmailTemplate.create({
            brokerageId: demoBrokerage._id,
            name: config.templateName,
            subject: config.subject,
            body: config.body,
            description: `Automated template for ${config.stageLabel}`,
          });
        }

        await StageTrigger.create({
          brokerageId: demoBrokerage._id,
          stage: config.stage,
          emailTemplateId: template._id,
          taskTitle: config.taskTitle,
          taskPriority: config.taskPriority,
          taskDueHours: config.taskDueHours,
          isActive: true,
        });
        console.log(`[Seed]: Created demo StageTrigger: ${config.stage}`);
      }
    }

    // 5. Seed Pipeline Demo Expat Leads across stages
    for (const leadData of DEMO_LEADS_CONFIG) {
      const exists = await Lead.findOne({ brokerageId: demoBrokerage._id, email: leadData.email });
      if (!exists) {
        let assignedAdvisorId = null;
        if (leadData.advisorEmail) {
          const adv = await User.findOne({ email: leadData.advisorEmail });
          if (adv) assignedAdvisorId = adv._id;
        }

        const { advisorEmail, ...restLead } = leadData;
        await Lead.create({
          brokerageId: demoBrokerage._id,
          ...restLead,
          assignedAdvisorId,
        });
        console.log(`[Seed]: Created demo Lead: ${leadData.firstName} ${leadData.lastName} (${leadData.stage})`);
      }
    }
    // 6. Seed Sample Mortgage Tasks
    const existingTasksCount = await Task.countDocuments({ brokerageId: demoBrokerage._id });
    if (existingTasksCount === 0) {
      const demoLeads = await Lead.find({ brokerageId: demoBrokerage._id }).limit(5);
      const demoAdvisor = await User.findOne({ email: 'advisor@gmail.com' });

      const sampleTasks = [
        {
          title: 'Initial 2-Hour Consultation Call with Raj Patel',
          description: 'Discuss EU Blue Card mortgage conditions (min. 21 months pension contributions) and maximum borrow amount.',
          leadId: demoLeads[0]?._id || null,
          assignedAdvisorId: demoAdvisor?._id || null,
          priority: 'high',
          dueAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // Overdue by 3 hours
          isCompleted: false,
        },
        {
          title: 'Review 3-Month Gehaltsabrechnungen (Payslips)',
          description: 'Verify EUR 6,200 monthly net salary, tax class 1, and ensure probation period is completed.',
          leadId: demoLeads[1]?._id || null,
          assignedAdvisorId: demoAdvisor?._id || null,
          priority: 'high',
          dueAt: new Date(Date.now() + 45 * 60 * 1000), // Due in 45 mins (Urgent SLA)
          isCompleted: false,
        },
        {
          title: 'Order Missing Schufa Bonitätsauskunft',
          description: 'Confirm borrower has requested digital Schufa certificate for bank underwriting package.',
          leadId: demoLeads[2]?._id || null,
          assignedAdvisorId: demoAdvisor?._id || null,
          priority: 'medium',
          dueAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // Due today
          isCompleted: false,
        },
        {
          title: 'Calculate Household Surplus & Max Loan Capacity',
          description: 'Calculate debt service ratio considering EUR 1,400 current rent vs EUR 1,850 projected mortgage rate.',
          leadId: demoLeads[3]?._id || null,
          assignedAdvisorId: demoAdvisor?._id || null,
          priority: 'high',
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          isCompleted: false,
        },
        {
          title: 'Submit Bank Application Package to ING DiBa',
          description: 'Uploaded verified expat dossier, property expose, and land registry extract (Grundbuchauszug).',
          leadId: demoLeads[4]?._id || null,
          assignedAdvisorId: demoAdvisor?._id || null,
          priority: 'medium',
          dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          isCompleted: true,
          completedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        },
      ];

      for (const t of sampleTasks) {
        await Task.create({
          brokerageId: demoBrokerage._id,
          ...t,
        });
      }
      console.log(`[Seed]: Seeded ${sampleTasks.length} demo Tasks.`);
    }
  } catch (error) {
    console.error('[Seed Error]: Could not seed default demo accounts:', error.message);
  }
};



