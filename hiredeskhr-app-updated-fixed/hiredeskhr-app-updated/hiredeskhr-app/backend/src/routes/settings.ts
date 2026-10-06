import { Router } from 'express';
import { store } from '../data/store';
import { EmailService, emailConfig, resolveEmailCreds, resetTransporters } from '../services/emailService';
import { requireAuthenticated } from './auth';

export const settingsRouter = Router();
settingsRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

// Get all settings & module info
settingsRouter.get('/', (req, res) => {
  const orgId = getOrgId(req);
  const org = store.organizations.find(o => o.id === orgId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const metrics = store.getMetrics(orgId);

  const trialStart = org.trialStartedAt ? new Date(org.trialStartedAt) : (org.createdAt ? new Date(org.createdAt) : new Date());
  const trialEnd = org.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const isTrial = org.plan === 'free';
  const trialDaysRemaining = isTrial ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : null;
  const trialExpired = isTrial ? Date.now() > trialEnd.getTime() : false;
  const jobsPurchased = org.plan === 'growth' ? (org.jobsPurchased || 5) : undefined;
  const jobLimit = org.plan === 'enterprise' ? 'Unlimited' : org.plan === 'growth' ? (org.jobsPurchased || 5) : 1;
  const candidateLimit = org.plan === 'enterprise' ? 'Unlimited' : org.plan === 'growth' ? 'Unlimited' : 10;
  const price = org.plan === 'enterprise' ? '$199 / month' : org.plan === 'growth' ? `$${(org.jobsPurchased || 5) * 10} / month ($10/job)` : '₹0 (7-day trial)';

  return res.json({
    organization: org,
    subscription: {
      plan: org.plan,
      tierName: org.plan === 'enterprise' ? 'Enterprise Scaler' : org.plan === 'growth' ? 'Growth Pro' : 'Free Trial',
      status: trialExpired ? 'Expired' : 'Active',
      price,
      jobsPurchased,
      isTrial,
      trialDaysRemaining,
      trialExpired,
      trialEndsAt: org.trialEndsAt || trialEnd.toISOString(),
      billingCycle: org.plan === 'growth' ? 'Monthly ($10/job)' : org.plan === 'enterprise' ? 'Annual' : '7-Day Trial',
      jobLimit,
      activeJobsCount: metrics.activeJobs,
      candidateLimit,
      totalCandidatesCount: metrics.totalCandidates,
      featuresIncluded: [
        'Multi-Board Job Distribution (LinkedIn & Career Pages)',
        'Kanban Stage Progression & Drag/Drop',
        'Direct Resume Ingestion & Applicant Matching',
        'Interview Scheduler & Google Meet Sync',
        '5-Star Interview Scorecards & Team Consensus',
        'Connected Recruiter Email Hub (SMTP/IMAP)',
        'Custom Branded Career Page URL',
        'AI Recruiter Automated Video Screening (Beta Access)'
      ]
    },
    referralProgram: {
      referralCode: `TALENT-${org.slug.toUpperCase().substring(0, 6)}`,
      shareUrl: `https://hiredeskhr.com/r/${org.slug}`,
      totalReferrals: 14,
      successfulConversions: 5,
      creditsEarned: '₹25,000 / $300 Credits',
      status: 'Gold Ambassador'
    },
    partnerProgram: {
      isPartner: true,
      partnerTier: 'Certified Talent Solutions Partner',
      commissionRate: '20% Recurring Revenue Share',
      partnerDashboardUrl: `https://partners.hiredeskhr.com/portal/${org.slug}`
    },
    careerPage: {
      enabled: true,
      publicUrl: `/careers/${org.slug}`,
      companyName: org.name,
      slug: org.slug,
      tagline: org.tagline,
      cultureText: org.cultureText,
      banner: org.banner,
      logo: org.logo
    }
  });
});

// Update Career Page configuration
settingsRouter.patch('/career-page', (req, res) => {
  const orgId = getOrgId(req);
  const org = store.organizations.find(o => o.id === orgId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const { tagline, cultureText, banner, logo } = req.body;
  if (tagline !== undefined) org.tagline = tagline;
  if (cultureText !== undefined) org.cultureText = cultureText;
  if (banner !== undefined) org.banner = banner;
  if (logo !== undefined) org.logo = logo;

  return res.json({
    message: 'Career page configuration updated successfully',
    careerPage: {
      publicUrl: `/careers/${org.slug}`,
      companyName: org.name,
      slug: org.slug,
      tagline: org.tagline,
      cultureText: org.cultureText,
      banner: org.banner,
      logo: org.logo
    }
  });
});

// Upgrade plan
settingsRouter.post('/upgrade', (req, res) => {
  const orgId = getOrgId(req);
  const org = store.organizations.find(o => o.id === orgId);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }
  const { plan, jobsPurchased } = req.body;

  if (!plan || !['free', 'growth', 'enterprise'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan selected. Must be free, growth, or enterprise.' });
  }

  if (plan === 'growth') {
    const jobs = Number(jobsPurchased) || (org.jobsPurchased || 5);
    if (jobs < 5) {
      return res.status(400).json({
        error: 'Growth Pro requires a minimum purchase of 5 jobs ($50/month). You cannot purchase fewer than 5 jobs.',
        code: 'MINIMUM_PURCHASE_REQUIRED',
        minimumJobs: 5
      });
    }
    org.plan = 'growth';
    org.jobsPurchased = jobs;
  } else if (plan === 'free') {
    org.plan = 'free';
    const now = new Date();
    org.trialStartedAt = now.toISOString();
    org.trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (plan === 'enterprise') {
    org.plan = 'enterprise';
  }

  store.save();

  return res.json({
    message: `Plan successfully updated to ${org.plan.toUpperCase()}`,
    organization: org,
    calculatedPrice: org.plan === 'growth' ? (org.jobsPurchased || 5) * 10 : org.plan === 'enterprise' ? 199 : 0
  });
});

import fs from 'fs';
import path from 'path';
import { envFilePath } from '../config/loadEnv';
import { whatsappConfig, resolveWaCreds } from '../services/whatsappService';

function updateEnvFile(updates: Record<string, string>) {
  try {
    const envPath = envFilePath();
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
    for (const [key, val] of Object.entries(updates)) {
      process.env[key] = val;
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${val}`);
      } else {
        content += `\n${key}=${val}`;
      }
    }
    fs.writeFileSync(envPath, content.trim() + '\n', 'utf-8');
    console.log(`[SETTINGS] Updated ${envPath} and process.env with keys: ${Object.keys(updates).join(', ')}`);
  } catch (err: any) {
    console.warn('[SETTINGS] Could not write to .env:', err.message);
  }
}

// GET Integrations Status (Elastic Email, SMTP & WhatsApp)
settingsRouter.get('/integrations', (req, res) => {
  const mail = resolveEmailCreds();
  const wa = resolveWaCreds();
  const isConfigured = mail.elasticConfigured;
  const keyLength = emailConfig.elasticEmailApiKey?.trim().length || 0;
  const maskedKey = isConfigured
    ? `${emailConfig.elasticEmailApiKey.trim().substring(0, 4)}...${emailConfig.elasticEmailApiKey.trim().substring(keyLength - 4)}`
    : '';

  const isSmtpConfigured = mail.smtpConfigured;
  const isWhatsAppConfigured = wa.anyConfigured;

  return res.json({
    elasticEmailApiKeyConfigured: isConfigured,
    elasticEmailApiKeyMasked: maskedKey,
    recruiterNotificationEmail: emailConfig.recruiterNotificationEmail || '',
    fromEmail: emailConfig.fromEmail,
    fromName: emailConfig.fromName,
    smtpHost: mail.smtpHost,
    smtpPort: mail.smtpPort,
    smtpUser: mail.smtpUser,
    smtpConfigured: isSmtpConfigured,
    whatsappConfigured: isWhatsAppConfigured,
    whatsappPhoneId: wa.phoneId || '',
    whatsappOtpTemplate: wa.otpTemplate || '',
    whatsappOtpTemplateLang: wa.otpTemplateLang,
    ultraMsgInstanceId: wa.ultraMsgInstanceId || ''
  });
});

// Update Integrations (Save Elastic Email API key, SMTP credentials & WhatsApp tokens)
settingsRouter.post('/integrations', (req, res) => {
  const {
    elasticEmailApiKey,
    recruiterNotificationEmail,
    fromEmail,
    fromName,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    whatsappApiToken,
    whatsappPhoneId,
    whatsappOtpTemplate,
    whatsappOtpTemplateLang,
    ultraMsgInstanceId,
    ultraMsgToken
  } = req.body;

  const envUpdates: Record<string, string> = {};

  if (elasticEmailApiKey !== undefined) {
    emailConfig.elasticEmailApiKey = elasticEmailApiKey.trim();
    envUpdates['ELASTIC_EMAIL_API_KEY'] = elasticEmailApiKey.trim();
  }
  if (recruiterNotificationEmail !== undefined && recruiterNotificationEmail.includes('@')) {
    emailConfig.recruiterNotificationEmail = recruiterNotificationEmail.trim();
    envUpdates['RECRUITER_NOTIFICATION_EMAIL'] = recruiterNotificationEmail.trim();
  }
  if (fromEmail !== undefined && fromEmail.trim().length > 0) {
    emailConfig.fromEmail = fromEmail.trim();
    envUpdates['FROM_EMAIL'] = fromEmail.trim();
  }
  if (fromName !== undefined && fromName.trim().length > 0) {
    emailConfig.fromName = fromName.trim();
    envUpdates['FROM_NAME'] = fromName.trim();
  }
  if (smtpHost !== undefined && smtpHost.trim().length > 0) {
    emailConfig.smtpHost = smtpHost.trim();
    envUpdates['SMTP_HOST'] = smtpHost.trim();
  }
  if (smtpPort !== undefined) {
    emailConfig.smtpPort = Number(smtpPort) || 465;
    envUpdates['SMTP_PORT'] = String(emailConfig.smtpPort);
  }
  if (smtpUser !== undefined) {
    emailConfig.smtpUser = smtpUser.trim();
    envUpdates['SMTP_USER'] = smtpUser.trim();
  }
  if (smtpPass !== undefined) {
    emailConfig.smtpPass = smtpPass.trim();
    envUpdates['SMTP_PASS'] = smtpPass.trim();
  }
  if (whatsappApiToken !== undefined) {
    whatsappConfig.apiToken = whatsappApiToken.trim();
    envUpdates['WHATSAPP_API_TOKEN'] = whatsappApiToken.trim();
  }
  if (whatsappPhoneId !== undefined) {
    whatsappConfig.phoneId = whatsappPhoneId.trim();
    envUpdates['WHATSAPP_PHONE_ID'] = whatsappPhoneId.trim();
  }
  if (whatsappOtpTemplate !== undefined) {
    whatsappConfig.otpTemplate = whatsappOtpTemplate.trim();
    envUpdates['WHATSAPP_OTP_TEMPLATE'] = whatsappOtpTemplate.trim();
  }
  if (whatsappOtpTemplateLang !== undefined && whatsappOtpTemplateLang.trim()) {
    whatsappConfig.otpTemplateLang = whatsappOtpTemplateLang.trim();
    envUpdates['WHATSAPP_OTP_TEMPLATE_LANG'] = whatsappOtpTemplateLang.trim();
  }
  if (ultraMsgInstanceId !== undefined) {
    whatsappConfig.ultraMsgInstanceId = ultraMsgInstanceId.trim();
    envUpdates['ULTRAMSG_INSTANCE_ID'] = ultraMsgInstanceId.trim();
  }
  if (ultraMsgToken !== undefined) {
    whatsappConfig.ultraMsgToken = ultraMsgToken.trim();
    envUpdates['ULTRAMSG_TOKEN'] = ultraMsgToken.trim();
  }

  updateEnvFile(envUpdates);
  // Credentials changed - drop any pooled SMTP connections using the old ones.
  resetTransporters();

  const isConfigured = !!(
    (emailConfig.elasticEmailApiKey && emailConfig.elasticEmailApiKey.trim().length > 10) ||
    (emailConfig.smtpUser && emailConfig.smtpPass)
  );

  console.log(`✅ [SETTINGS] Updated Email & WhatsApp settings! Email configured: ${isConfigured}, Recruiter Email: ${emailConfig.recruiterNotificationEmail}`);

  return res.json({
    success: true,
    message: 'Integration credentials saved and persisted to .env successfully!',
    elasticEmailApiKeyConfigured: isConfigured,
    recruiterNotificationEmail: emailConfig.recruiterNotificationEmail,
    fromEmail: emailConfig.fromEmail,
    fromName: emailConfig.fromName,
    smtpConfigured: !!(emailConfig.smtpUser && emailConfig.smtpPass),
    whatsappConfigured: !!((whatsappConfig.apiToken && whatsappConfig.phoneId) || (whatsappConfig.ultraMsgInstanceId && whatsappConfig.ultraMsgToken))
  });
});

// Dispatch live Test Email using Elastic Email API
settingsRouter.post('/test-elastic-email', async (req, res) => {
  const { testEmail, apiKey } = req.body;
  const targetEmail = (testEmail || emailConfig.recruiterNotificationEmail || 'admin@hiredeskhr.com').trim();

  if (apiKey && apiKey.trim().length > 0) {
    emailConfig.elasticEmailApiKey = apiKey.trim();
  }

  const emailService = new EmailService();
  try {
    const result = await emailService.sendEmail({
      to: targetEmail,
      subject: `⚡ [TEST DISPATCH] Elastic Email Verified - HiredeskHR`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8fafc;">
          <div style="background: #ffffff; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <div style="display: inline-block; padding: 6px 12px; background: #ccfbf1; color: #0f766e; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 16px;">
              ⚡ Elastic Email Integration Active
            </div>
            <h1 style="color: #0f172a; font-size: 22px; font-weight: 800; margin: 0 0 12px 0;">Live Email Dispatch Confirmed!</h1>
            <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
              Hello Recruiter, your Elastic Email API Key is fully operational for <strong>HiredeskHR</strong>.
            </p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px; margin: 20px 0;">
              <p style="margin: 0; color: #166534; font-weight: bold; font-size: 14px;">✓ Outbound Delivery Channel Verified</p>
              <p style="margin: 6px 0 0 0; color: #15803d; font-size: 13px;">Target Notification Email: <strong>${targetEmail}</strong></p>
              <p style="margin: 4px 0 0 0; color: #15803d; font-size: 12px;">Timestamp: ${new Date().toLocaleString()}</p>
            </div>
            <div style="background: #f8fafc; border-radius: 12px; padding: 16px; margin: 20px 0; border: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: bold; color: #334155;">Automation is live for:</p>
              <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #64748b; line-height: 1.6;">
                <li>Real-time candidate application alerts</li>
                <li>Inbound resume parsing from business email into ATS database</li>
                <li>Candidate & client OTP verification codes</li>
              </ul>
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
              HiredeskHR • Automated Talent Acquisition Platform
            </p>
          </div>
        </div>
      `,
      text: `Live Email Dispatch Confirmed! Your Elastic Email API is operational. Recipient: ${targetEmail}`
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      provider: 'elastic-email',
      message: err.message || 'Failed to dispatch test email'
    });
  }
});
