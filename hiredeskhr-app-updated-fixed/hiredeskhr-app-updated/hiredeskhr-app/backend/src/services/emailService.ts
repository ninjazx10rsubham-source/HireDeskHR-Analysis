import { loadEnv, cleanSecret } from '../config/loadEnv';
loadEnv();

import crypto from 'crypto';
import nodemailer, { Transporter } from 'nodemailer';
import { Candidate, Job } from '../types';

export interface EmailOptions {
  to: string;
  cc?: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
}

export interface EmailServiceConfig {
  elasticEmailApiKey: string;
  recruiterNotificationEmail: string;
  fromEmail: string;
  fromName: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
}

export type EmailProvider = 'elastic-email' | 'smtp' | 'unconfigured' | 'simulated';

export interface EmailResult {
  success: boolean;
  provider: EmailProvider;
  messageId?: string;
  message: string;
  /** Machine-readable reason so the UI can render a precise fix. */
  code?: string;
  /** Concrete next step the developer should take. */
  hint?: string;
  to?: string;
}

/**
 * Runtime configuration. Anything saved through the Settings UI lands here and
 * takes PRECEDENCE over .env, so a freshly-pasted app password works instantly
 * without a server restart.
 */
export const emailConfig: EmailServiceConfig = {
  elasticEmailApiKey: cleanSecret(process.env.ELASTIC_EMAIL_API_KEY),
  recruiterNotificationEmail: process.env.RECRUITER_NOTIFICATION_EMAIL || 'admin@hiredeskhr.com',
  fromEmail: process.env.FROM_EMAIL || process.env.SMTP_USER || '',
  fromName: process.env.FROM_NAME || 'HiredeskHR',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: Number(process.env.SMTP_PORT) || 465,
  smtpUser: (process.env.SMTP_USER || '').trim(),
  smtpPass: cleanSecret(process.env.SMTP_PASS)
};

export interface ResolvedEmailCreds {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  fromName: string;
  elasticApiKey: string;
  smtpConfigured: boolean;
  elasticConfigured: boolean;
  anyConfigured: boolean;
}

/**
 * Single source of truth for credentials.
 * Runtime config (Settings UI) first, then process.env.
 */
export function resolveEmailCreds(): ResolvedEmailCreds {
  const smtpUser = (emailConfig.smtpUser || process.env.SMTP_USER || '').trim();
  const smtpPass = cleanSecret(emailConfig.smtpPass) || cleanSecret(process.env.SMTP_PASS);
  const smtpHost = (emailConfig.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const smtpPort = Number(emailConfig.smtpPort || process.env.SMTP_PORT || 465);
  const fromEmail = (emailConfig.fromEmail || process.env.FROM_EMAIL || smtpUser).trim();
  const fromName = (emailConfig.fromName || process.env.FROM_NAME || 'HiredeskHR').trim();
  const elasticApiKey = cleanSecret(emailConfig.elasticEmailApiKey) || cleanSecret(process.env.ELASTIC_EMAIL_API_KEY);

  const smtpConfigured = Boolean(smtpUser && smtpPass);
  const elasticConfigured = Boolean(elasticApiKey && elasticApiKey.length > 10);

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromEmail,
    fromName,
    elasticApiKey,
    smtpConfigured,
    elasticConfigured,
    anyConfigured: smtpConfigured || elasticConfigured
  };
}

/** Gmail app passwords are 16 chars; users often paste them with spaces. */
function normalizeAppPassword(pass: string): string {
  return pass.replace(/\s+/g, '');
}

/**
 * Turn a raw SMTP/nodemailer error into something a human can act on.
 * This is the difference between "Gmail SMTP dispatch failed: Invalid login"
 * and "your App Password is wrong - generate a new one at <url>".
 */
export function explainSmtpError(err: any, creds: ResolvedEmailCreds): { code: string; hint: string } {
  const raw = `${err?.code || ''} ${err?.responseCode || ''} ${err?.message || ''}`.toLowerCase();

  if (raw.includes('invalid login') || raw.includes('username and password not accepted') || err?.code === 'EAUTH' || err?.responseCode === 535) {
    if (creds.smtpHost.includes('gmail')) {
      return {
        code: 'SMTP_AUTH_FAILED',
        hint:
          `Gmail rejected the login for ${creds.smtpUser}. This is almost always the App Password. ` +
          `Make sure 2-Step Verification is ON, then create a NEW 16-character App Password at ` +
          `https://myaccount.google.com/apppasswords and put it in SMTP_PASS (spaces are fine, they are stripped). ` +
          `Your normal Gmail password will never work here.`
      };
    }
    return {
      code: 'SMTP_AUTH_FAILED',
      hint: `The SMTP server rejected the username/password for ${creds.smtpUser}. Double-check SMTP_USER and SMTP_PASS.`
    };
  }

  if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKET' || err?.code === 'ECONNECTION' || raw.includes('timeout')) {
    return {
      code: 'SMTP_CONNECTION_FAILED',
      hint:
        `Could not reach ${creds.smtpHost}:${creds.smtpPort}. Many networks (college Wi-Fi, office firewalls, ` +
        `some cloud hosts) block outbound port 465. Try SMTP_PORT=587, or switch to the Elastic Email REST API ` +
        `(ELASTIC_EMAIL_API_KEY), which works over plain HTTPS.`
    };
  }

  if (err?.code === 'EDNS' || raw.includes('getaddrinfo') || raw.includes('enotfound')) {
    return {
      code: 'SMTP_HOST_NOT_FOUND',
      hint: `The hostname "${creds.smtpHost}" could not be resolved. For Gmail it must be exactly smtp.gmail.com.`
    };
  }

  if (raw.includes('self signed') || raw.includes('certificate')) {
    return {
      code: 'SMTP_TLS_ERROR',
      hint: `TLS handshake failed against ${creds.smtpHost}. If you are behind a corporate proxy, try SMTP_PORT=587.`
    };
  }

  if (raw.includes('ratelimit') || raw.includes('rate limit') || err?.responseCode === 451) {
    return {
      code: 'SMTP_RATE_LIMITED',
      hint: `Hostinger SMTP rate limit reached. Hostinger limits outbound emails per minute. Please wait 60 seconds before retrying.`
    };
  }

  return {
    code: 'SMTP_SEND_FAILED',
    hint: `SMTP send failed: ${err?.message || 'unknown error'}. Run "npm run verify:otp" for a full diagnostic.`
  };
}

/** Cached transporters keyed by host:port:user so we don't reconnect per OTP. */
const transporterCache = new Map<string, Transporter>();

function getTransporter(creds: ResolvedEmailCreds, port: number, secure: boolean): Transporter {
  const key = `${creds.smtpHost}:${port}:${creds.smtpUser}:${normalizeAppPassword(creds.smtpPass).slice(-4)}`;
  const cached = transporterCache.get(key);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: creds.smtpHost,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: creds.smtpUser,
      pass: normalizeAppPassword(creds.smtpPass)
    },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15000,
    greetingTimeout: 12000,
    socketTimeout: 25000
  });

  transporterCache.set(key, transporter);
  return transporter;
}

/** Called by the Settings route whenever credentials change. */
export function resetTransporters() {
  transporterCache.forEach((t) => {
    try {
      (t as any).close?.();
    } catch {
      /* ignore */
    }
  });
  transporterCache.clear();
}

export class EmailService {
  /**
   * Verify the SMTP credentials without sending anything.
   * Used by the setup wizard and the /api/auth/delivery-status endpoint.
   */
  async verifySmtp(): Promise<{ ok: boolean; message: string; code?: string; hint?: string }> {
    const creds = resolveEmailCreds();
    if (!creds.smtpConfigured) {
      return {
        ok: false,
        code: 'SMTP_NOT_CONFIGURED',
        message: 'SMTP_USER / SMTP_PASS are not set.',
        hint: 'Run "npm run setup:otp" from the project root, or paste an App Password in Settings -> Integrations.'
      };
    }

    const ports: Array<{ port: number; secure: boolean }> =
      creds.smtpPort === 587
        ? [{ port: 587, secure: false }, { port: 465, secure: true }]
        : [{ port: 465, secure: true }, { port: 587, secure: false }];

    let lastErr: any = null;
    for (const p of ports) {
      try {
        await getTransporter(creds, p.port, p.secure).verify();
        return { ok: true, message: `SMTP credentials verified against ${creds.smtpHost}:${p.port} as ${creds.smtpUser}.` };
      } catch (err: any) {
        lastErr = err;
        // Auth failures will not be fixed by trying another port.
        if (err?.code === 'EAUTH' || err?.responseCode === 535) break;
      }
    }

    const explained = explainSmtpError(lastErr, creds);
    return { ok: false, message: lastErr?.message || 'SMTP verification failed', ...explained };
  }

  /**
   * Send an email via SMTP (primary) or the Elastic Email REST API (fallback).
   * The recipient is ALWAYS options.to - never a hardcoded address.
   */
  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    const to = (options.to || '').trim();
    // Emoji and ALL-CAPS in subject lines are strong spam-filter signals -
    // strip them here so every call site is protected even if a template forgets.
    const subject = (options.subject || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
    const html = options.html;
    const text = options.text || options.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!to || !to.includes('@')) {
      return {
        success: false,
        provider: 'unconfigured',
        code: 'INVALID_RECIPIENT',
        message: `Refusing to send: "${to}" is not a valid recipient address.`,
        to
      };
    }

    const creds = resolveEmailCreds();
    const from = (options.from || creds.fromEmail || creds.smtpUser).trim();
    const fromName = options.fromName || creds.fromName;
    const fromDomain = from.includes('@') ? from.split('@')[1] : 'hiredeskhr.com';
    const customMessageId = `<${Date.now()}.${crypto.randomBytes(8).toString('hex')}@${fromDomain}>`;

    console.log(`[EMAIL] -> ${to} | smtp=${creds.smtpConfigured} elastic=${creds.elasticConfigured} host=${creds.smtpHost}:${creds.smtpPort} user=${creds.smtpUser || '(none)'}`);

    // ---- 1. SMTP (Gmail / any relay) -------------------------------------
    if (creds.smtpConfigured) {
      const attempts: Array<{ port: number; secure: boolean }> =
        creds.smtpPort === 587
          ? [{ port: 587, secure: false }, { port: 465, secure: true }]
          : [{ port: 465, secure: true }, { port: 587, secure: false }];

      let lastErr: any = null;
      for (const attempt of attempts) {
        try {
          const allRecipients = options.cc
            ? [to, ...(Array.isArray(options.cc) ? options.cc : [options.cc])]
            : to;

          const info = await getTransporter(creds, attempt.port, attempt.secure).sendMail({
            from: `"${fromName}" <${from}>`,
            to,
            cc: options.cc,
            replyTo: options.from || from,
            envelope: {
              from,
              to: allRecipients
            },
            messageId: customMessageId,
            subject,
            text,
            html,
            headers: {
              'Auto-Submitted': 'auto-generated',
              'X-Auto-Response-Suppress': 'All',
              'X-Entity-Ref-ID': `hiredeskhr-${Date.now()}`,
              'X-Priority': '1',
              'Importance': 'high',
              'Precedence': 'transactional'
            }
          });

          console.log(`[EMAIL] delivered to ${to} via ${creds.smtpHost}:${attempt.port} (id ${info.messageId})`);
          return {
            success: true,
            provider: 'smtp',
            messageId: info.messageId,
            to,
            message: `Email delivered to ${to} via ${creds.smtpHost}:${attempt.port}.`
          };
        } catch (err: any) {
          lastErr = err;
          console.error(`[EMAIL] attempt on port ${attempt.port} failed: ${err?.message}`);
          if (err?.code === 'EAUTH' || err?.responseCode === 535 || err?.responseCode === 451) break; // no point retrying on auth failure or mailbox rate limit
        }
      }

      const explained = explainSmtpError(lastErr, creds);

      // If Elastic Email is also configured, fall through to it rather than failing.
      if (!creds.elasticConfigured) {
        return {
          success: false,
          provider: 'smtp',
          to,
          message: `SMTP delivery to ${to} failed: ${lastErr?.message || 'unknown error'}`,
          ...explained
        };
      }
      console.warn('[EMAIL] SMTP failed, falling back to Elastic Email...');
    }

    // ---- 2. Elastic Email REST API ---------------------------------------
    if (creds.elasticConfigured) {
      try {
        const params = new URLSearchParams({
          apikey: creds.elasticApiKey,
          to,
          subject,
          from,
          fromName,
          bodyHtml: html,
          bodyText: text,
          isTransactional: 'true'
        });

        const response = await fetch('https://api.elasticemail.com/v2/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });

        const result: any = await response.json();

        if (result.success) {
          console.log(`[EMAIL] delivered to ${to} via Elastic Email (${result.data?.transactionid})`);
          return {
            success: true,
            provider: 'elastic-email',
            messageId: result.data?.messageid || result.data?.transactionid,
            to,
            message: `Email delivered to ${to} via Elastic Email.`
          };
        }

        return {
          success: false,
          provider: 'elastic-email',
          to,
          code: 'ELASTIC_REJECTED',
          message: `Elastic Email rejected the request: ${result.error || 'unknown error'}`,
          hint: `Check that the API key is valid and that "${from}" is a verified sender/domain in your Elastic Email account.`
        };
      } catch (err: any) {
        return {
          success: false,
          provider: 'elastic-email',
          to,
          code: 'ELASTIC_NETWORK_ERROR',
          message: `Network error contacting Elastic Email: ${err.message}`,
          hint: 'Check outbound internet access from the backend host.'
        };
      }
    }

    // ---- 3. Nothing configured -------------------------------------------
    console.warn(
      `\n[EMAIL NOT CONFIGURED] Wanted to send to ${to} but no provider is set up.\n` +
        `  Fix: run "npm run setup:otp" from the project root (takes ~2 minutes),\n` +
        `  or set SMTP_PASS (Gmail App Password) in backend/.env.\n`
    );

    return {
      success: false,
      provider: 'unconfigured',
      to,
      code: 'EMAIL_NOT_CONFIGURED',
      message: `No email provider is configured, so nothing was sent to ${to}.`,
      hint: 'Run "npm run setup:otp" in the project root, or set SMTP_USER + SMTP_PASS in backend/.env.'
    };
  }

  /**
   * Dispatch 6-digit OTP verification code & magic link to user email
   */
  async sendOtpEmail(email: string, otp: string, verificationLink?: string) {
    const subject = `${otp} is your HireDeskHR verification code`;

    const sanitizedLink = (verificationLink && verificationLink.startsWith('https://') && !verificationLink.includes('localhost') && !verificationLink.includes('127.0.0.1'))
      ? verificationLink
      : '';

    const text = [
      'HireDeskHR Verification Code',
      '',
      'Hello,',
      '',
      `Your verification code is: ${otp}`,
      '',
      'This code is valid for 10 minutes strictly for your email address. For security reasons, do not share this code with anyone.',
      ...(sanitizedLink ? ['', 'Or click the following link to verify directly:', sanitizedLink] : []),
      '',
      'If you did not request this verification code, please ignore this email. No changes will be made to your account.',
      '',
      '---',
      'HireDeskHR Security Team',
      'https://hiredeskhr.com',
      'admin@hiredeskhr.com'
    ].join('\n');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${otp} is your HireDeskHR verification code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <!-- Preview Text (Preheader) -->
  <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; max-width: 0px; opacity: 0;">
    Your HireDeskHR verification code is ${otp}. Valid for 10 minutes.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; border-bottom: 1px solid #f1f5f9; background-color: #ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">HireDeskHR</h1>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">Applicant Tracking &amp; Technical Recruitment</p>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <span style="display: inline-block; background-color: #f0fdfa; color: #0d9488; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; border: 1px solid #ccfbf1; text-transform: uppercase; letter-spacing: 0.5px;">Verification</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">Hello,</p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                We received a verification request for your account (<strong style="color: #0f172a;">${email}</strong>). Please use the 6-digit code below to complete your authentication:
              </p>

              <!-- OTP Code Display -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
                <tr>
                  <td align="center">
                    <div style="background-color: #f8fafc; border: 2px dashed #0d9488; border-radius: 12px; padding: 18px 32px; display: inline-block;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0d9488; display: block; line-height: 1.2;">${otp}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 12px;">
                    <span style="font-size: 13px; color: #64748b; font-weight: 500;">⏱️ Valid for 10 minutes strictly</span>
                  </td>
                </tr>
              </table>

              ${sanitizedLink ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0 28px 0;">
                <tr>
                  <td align="center">
                    <a href="${sanitizedLink}" style="display: inline-block; background-color: #0d9488; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 700; padding: 12px 32px; border-radius: 8px;">
                      1-Click Instant Sign In
                    </a>
                  </td>
                </tr>
              </table>
              ` : ''}

              <!-- Security Notice -->
              <div style="background-color: #f8fafc; border-left: 3px solid #0d9488; padding: 14px 16px; border-radius: 4px; margin-top: 24px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #475569;">
                  <strong>Security Note:</strong> Never share this code with anyone. HireDeskHR staff will never ask you for your verification code or password.
                </p>
              </div>

              <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                If you did not request this verification code, you can safely ignore this email. No changes will be made to your account.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b;">
                Sent by <strong>HireDeskHR</strong> &bull; High-Performance Recruitment Platform
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} HireDeskHR. All rights reserved. &bull; <a href="mailto:admin@hiredeskhr.com" style="color: #64748b; text-decoration: underline;">admin@hiredeskhr.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    return this.sendEmail({
      to: email,
      subject,
      text,
      html
    });
  }

  /**
   * Alert the recruiter whenever a new candidate applies to a job opening
   */
  async sendCandidateAppliedNotification(recruiterEmail: string, candidate: Candidate, job: Job) {
    const candidateFullName = `${candidate.firstName} ${candidate.lastName}`.trim();
    const subject = `⚡ New Candidate Applied: ${candidateFullName} for ${job.title}`;
    const appBaseUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
    const isPublicHttps = appBaseUrl.startsWith('https://') && !appBaseUrl.includes('localhost') && !appBaseUrl.includes('127.0.0.1');
    const dashboardUrl = isPublicHttps ? `${appBaseUrl}/admin` : 'https://hiredeskhr.com/admin';

    const text = [
      `New Candidate Applied: ${candidateFullName} for ${job.title}`,
      `Job Requisition: ${job.title} (${job.clientName})`,
      '',
      'Candidate Profile:',
      `- Full Name: ${candidateFullName}`,
      `- Email: ${candidate.email}`,
      `- Phone: ${candidate.phone || 'Not specified'}`,
      `- Location: ${candidate.location || 'Bangalore, India'}`,
      `- Experience: ${candidate.totalExperience || 'Experienced'}`,
      `- Match Score: ${candidate.matchScore}% Match`,
      `- Resume: ${candidate.resumeFileName || 'Resume.pdf'}`,
      '',
      `Open Candidate in ATS: ${dashboardUrl}`,
      '',
      'Automated notification from HireDeskHR (admin@hiredeskhr.com)'
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
          <span style="font-size: 11px; font-weight: 800; color: #0d9488; text-transform: uppercase; letter-spacing: 1px;">New Application Alert</span>
          <h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 22px; font-weight: 800;">Candidate Applied: ${candidateFullName}</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Job Requisition: <strong>${job.title}</strong> (${job.clientName})</p>
        </div>

        <div style="padding: 20px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; color: #0f172a; font-size: 14px;">Candidate Profile Details:</h4>
          
          <table style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 140px;">Full Name:</td>
              <td style="padding: 6px 0; font-weight: 700;">${candidateFullName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Email Address:</td>
              <td style="padding: 6px 0; font-weight: 700;"><a href="mailto:${candidate.email}" style="color: #0d9488;">${candidate.email}</a></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Phone Number:</td>
              <td style="padding: 6px 0; font-weight: 700;">${candidate.phone || 'Not specified'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Location:</td>
              <td style="padding: 6px 0;">${candidate.location || 'Bangalore, India'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Experience:</td>
              <td style="padding: 6px 0;">${candidate.totalExperience || 'Experienced'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">AI Match Score:</td>
              <td style="padding: 6px 0; font-weight: 800; color: #0d9488;">${candidate.matchScore}% Match</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Attached Resume:</td>
              <td style="padding: 6px 0; font-weight: 700; color: #4338ca;">${candidate.resumeFileName || 'Resume.pdf'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Pipeline Stage:</td>
              <td style="padding: 6px 0;"><span style="background-color: #f0fdf4; color: #15803d; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 11px;">Applied</span></td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${dashboardUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 12px 24px; border-radius: 10px;">
            Open Candidate in ATS Dashboard
          </a>
        </div>

        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          This is an automated recruitment dispatch from HireDeskHR.
        </p>
      </div>
    `;

    return this.sendEmail({
      to: recruiterEmail || emailConfig.recruiterNotificationEmail,
      subject,
      text,
      html
    });
  }

  /**
   * Alert the admin inbox whenever a new job requisition is posted (by anyone
   * on the team, or a client). This is what makes "a job was posted" actually
   * land in admin@hiredeskhr.com instead of only appearing in the dashboard.
   */
  async sendJobPostedNotification(adminEmail: string, job: Job) {
    const posted = new Date(job.createdAt);
    const escapeHtml = (value: unknown) => String(value ?? 'Not provided')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const formatList = (values?: string[]) => values?.length ? values.map(escapeHtml).join('<br>') : 'Not provided';
    const salary = job.salaryMin !== undefined || job.salaryMax !== undefined
      ? `${job.currency} ${job.salaryMin ?? '-'} - ${job.salaryMax ?? '-'}`
      : 'Not provided';
    const subject = `New Job Posted: ${job.title} - ${job.clientName} (${job.jobCode})`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px;">
          <span style="font-size: 11px; font-weight: 800; color: #0d9488; text-transform: uppercase; letter-spacing: 1px;">New Job Posted</span>
          <h2 style="color: #0f172a; margin: 6px 0 0 0; font-size: 20px; font-weight: 800;">${job.title}</h2>
          <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Posted by: <strong>${escapeHtml(job.clientName)}</strong> &middot; Job ID: <strong>${escapeHtml(job.jobCode)}</strong></p>
        </div>

        <table style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 6px 0; color: #64748b; width: 140px;">Company:</td><td style="padding: 6px 0; font-weight: 700;">${escapeHtml(job.clientName)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Company Email:</td><td style="padding: 6px 0;">${escapeHtml(job.clientEmail)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Department:</td><td style="padding: 6px 0;">${escapeHtml(job.department)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Location:</td><td style="padding: 6px 0;">${escapeHtml(job.location)} (${escapeHtml(job.workplaceType)})</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Employment Type:</td><td style="padding: 6px 0;">${escapeHtml(job.employmentType)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Salary:</td><td style="padding: 6px 0;">${escapeHtml(salary)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Experience:</td><td style="padding: 6px 0;">${job.experienceMin ?? '-'} - ${job.experienceMax ?? '-'} years</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Skills:</td><td style="padding: 6px 0;">${formatList(job.skills)}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Openings:</td><td style="padding: 6px 0;">${job.openingsCount}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Posted Date:</td><td style="padding: 6px 0;">${posted.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Posted Time:</td><td style="padding: 6px 0;">${posted.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</td></tr>
        </table>

        <h3 style="color: #0f172a; font-size: 15px;">Job Description</h3>
        <div style="white-space: pre-wrap; color: #334155; line-height: 1.6;">${escapeHtml(job.description)}</div>
        <h3 style="color: #0f172a; font-size: 15px;">Requirements</h3>
        <div style="color: #334155; line-height: 1.6;">${formatList(job.requirements)}</div>

        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          Automated notification from HireDeskHR. Sign in to your dashboard to review or edit this requisition.
        </p>
      </div>
    `;

    const text = [
      `New Job Posted: ${job.title} - ${job.clientName} (${job.jobCode})`,
      '',
      `Company: ${job.clientName}`,
      `Company Email: ${job.clientEmail || 'Not provided'}`,
      `Department: ${job.department}`,
      `Location: ${job.location} (${job.workplaceType})`,
      `Employment Type: ${job.employmentType}`,
      `Salary: ${salary}`,
      `Experience: ${job.experienceMin ?? '-'} - ${job.experienceMax ?? '-'} years`,
      `Openings: ${job.openingsCount}`,
      `Posted: ${posted.toLocaleDateString('en-IN')}`,
      '',
      'Job Description:',
      job.description,
      '',
      'Automated notification from HireDeskHR (admin@hiredeskhr.com)'
    ].join('\n');

    return this.sendEmail({
      to: adminEmail || emailConfig.recruiterNotificationEmail,
      subject,
      text,
      html
    });
  }

  /**
   * Alert the recruiter when an inbound email with resume is parsed and saved to database
   */
  async sendInboundResumeIngestedNotification(
    recruiterEmail: string,
    candidate: Candidate,
    job: Job,
    resumeName: string
  ) {
    const candidateFullName = `${candidate.firstName} ${candidate.lastName}`.trim();
    const subject = `📥 Resume Saved to Database: ${candidateFullName} (${job.title})`;

    const text = [
      `Resume Saved to Database: ${candidateFullName} (${job.title})`,
      '',
      `Candidate: ${candidateFullName} (${candidate.email})`,
      `Target Job: ${job.title}`,
      `Resume Attached: ${resumeName}`,
      'Stage in Database: Applied',
      '',
      'You can now review the candidate profile in the ATS dashboard.',
      '',
      'Automated notification from HireDeskHR (admin@hiredeskhr.com)'
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
        <div style="margin-bottom: 20px;">
          <span style="font-size: 11px; font-weight: 800; color: #7c3aed; text-transform: uppercase;">Inbound Email Automation</span>
          <h2 style="color: #0f172a; margin: 4px 0; font-size: 20px; font-weight: 800;">Resume Attached to Job Pipeline</h2>
          <p style="color: #64748b; font-size: 12px; margin: 0;">The automation parsed an incoming application email and deposited the candidate into your ATS database.</p>
        </div>

        <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 12px; padding: 16px; margin-bottom: 20px; font-size: 13px; color: #581c87;">
          <p style="margin: 0 0 8px 0;"><strong>Candidate:</strong> ${candidateFullName} (${candidate.email})</p>
          <p style="margin: 0 0 8px 0;"><strong>Target Job:</strong> ${job.title}</p>
          <p style="margin: 0 0 8px 0;"><strong>Resume Attached:</strong> ${resumeName}</p>
          <p style="margin: 0;"><strong>Stage in Database:</strong> <span style="background-color: #7c3aed; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold;">Applied</span></p>
        </div>

        <p style="color: #64748b; font-size: 12px; line-height: 1.5;">
          You can now review the candidate's profile, download their resume, or schedule an AI video interview directly from the ATS dashboard.
        </p>
      </div>
    `;

    return this.sendEmail({
      to: recruiterEmail || emailConfig.recruiterNotificationEmail,
      subject,
      text,
      html
    });
  }
}

export const emailService = new EmailService();
