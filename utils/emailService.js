import nodemailer from 'nodemailer';
import EmailTemplate from '../models/EmailTemplate.js';
import PlatformEmailTemplate from '../models/PlatformEmailTemplate.js';
import StageTrigger from '../models/StageTrigger.js';
import Brokerage from '../models/Brokerage.js';
import { DEFAULT_STAGE_CONFIGS, DEFAULT_ACCOUNT_TEMPLATES } from './defaultAutomations.js';
import { DEFAULT_PLATFORM_TEMPLATES } from './defaultPlatformTemplates.js';

let transporterPromise = null;
let currentSmtpConfig = {
  service: process.env.EMAIL_SERVICE || 'gmail',
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.EMAIL_USER || process.env.SMTP_USER || '',
  pass: (process.env.EMAIL_PASS || process.env.SMTP_PASS || '').replace(/\s+/g, ''),
};

export const setTransporterConfig = (config = {}) => {
  currentSmtpConfig = {
    ...currentSmtpConfig,
    ...config,
    pass: config.pass ? config.pass.replace(/\s+/g, '') : currentSmtpConfig.pass,
  };

  const emailUser = currentSmtpConfig.user;
  const emailPass = currentSmtpConfig.pass;

  if (emailUser && emailPass) {
    if (currentSmtpConfig.service === 'gmail') {
      transporterPromise = Promise.resolve(
        nodemailer.createTransport({
          service: 'gmail',
          auth: { user: emailUser, pass: emailPass },
        })
      );
    } else {
      transporterPromise = Promise.resolve(
        nodemailer.createTransport({
          host: currentSmtpConfig.host || 'smtp.gmail.com',
          port: Number(currentSmtpConfig.port) || 587,
          secure: Boolean(currentSmtpConfig.secure),
          auth: { user: emailUser, pass: emailPass },
        })
      );
    }
  } else {
    transporterPromise = null;
  }
};

export const getCurrentSmtpConfig = () => ({
  service: currentSmtpConfig.service || 'gmail',
  host: currentSmtpConfig.host || 'smtp.gmail.com',
  port: currentSmtpConfig.port || 587,
  secure: currentSmtpConfig.secure || false,
  user: currentSmtpConfig.user || '',
  hasPass: Boolean(currentSmtpConfig.pass),
});

export const testSmtpConfig = async (config) => {
  const targetConfig = config ? { ...currentSmtpConfig, ...config } : currentSmtpConfig;
  const user = targetConfig.user || targetConfig.emailUser;
  const pass = (targetConfig.pass || targetConfig.emailPass || '').replace(/\s+/g, '');

  if (!user || !pass) {
    return {
      success: true,
      message: 'Using Ethereal / Test Mock Transport in development mode.',
      latencyMs: 0,
      details: { host: 'smtp.ethereal.email (mock)', secure: false, status: 'Ready (Mock)' },
    };
  }

  let transporter;
  if (targetConfig.service === 'gmail') {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: targetConfig.host || 'smtp.gmail.com',
      port: Number(targetConfig.port) || 587,
      secure: Boolean(targetConfig.secure),
      auth: { user, pass },
    });
  }

  const startTime = Date.now();
  try {
    await transporter.verify();
    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      message: 'SMTP Transport verified successfully. Outgoing emails operational.',
      latencyMs,
      details: {
        host: targetConfig.host || (targetConfig.service === 'gmail' ? 'smtp.gmail.com' : 'Custom SMTP'),
        user,
        status: 'Connected & Verified',
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `SMTP Connection Failed: ${error.message}`,
      latencyMs: Date.now() - startTime,
    };
  }
};

const getTransporter = async () => {
  if (transporterPromise) return transporterPromise;

  const emailUser = currentSmtpConfig.user || process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = (currentSmtpConfig.pass || process.env.EMAIL_PASS || process.env.SMTP_PASS || '').replace(/\s+/g, '');

  if (emailUser && emailPass) {
    console.log(`[Email Service] Initializing live Gmail/SMTP transporter for: ${emailUser}`);
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        service: currentSmtpConfig.service === 'custom' ? undefined : 'gmail',
        host: currentSmtpConfig.service === 'custom' ? currentSmtpConfig.host : undefined,
        port: currentSmtpConfig.service === 'custom' ? currentSmtpConfig.port : undefined,
        secure: currentSmtpConfig.service === 'custom' ? currentSmtpConfig.secure : undefined,
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
 * Replace merge tags with context variables
 */
export const substituteMergeTags = (templateText, vars = {}) => {
  if (!templateText || typeof templateText !== 'string') return '';
  const loanStr = vars.loanAmount || vars.loanTarget;
  const formattedLoan = loanStr
    ? (typeof loanStr === 'number' ? `€${loanStr.toLocaleString()}` : (String(loanStr).startsWith('€') ? loanStr : `€${loanStr}`))
    : '€450,000';

  return templateText
    .replace(/\{\{client_name\}\}/g, vars.clientName || vars.userName || vars.name || 'Valued Client')
    .replace(/\{\{client_email\}\}/g, vars.clientEmail || vars.userEmail || vars.to || '')
    .replace(/\{\{user_name\}\}/g, vars.userName || vars.clientName || vars.name || 'Valued User')
    .replace(/\{\{user_email\}\}/g, vars.userEmail || vars.clientEmail || vars.to || '')
    .replace(/\{\{reset_code\}\}/g, vars.resetCode || '')
    .replace(/\{\{reset_url\}\}/g, vars.resetUrl || vars.resetLink || '')
    .replace(/\{\{reset_link\}\}/g, vars.resetLink || vars.resetUrl || '')
    .replace(/\{\{temporary_password\}\}/g, vars.temporaryPassword || 'Password@123')
    .replace(/\{\{advisor_name\}\}/g, vars.advisorName || 'Your Mortgage Advisor')
    .replace(/\{\{advisor_email\}\}/g, vars.advisorEmail || 'advisor@leadflow.de')
    .replace(/\{\{advisor_phone\}\}/g, vars.advisorPhone || '')
    .replace(/\{\{brokerage_name\}\}/g, vars.brokerageName || 'LeadFlow Hypotheken GmbH')
    .replace(/\{\{loan_amount\}\}/g, formattedLoan)
    .replace(/\{\{loan_target\}\}/g, formattedLoan)
    .replace(/\{\{city\}\}/g, vars.city || vars.propertyCity || 'Berlin')
    .replace(/\{\{portal_link\}\}/g, vars.portalLink || vars.portalUrl || vars.loginUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`)
    .replace(/\{\{login_url\}\}/g, vars.loginUrl || vars.portalLink || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/signin`)
    .replace(/\{\{vault_link\}\}/g, vars.vaultLink || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/documents`)
    .replace(/\{\{reason\}\}/g, vars.reason || vars.revisionReason || 'Underwriting & compliance review required')
    .replace(/\{\{rejected_docs\}\}/g, vars.rejectedDocsText || 'Required mortgage documents')
    .replace(/\{\{stage_label\}\}/g, vars.stageLabel || vars.stage || 'Mortgage Application')
    .replace(/\{\{support_email\}\}/g, vars.supportEmail || 'support@leadflow.de');
};

/**
 * Universal branded HTML wrapper for LeadFlow emails
 */
export const buildBrandedHtml = ({
  brokerageName = 'LeadFlow Hypotheken GmbH',
  badge = 'German Mortgage Desk',
  title = 'Mortgage Update',
  subtitle = 'Client Portal Notification',
  headerGradient = 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
  badgeColor = '#60a5fa',
  bodyText = '',
  actionUrl = '',
  actionLabel = 'Access Client Portal',
  actionColor = '#2563eb',
  customCardsHtml = '',
  footerAdvisor = null,
}) => {
  const paragraphs = bodyText
    .split('\n\n')
    .filter(Boolean)
    .map((p) => `<p style="font-size: 14px; line-height: 1.65; color: #334155; margin: 0 0 14px 0;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 28px 16px;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <!-- Header -->
        <div style="background: ${headerGradient}; padding: 26px 24px; text-align: center; color: #ffffff;">
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: ${badgeColor}; font-weight: 700; margin-bottom: 6px;">
            ${brokerageName} &bull; ${badge}
          </div>
          <h1 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #ffffff;">${title}</h1>
          <p style="margin: 0; font-size: 13px; color: #cbd5e1;">${subtitle}</p>
        </div>

        <!-- Body -->
        <div style="padding: 24px;">
          ${paragraphs}

          ${customCardsHtml}

          ${actionUrl ? `
            <div style="text-align: center; margin: 24px 0 16px 0;">
              <a href="${actionUrl}" style="background-color: ${actionColor}; color: #ffffff; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
                ${actionLabel} &rarr;
              </a>
            </div>
          ` : ''}

          ${footerAdvisor ? `
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 12px 16px; border: 1px solid #e2e8f0; margin-top: 20px;">
              <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 4px;">Assigned Mortgage Advisor</div>
              <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${footerAdvisor.name}</div>
              <div style="font-size: 12px; color: #475569;">Email: <a href="mailto:${footerAdvisor.email}" style="color: #2563eb; text-decoration: none;">${footerAdvisor.email}</a> ${footerAdvisor.phone ? '&bull; Tel: ' + footerAdvisor.phone : ''}</div>
            </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 14px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} ${brokerageName} &bull; German Expat Mortgage Platform
        </div>
      </div>
    </div>
  `;
};

/**
 * Sends an onboarding and credential invitation email to a newly converted Client / Borrower
 */
export const sendClientInvitationEmail = async ({
  to,
  clientName,
  advisorName = 'Your Mortgage Advisor',
  advisorEmail = 'advisor@leadflow.de',
  advisorPhone = '',
  brokerageName = 'LeadFlow Hypotheken GmbH',
  brokerageId = null,
  portalUrl,
  temporaryPassword = 'Password@123',
  loanTarget = null,
  propertyCity = null,
}) => {
  try {
    const transporter = await getTransporter();
    const loginUrl = portalUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/signin`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    let template = null;
    if (brokerageId) {
      template = await EmailTemplate.findOne({
        brokerageId,
        name: { $regex: /portal welcome|onboarding|invitation/i },
      });
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => /welcome/i.test(t.name));
    const rawSubject = template?.subject || defaultTpl?.subject || 'Access Your Secure Expat Mortgage Portal – {{brokerage_name}}';
    const rawBody = template?.body || defaultTpl?.body || `Dear {{client_name}},\n\nWelcome to {{brokerage_name}}! Your dedicated German mortgage portal is now active.\n\nYou can log in securely to manage your mortgage application roadmap and upload compliance documents:\n\nLogin Portal: {{portal_link}}\nLogin Email: {{client_email}}\nTemporary Password: {{temporary_password}}\n\nAssigned Mortgage Advisor: {{advisor_name}} ({{advisor_email}})\n\nBest regards,\n{{brokerage_name}} Team`;

    const vars = {
      clientName,
      clientEmail: to,
      temporaryPassword,
      advisorName,
      advisorEmail,
      advisorPhone,
      brokerageName,
      loanTarget,
      loanAmount: loanTarget,
      propertyCity,
      city: propertyCity,
      portalLink: loginUrl,
      loginUrl,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const customCardsHtml = `
      ${(loanTarget || propertyCity) ? `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; display: flex; justify-content: space-between;">
          ${loanTarget ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Target Loan: </span><strong style="color: #0f172a;">${typeof loanTarget === 'number' ? '€' + loanTarget.toLocaleString() : loanTarget}</strong></div>` : ''}
          ${propertyCity ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Location: </span><strong style="color: #0f172a;">${propertyCity}</strong></div>` : ''}
        </div>
      ` : ''}

      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 12px; font-weight: 700; color: #15803d; text-transform: uppercase; margin-bottom: 6px;">Your Secure Login Credentials</div>
        <div style="margin-bottom: 4px; font-size: 13px;"><span style="color: #4b5563;">Login URL:</span> <a href="${loginUrl}" style="color: #2563eb; font-weight: 600; text-decoration: none;">${loginUrl}</a></div>
        <div style="margin-bottom: 4px; font-size: 13px;"><span style="color: #4b5563;">Email Address:</span> <strong>${to}</strong></div>
        <div style="font-size: 13px;"><span style="color: #4b5563;">Temporary Password:</span> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: 700; color: #0f172a;">${temporaryPassword}</code></div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Client Portal Access',
      title: 'Welcome to Your Mortgage Portal',
      subtitle: 'German mortgage tracking & document verification hub',
      headerGradient: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
      badgeColor: '#60a5fa',
      bodyText: renderedBody,
      actionUrl: loginUrl,
      actionLabel: 'Launch Client Portal & Upload Docs',
      actionColor: '#2563eb',
      customCardsHtml,
      footerAdvisor: { name: advisorName, email: advisorEmail, phone: advisorPhone },
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      replyTo: advisorEmail || senderEmail,
      subject: renderedSubject,
      text: `${renderedBody}\n\nLogin URL: ${loginUrl}\nEmail: ${to}\nTemporary Password: ${temporaryPassword}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Client portal invitation sent to ${to}. Preview: ${previewUrl}`);
    } else {
      console.log(`[Email Sent] Client portal invitation sent to ${to}. MessageId: ${info?.messageId}`);
    }
    return { success: true, messageId: info?.messageId, previewUrl: previewUrl || null };
  } catch (error) {
    console.error('[Client Invitation Email Error]', error);
    return { success: false, error: error.message };
  }
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
  previousAdvisor = null,
  brokerageName = 'LeadFlow Brokerage',
  brokerageId = null,
  portalUrl = null,
}) => {
  try {
    if (!lead || !lead.email || !advisor) {
      return { success: false, error: 'Missing required lead or advisor information' };
    }

    const transporter = await getTransporter();
    const effectivePortalUrl = portalUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
    const isReassigned = Boolean(previousAdvisor && String(previousAdvisor._id || previousAdvisor.id) !== String(advisor._id || advisor.id));

    const effectiveBrokerageId = brokerageId || lead.brokerageId;
    let template = null;
    if (effectiveBrokerageId) {
      template = await EmailTemplate.findOne({
        brokerageId: effectiveBrokerageId,
        name: { $regex: /advisor.*assigned/i },
      });
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => /advisor assigned/i.test(t.name));
    const rawSubject = template?.subject || defaultTpl?.subject || `Meet Your Dedicated Mortgage Advisor at {{brokerage_name}}`;
    const rawBody = template?.body || defaultTpl?.body || `Dear {{client_name}},\n\nWe are pleased to inform you that {{advisor_name}} has been assigned as your dedicated Mortgage Advisor for your property financing in {{city}}.\n\nAdvisor Contact Information:\nEmail: {{advisor_email}}\nPhone: {{advisor_phone}}\n\nCurrent Application Stage: {{stage_label}}\n\nYou can track your application progress and message your advisor through your portal at {{portal_link}}.\n\nBest regards,\n{{brokerage_name}} Advisory Desk`;

    const vars = {
      clientName: `${lead.firstName} ${lead.lastName || ''}`.trim() || 'Valued Client',
      clientEmail: lead.email,
      advisorName: advisor.name || 'Your Mortgage Advisor',
      advisorEmail: advisor.email || 'advisor@leadflow.de',
      advisorPhone: advisor.phone || '',
      brokerageName,
      city: lead.city || 'Berlin',
      stageLabel: lead.stage || 'Application Intake',
      portalLink: effectivePortalUrl,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const customCardsHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin: 16px 0;">
        <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Your Mortgage Specialist</div>
        <div style="font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">${vars.advisorName}</div>
        <div style="font-size: 13px; color: #475569;">
          <div><strong>Email:</strong> <a href="mailto:${vars.advisorEmail}" style="color: #2563eb; text-decoration: none;">${vars.advisorEmail}</a></div>
          ${vars.advisorPhone ? `<div><strong>Phone:</strong> ${vars.advisorPhone}</div>` : ''}
        </div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Expat Mortgage Desk',
      title: isReassigned ? 'Your Mortgage Advisor Has Been Updated' : 'Meet Your Dedicated Mortgage Advisor',
      subtitle: 'Personalized German financing consultation',
      headerGradient: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
      badgeColor: '#60a5fa',
      bodyText: renderedBody,
      actionUrl: effectivePortalUrl,
      actionLabel: 'Access Client Portal',
      actionColor: '#2563eb',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"${brokerageName}" <${process.env.EMAIL_FROM || 'no-reply@leadflow.de'}>`,
      to: lead.email,
      replyTo: vars.advisorEmail,
      subject: renderedSubject,
      text: `${renderedBody}\n\nClient Portal: ${effectivePortalUrl}`,
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

/**
 * Sends notification email when client account is suspended (deactivated) or reactivated
 */
export const sendClientAccountStatusEmail = async ({
  to,
  clientName = 'Valued Client',
  status = 'suspended', // 'suspended' | 'active'
  reason = '',
  brokerageName = 'LeadFlow Brokerage',
  brokerageId = null,
  advisorName = 'Your Mortgage Advisor',
  advisorEmail = '',
  advisorPhone = '',
  supportEmail = 'support@leadflow.de',
  customSubject = null,
  customBody = null,
  portalLink = null,
  temporaryPassword = 'Password@123',
  loanTarget = null,
  propertyCity = null,
}) => {
  try {
    const transporter = await getTransporter();
    const portalUrl = portalLink || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
    const loginUrl = portalLink || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/signin`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';
    const isSuspended = status === 'suspended';

    let subjectTemplate = customSubject;
    let bodyTemplate = customBody;

    if ((!subjectTemplate || !bodyTemplate) && brokerageId) {
      const template = await EmailTemplate.findOne({
        brokerageId,
        name: isSuspended ? { $regex: /deactivated|suspended/i } : { $regex: /reactivated|restored/i },
      });
      if (template) {
        subjectTemplate = subjectTemplate || template.subject;
        bodyTemplate = bodyTemplate || template.body;
      }
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => (isSuspended ? /suspended/i.test(t.name) : /reactivated/i.test(t.name)));
    const rawSubject = subjectTemplate || defaultTpl?.subject || (isSuspended ? 'Important: Your {{brokerage_name}} Mortgage Portal Account has been Deactivated' : 'Good News: Your {{brokerage_name}} Mortgage Portal Account is Active');
    const rawBody = bodyTemplate || defaultTpl?.body || (isSuspended ? `Dear {{client_name}},\n\nYour account has been deactivated.\nReason: {{reason}}` : `Dear {{client_name}},\n\nYour account has been reactivated.`);

    const vars = {
      clientName,
      clientEmail: to,
      temporaryPassword,
      advisorName,
      advisorEmail,
      advisorPhone,
      brokerageName,
      reason: reason || 'Administrative compliance review',
      supportEmail,
      portalLink: portalUrl,
      loginUrl,
      loanAmount: loanTarget,
      city: propertyCity,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px;">
        <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
          <div style="background: ${isSuspended ? '#0f172a' : '#059669'}; padding: 24px; text-align: center; color: #ffffff;">
            <div style="font-size: 11px; text-transform: uppercase; color: ${isSuspended ? '#94a3b8' : '#a7f3d0'}; font-weight: 700; margin-bottom: 4px;">
              ${brokerageName} &bull; Security & Account Notice
            </div>
            <h2 style="margin: 0; font-size: 20px; color: #ffffff;">
              ${isSuspended ? 'Account Deactivated / Suspended' : 'Client Portal Account Active'}
            </h2>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 15px; font-weight: 600; color: #0f172a; margin-top: 0;">Dear ${clientName},</p>
            <div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-line; margin-bottom: 16px;">
              ${bodyText}
            </div>

            ${!isSuspended ? `
              <div style="background-color: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 16px 20px; margin: 18px 0;">
                <div style="font-size: 12px; font-weight: 800; color: #15803d; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">
                  Your Client Portal Login Credentials
                </div>
                <div style="margin-bottom: 6px; font-size: 13px;"><span style="color: #4b5563;">Login URL:</span> <a href="${loginUrl}" style="color: #2563eb; font-weight: 600;">${loginUrl}</a></div>
                <div style="margin-bottom: 6px; font-size: 13px;"><span style="color: #4b5563;">Login Email:</span> <strong>${to}</strong></div>
                <div style="font-size: 13px;"><span style="color: #4b5563;">Temporary Password:</span> <code style="background: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 13px; color: #0f172a;">${temporaryPassword}</code></div>
              </div>
            ` : ''}

            ${(loanTarget || propertyCity) ? `
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; display: flex; justify-content: space-between;">
                ${loanTarget ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Target Loan: </span><strong style="color: #0f172a;">${typeof loanTarget === 'number' ? '€' + loanTarget.toLocaleString() : loanTarget}</strong></div>` : ''}
                ${propertyCity ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Location: </span><strong style="color: #0f172a;">${propertyCity}</strong></div>` : ''}
              </div>
            ` : ''}

            ${reason ? `
              <div style="background-color: ${isSuspended ? '#fef2f2' : '#f0fdf4'}; border-left: 4px solid ${isSuspended ? '#ef4444' : '#10b981'}; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: ${isSuspended ? '#991b1b' : '#065f46'}; margin-bottom: 4px;">Administrative Note</div>
                <div style="font-size: 13px; color: ${isSuspended ? '#7f1d1d' : '#047857'};">${reason}</div>
              </div>
            ` : ''}

            <div style="text-align: center; margin: 24px 0 16px 0;">
              <a href="${isSuspended ? portalUrl : loginUrl}" style="background-color: ${isSuspended ? '#475569' : '#059669'}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
                ${isSuspended ? 'Visit Support Desk' : 'Sign In to Client Portal'}
              </a>
            </div>

            <div style="background-color: #f8fafc; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #64748b; margin-top: 20px;">
              <div><strong>Brokerage Desk:</strong> ${brokerageName}</div>
              <div><strong>Assigned Advisor:</strong> ${advisorName} ${advisorEmail ? `(${advisorEmail})` : ''}</div>
              <div><strong>Support Contact:</strong> ${supportEmail}</div>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
            &copy; ${new Date().getFullYear()} ${brokerageName} &bull; German Expat Mortgage Platform
          </div>
        </div>
      </div>
    `;

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      replyTo: advisorEmail || supportEmail || senderEmail,
      subject,
      text: isSuspended
        ? `${subject}\n\n${bodyText}\n\nClient Portal: ${portalUrl}\nSupport: ${supportEmail}`
        : `${subject}\n\n${bodyText}\n\nLogin URL: ${loginUrl}\nEmail: ${to}\nTemporary Password: ${temporaryPassword}\n\nAssigned Advisor: ${advisorName}\nSupport: ${supportEmail}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Client status email sent to ${to}. Preview: ${previewUrl}`);
    } else {
      console.log(`[Email Sent] Client status email sent to ${to}. MessageId: ${info?.messageId}`);
    }
    return { success: true, messageId: info.messageId, previewUrl: previewUrl || null };
  } catch (error) {
    console.error('[Client Account Status Email Error]', error);
    return { success: false, error: error.message };
  }
};


/**
 * Sends real-time stage progression milestone email to a Client / Borrower
 */
export const sendStageMilestoneEmail = async ({
  to,
  clientName = 'Valued Client',
  stage,
  previousStage,
  advisorName = 'Your Mortgage Advisor',
  advisorEmail = 'advisor@leadflow.de',
  advisorPhone = '',
  brokerageName = 'LeadFlow Hypotheken GmbH',
  brokerageId = null,
  portalUrl,
  loanAmount = null,
  city = null,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email missing' };

    const transporter = await getTransporter();
    const portalLink = portalUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/portal`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    let trigger = null;
    let template = null;

    if (brokerageId) {
      trigger = await StageTrigger.findOne({ brokerageId, stage }).populate('emailTemplateId');
      if (trigger) {
        if (trigger.isActive === false) {
          console.log(`[Stage Milestone Email Skipped] Trigger for stage "${stage}" is deactivated by admin.`);
          return { success: true, skipped: true, reason: 'Trigger deactivated by administrator' };
        }
        template = trigger.emailTemplateId;
      }
    }

    const defaultConfig = DEFAULT_STAGE_CONFIGS.find((c) => c.stage === stage) || DEFAULT_STAGE_CONFIGS[0];
    const rawSubject = template?.subject || defaultConfig?.subject || `Application Status Updated: ${stage} – {{brokerage_name}}`;
    const rawBody = template?.body || defaultConfig?.body || `Dear {{client_name}},\n\nYour mortgage application has progressed to ${stage}.\n\nBest regards,\n{{brokerage_name}}`;

    const vars = {
      clientName,
      clientEmail: to,
      advisorName,
      advisorEmail,
      advisorPhone,
      brokerageName,
      stage,
      stageLabel: defaultConfig?.stageLabel || stage,
      loanAmount,
      city: city || 'Berlin',
      portalLink,
      loginUrl: portalLink,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const customCardsHtml = `
      ${(loanAmount || city) ? `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; display: flex; justify-content: space-between;">
          ${loanAmount ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Loan Amount: </span><strong style="color: #0f172a;">${typeof loanAmount === 'number' ? '€' + loanAmount.toLocaleString() : loanAmount}</strong></div>` : ''}
          ${city ? `<div><span style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Location: </span><strong style="color: #0f172a;">${city}</strong></div>` : ''}
        </div>
      ` : ''}
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Mortgage Milestone Update',
      title: `Application Stage: ${vars.stageLabel}`,
      subtitle: 'Real-time progress notification',
      headerGradient: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
      badgeColor: '#60a5fa',
      bodyText: renderedBody,
      actionUrl: portalLink,
      actionLabel: 'View Mortgage Roadmap',
      actionColor: '#2563eb',
      customCardsHtml,
      footerAdvisor: { name: advisorName, email: advisorEmail, phone: advisorPhone },
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      replyTo: advisorEmail || senderEmail,
      subject: renderedSubject,
      text: `${renderedBody}\n\nClient Portal: ${portalLink}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email Sent] Stage milestone email sent to ${to}. MessageId: ${info?.messageId}`);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Stage Milestone Email Error]', error);
    return { success: false, error: error.message };
  }
};



/**
 * 6. Document Revision & Re-upload Request Email (Dynamic Template Support)
 */
export const sendDocumentRevisionEmail = async ({
  to,
  clientName = 'Valued Client',
  advisorName = 'Your Mortgage Advisor',
  advisorEmail = 'advisor@leadflow.de',
  brokerageName = 'LeadFlow Hypotheken GmbH',
  brokerageId = null,
  revisionReason = 'Document update required for bank underwriting.',
  rejectedDocs = [],
  portalUrl,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email missing' };

    const transporter = await getTransporter();
    const vaultLink = portalUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/client/documents`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    let template = null;
    if (brokerageId) {
      template = await EmailTemplate.findOne({
        brokerageId,
        name: { $regex: /document.*(revision|failed|rejected)/i },
      });
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => /revision/i.test(t.name));
    const rawSubject = template?.subject || defaultTpl?.subject || `Action Required: Document Revision for Your Mortgage Application – {{brokerage_name}}`;
    const rawBody = template?.body || defaultTpl?.body || `Dear {{client_name}},\n\nYour mortgage advisor {{advisor_name}} or partner bank underwriter has reviewed your submitted documents and requested corrections / re-upload for your mortgage application.\n\nReason: {{reason}}\n\nPlease log in to your Document Vault at {{vault_link}} and submit updated compliant versions so we can finalize your bank submission.\n\nBest regards,\n{{advisor_name}} | {{brokerage_name}}`;

    const rejectedDocsSummary = rejectedDocs.length > 0
      ? rejectedDocs.map((d) => d.title || d.docType).join(', ')
      : 'Required compliance documents';

    const vars = {
      clientName,
      clientEmail: to,
      advisorName,
      advisorEmail,
      brokerageName,
      reason: revisionReason,
      revisionReason,
      rejectedDocsText: rejectedDocsSummary,
      vaultLink,
      portalLink: vaultLink,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const docListHtml = rejectedDocs.length > 0
      ? rejectedDocs
          .map(
            (doc) => `
              <div style="background-color: #ffffff; border: 1px solid #fecaca; border-radius: 6px; padding: 10px 14px; margin-top: 8px;">
                <div style="font-weight: 700; color: #991b1b; font-size: 13px;">${doc.title || doc.docType || 'Document Item'}</div>
                ${(doc.reason || doc.rejectionReason) ? `<div style="font-size: 12px; color: #7f1d1d; margin-top: 2px;">Note: ${doc.reason || doc.rejectionReason}</div>` : ''}
              </div>`
          )
          .join('')
      : `<div style="font-size: 13px; color: #7f1d1d; margin-top: 6px;">${revisionReason}</div>`;

    const customCardsHtml = `
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 12px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 4px;">Items Requiring Correction:</div>
        ${docListHtml}
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Action Required',
      title: 'Document Re-upload Requested',
      subtitle: 'Bank Underwriting Feedback & Revision',
      headerGradient: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)',
      badgeColor: '#fed7aa',
      bodyText: renderedBody,
      actionUrl: vaultLink,
      actionLabel: 'Upload Updated Documents',
      actionColor: '#ea580c',
      customCardsHtml,
      footerAdvisor: { name: advisorName, email: advisorEmail },
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      replyTo: advisorEmail || senderEmail,
      subject: renderedSubject,
      text: `${renderedBody}\n\nReason: ${revisionReason}\nUpload Link: ${vaultLink}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email Sent] Document revision email sent to ${to}. MessageId: ${info?.messageId}`);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Document Revision Email Error]', error);
    return { success: false, error: error.message };
  }
};

/**
 * 7. Password Reset Verification Code Email
 */
export const sendPasswordResetEmail = async ({
  to,
  userName = 'Valued User',
  resetCode,
  resetUrl,
  brokerageName = 'LeadFlow Hypotheken GmbH',
  brokerageId = null,
  expiresInMinutes = 15,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const effectiveResetUrl = resetUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/reset-password?email=${encodeURIComponent(to)}&code=${resetCode}`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    let template = null;
    if (brokerageId) {
      template = await EmailTemplate.findOne({
        brokerageId,
        name: { $regex: /password reset|forgot password/i },
      });
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => /password reset verification/i.test(t.name)) || DEFAULT_ACCOUNT_TEMPLATES.find((t) => /password reset/i.test(t.name));
    const rawSubject = template?.subject || defaultTpl?.subject || `Your Password Reset Verification Code: ${resetCode} – {{brokerage_name}}`;
    const rawBody = template?.body || defaultTpl?.body || `Dear {{user_name}},\n\nWe received a request to reset your password for your {{brokerage_name}} account ({{user_email}}).\n\nYour 6-digit verification code is:\n\n{{reset_code}}\n\nThis verification code is valid for ${expiresInMinutes} minutes. If you did not request this password reset, you can safely ignore this email and your password will remain unchanged.\n\nDirect Reset Link: {{reset_url}}\n\nBest regards,\n{{brokerage_name}} Security Desk`;

    const vars = {
      userName,
      clientName: userName,
      userEmail: to,
      clientEmail: to,
      to,
      resetCode,
      resetUrl: effectiveResetUrl,
      resetLink: effectiveResetUrl,
      brokerageName,
      portalLink: effectiveResetUrl,
      loginUrl: effectiveResetUrl,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const customCardsHtml = `
      <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 24px; margin: 20px 0; text-align: center;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">
          Security Verification Code
        </div>
        <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: monospace, Consolas, Monaco, monospace; background: #ffffff; display: inline-block; padding: 12px 28px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 6px 0; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
          ${resetCode}
        </div>
        <div style="font-size: 12px; color: #64748b; margin-top: 10px; font-weight: 500;">
          Valid for <strong>${expiresInMinutes} minutes</strong> &bull; Never share this code with anyone
        </div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Account Security',
      title: 'Password Reset Request',
      subtitle: 'Verification code for your LeadFlow account',
      headerGradient: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      badgeColor: '#94a3b8',
      bodyText: renderedBody,
      actionUrl: effectiveResetUrl,
      actionLabel: 'Reset Password Now',
      actionColor: '#0f172a',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: `${renderedBody}\n\nVerification Code: ${resetCode}\nDirect Reset URL: ${effectiveResetUrl}\n\n(Expires in ${expiresInMinutes} minutes)`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Password reset verification email sent to ${to}. Preview: ${previewUrl}`);
    } else {
      console.log(`[Email Sent] Password reset verification email sent to ${to}. MessageId: ${info?.messageId}`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || null,
    };
  } catch (error) {
    console.error('[Password Reset Email Error]', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 8. Password Reset Confirmation Notice Email
 */
export const sendPasswordResetConfirmationEmail = async ({
  to,
  userName = 'Valued User',
  brokerageName = 'LeadFlow Hypotheken GmbH',
  brokerageId = null,
  loginUrl,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const effectiveLoginUrl = loginUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/auth/signin`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    let template = null;
    if (brokerageId) {
      template = await EmailTemplate.findOne({
        brokerageId,
        name: { $regex: /password.*(confirm|success|updated)/i },
      });
    }

    const defaultTpl = DEFAULT_ACCOUNT_TEMPLATES.find((t) => /password reset confirmation/i.test(t.name));
    const rawSubject = template?.subject || defaultTpl?.subject || `Security Alert: Your Password Was Successfully Updated – {{brokerage_name}}`;
    const rawBody = template?.body || defaultTpl?.body || `Dear {{user_name}},\n\nThis is a confirmation that the password for your {{brokerage_name}} account ({{user_email}}) was successfully updated.\n\nIf you did not make this change, please contact our security team immediately.\n\nSign In: {{login_url}}\n\nBest regards,\n{{brokerage_name}} Security Desk`;

    const vars = {
      userName,
      clientName: userName,
      userEmail: to,
      clientEmail: to,
      to,
      brokerageName,
      loginUrl: effectiveLoginUrl,
      portalLink: effectiveLoginUrl,
    };

    const renderedSubject = substituteMergeTags(rawSubject, vars);
    const renderedBody = substituteMergeTags(rawBody, vars);

    const customCardsHtml = `
      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 12px; font-weight: 700; color: #15803d; text-transform: uppercase; margin-bottom: 4px;">Security Notice</div>
        <div style="font-size: 13px; color: #166534;">Your password was successfully updated on ${new Date().toUTCString()}. You can now sign in using your new credentials.</div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Security Notice',
      title: 'Password Updated Successfully',
      subtitle: 'Account security confirmation',
      headerGradient: 'linear-gradient(135deg, #0f172a 0%, #15803d 100%)',
      badgeColor: '#86efac',
      bodyText: renderedBody,
      actionUrl: effectiveLoginUrl,
      actionLabel: 'Sign In to LeadFlow',
      actionColor: '#16a34a',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: `${renderedBody}\n\nSign In: ${effectiveLoginUrl}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('[Password Reset Confirmation Email Error]', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * 9. Sign Up Email Verification Code Email
 */
export const sendSignupVerificationEmail = async ({
  to,
  userName = 'Valued Broker',
  verificationCode,
  brokerageName = 'LeadFlow GmbH',
  expiresInMinutes = 15,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@leadflow.de';

    const subject = `Your LeadFlow Verification Code: ${verificationCode}`;
    const body = `Dear ${userName},\n\nThank you for signing up with LeadFlow!\n\nYour 6-digit email verification code is:\n\n${verificationCode}\n\nThis verification code is valid for ${expiresInMinutes} minutes. Please enter this code on the sign-up page to verify your business email address.\n\nIf you did not initiate this registration, you can safely ignore this email.\n\nBest regards,\nLeadFlow Onboarding Team`;

    const customCardsHtml = `
      <div style="background-color: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 12px; padding: 24px; margin: 20px 0; text-align: center;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #64748b; margin-bottom: 8px;">
          Email Verification Code
        </div>
        <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: monospace, Consolas, Monaco, monospace; background: #ffffff; display: inline-block; padding: 12px 28px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 6px 0; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
          ${verificationCode}
        </div>
        <div style="font-size: 12px; color: #64748b; margin-top: 10px; font-weight: 500;">
          Valid for <strong>${expiresInMinutes} minutes</strong> &bull; Never share this code with anyone
        </div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName,
      badge: 'Account Verification',
      title: 'Verify Your Email Address',
      subtitle: 'Complete your LeadFlow workspace registration',
      headerGradient: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)',
      badgeColor: '#93c5fd',
      bodyText: body,
      actionColor: '#2563eb',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"${brokerageName}" <${senderEmail}>`,
      to,
      subject,
      text: `${body}\n\nVerification Code: ${verificationCode}\n\n(Expires in ${expiresInMinutes} minutes)`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Sent] Sign up verification email sent to ${to}. Preview: ${previewUrl}`);
    } else {
      console.log(`[Email Sent] Sign up verification email sent to ${to}. MessageId: ${info?.messageId}`);
    }

    return {
      success: true,
      messageId: info?.messageId,
      previewUrl: previewUrl || null,
    };
  } catch (error) {
    console.error('[Sign Up Verification Email Error]', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Load Platform Template with DB override and fallback
 */
export const getPlatformTemplate = async (key) => {
  try {
    const dbTemplate = await PlatformEmailTemplate.findOne({ key });
    if (dbTemplate) {
      return {
        subject: dbTemplate.subject,
        body: dbTemplate.body,
        name: dbTemplate.name,
      };
    }
  } catch (err) {
    console.warn(`[Email Service] Failed to load platform template ${key} from DB:`, err.message);
  }
  const defaultTpl = DEFAULT_PLATFORM_TEMPLATES.find((t) => t.key === key);
  return {
    subject: defaultTpl?.subject || 'LeadFlow Platform Notification',
    body: defaultTpl?.body || '',
    name: defaultTpl?.name || key,
  };
};

/**
 * 10. Organization Welcome & Provisioning Email
 */
export const sendBrokerageWelcomeEmail = async ({
  to,
  adminName = 'Brokerage Administrator',
  brokerageName = 'LeadFlow Partner Brokerage',
  temporaryPassword = 'Password@123',
  loginUrl,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const effectiveLoginUrl = loginUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'platform@leadflow.de';

    const tpl = await getPlatformTemplate('org_welcome');
    const vars = {
      adminName,
      adminEmail: to,
      brokerageName,
      temporaryPassword,
      loginUrl: effectiveLoginUrl,
      supportEmail: 'support@leadflow.de',
    };

    const renderedSubject = substituteMergeTags(tpl.subject, vars);
    const renderedBody = substituteMergeTags(tpl.body, vars);

    const customCardsHtml = `
      <div style="background-color: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 18px 0;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #475569; margin-bottom: 8px;">
          Workspace Credentials
        </div>
        <div style="font-size: 13px; color: #1e293b; line-height: 1.8;">
          <strong>Organization:</strong> ${brokerageName}<br/>
          <strong>Admin Login:</strong> <span style="font-family: monospace; color: #2563eb;">${to}</span><br/>
          <strong>Temporary Password:</strong> <span style="font-family: monospace; background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${temporaryPassword}</span>
        </div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName: 'LeadFlow Platform',
      badge: 'Workspace Provisioned',
      title: 'Welcome to LeadFlow SaaS',
      subtitle: `Your workspace for ${brokerageName} is live`,
      headerGradient: 'linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)',
      badgeColor: '#c7d2fe',
      bodyText: renderedBody,
      actionUrl: effectiveLoginUrl,
      actionLabel: 'Sign In to Workspace',
      actionColor: '#4f46e5',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"LeadFlow Platform" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: `${renderedBody}\n\nLogin: ${effectiveLoginUrl}\nUser: ${to}\nTemporary Password: ${temporaryPassword}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Brokerage Welcome Email Error]', error);
    return { success: false, error: error.message };
  }
};

/**
 * 11. Organization Suspended / Banned Email
 */
export const sendBrokerageSuspendedEmail = async ({
  to,
  adminName = 'Brokerage Administrator',
  brokerageName = 'Brokerage Workspace',
  banReason = 'Subscription review and platform compliance audit.',
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'compliance@leadflow.de';

    const tpl = await getPlatformTemplate('org_banned');
    const vars = {
      adminName,
      adminEmail: to,
      brokerageName,
      banReason,
      supportEmail: 'support@leadflow.de',
    };

    const renderedSubject = substituteMergeTags(tpl.subject, vars);
    const renderedBody = substituteMergeTags(tpl.body, vars);

    const customCardsHtml = `
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 11px; font-weight: 800; color: #991b1b; text-transform: uppercase; margin-bottom: 4px;">Reason for Workspace Suspension</div>
        <div style="font-size: 13px; color: #7f1d1d; line-height: 1.5;">${banReason}</div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName: 'LeadFlow Platform Security',
      badge: 'Compliance Notice',
      title: 'Workspace Suspended',
      subtitle: `${brokerageName} access paused`,
      headerGradient: 'linear-gradient(135deg, #450a0a 0%, #991b1b 100%)',
      badgeColor: '#fca5a5',
      bodyText: renderedBody,
      customCardsHtml,
    });

    const mailOptions = {
      from: `"LeadFlow Platform Security" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: `${renderedBody}\n\nReason: ${banReason}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Brokerage Suspended Email Error]', error);
    return { success: false, error: error.message };
  }
};

/**
 * 12. Organization Reactivated Email
 */
export const sendBrokerageReactivatedEmail = async ({
  to,
  adminName = 'Brokerage Administrator',
  brokerageName = 'Brokerage Workspace',
  loginUrl,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient email is required.' };

    const transporter = await getTransporter();
    const effectiveLoginUrl = loginUrl || `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`;
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'platform@leadflow.de';

    const tpl = await getPlatformTemplate('org_reactivated');
    const vars = {
      adminName,
      adminEmail: to,
      brokerageName,
      loginUrl: effectiveLoginUrl,
      supportEmail: 'support@leadflow.de',
    };

    const renderedSubject = substituteMergeTags(tpl.subject, vars);
    const renderedBody = substituteMergeTags(tpl.body, vars);

    const customCardsHtml = `
      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin: 18px 0;">
        <div style="font-size: 11px; font-weight: 800; color: #15803d; text-transform: uppercase; margin-bottom: 4px;">Status: Active</div>
        <div style="font-size: 13px; color: #166534;">Your workspace, advisor logins, and lead routing have been fully restored.</div>
      </div>
    `;

    const htmlContent = buildBrandedHtml({
      brokerageName: 'LeadFlow Platform',
      badge: 'Workspace Reactivated',
      title: 'Access Restored',
      subtitle: `${brokerageName} is ready`,
      headerGradient: 'linear-gradient(135deg, #064e3b 0%, #059669 100%)',
      badgeColor: '#6ee7b7',
      bodyText: renderedBody,
      actionUrl: effectiveLoginUrl,
      actionLabel: 'Sign In to Workspace',
      actionColor: '#059669',
      customCardsHtml,
    });

    const mailOptions = {
      from: `"LeadFlow Platform" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: `${renderedBody}\n\nLogin: ${effectiveLoginUrl}`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Brokerage Reactivated Email Error]', error);
    return { success: false, error: error.message };
  }
};

/**
 * 13. Send Test Platform Template Email
 */
export const sendTestPlatformEmail = async ({
  to,
  templateKey,
  customSubject,
  customBody,
}) => {
  try {
    if (!to) return { success: false, error: 'Recipient test email is required.' };

    const transporter = await getTransporter();
    const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'test@leadflow.de';

    const tpl = await getPlatformTemplate(templateKey);
    const rawSubject = customSubject || tpl.subject;
    const rawBody = customBody || tpl.body;

    const sampleVars = {
      adminName: 'Platform Tester',
      userName: 'Platform Tester',
      clientName: 'Platform Tester',
      adminEmail: to,
      userEmail: to,
      clientEmail: to,
      to,
      brokerageName: 'Demo Hypotheken GmbH',
      banReason: 'Periodic compliance verification sample reason.',
      temporaryPassword: 'Password@123',
      resetCode: '849201',
      resetUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?code=849201`,
      loginUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
      portalLink: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
      supportEmail: 'support@leadflow.de',
    };

    const renderedSubject = `[TEST PREVIEW] ${substituteMergeTags(rawSubject, sampleVars)}`;
    const renderedBody = substituteMergeTags(rawBody, sampleVars);

    const htmlContent = buildBrandedHtml({
      brokerageName: 'LeadFlow Platform (Test Dispatch)',
      badge: 'Template Preview',
      title: 'Platform Email Preview',
      subtitle: `Template Key: ${templateKey}`,
      headerGradient: 'linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)',
      badgeColor: '#c7d2fe',
      bodyText: renderedBody,
      actionUrl: `${process.env.CLIENT_URL || 'http://localhost:5173'}/login`,
      actionLabel: 'Preview Action Button',
      actionColor: '#4f46e5',
    });

    const mailOptions = {
      from: `"LeadFlow Template Test" <${senderEmail}>`,
      to,
      subject: renderedSubject,
      text: renderedBody,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info?.messageId };
  } catch (error) {
    console.error('[Send Test Platform Email Error]', error);
    return { success: false, error: error.message };
  }
};



