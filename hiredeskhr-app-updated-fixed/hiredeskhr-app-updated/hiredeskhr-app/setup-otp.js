#!/usr/bin/env node
/**
 * TalentFlow ATS - OTP delivery setup wizard.
 *
 *   npm run setup:otp
 *
 * Walks you through configuring real email + WhatsApp OTP delivery, writes the
 * values into backend/.env, and immediately sends a live test so you know it
 * worked before you touch the app.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.resolve(__dirname, 'backend', '.env');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

function readEnv() {
  const values = {};
  if (!fs.existsSync(ENV_PATH)) return values;
  fs.readFileSync(ENV_PATH, 'utf-8')
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) values[m[1]] = m[2].trim();
    });
  return values;
}

function writeEnv(updates) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  Object.entries(updates).forEach(([key, val]) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, `${key}=${val}`);
    else content += `\n${key}=${val}`;
  });
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  fs.writeFileSync(ENV_PATH, content.trim() + '\n', 'utf-8');
}

function header(text) {
  console.log(`\n${c.bold}${c.cyan}${text}${c.reset}`);
  console.log(c.dim + '─'.repeat(Math.min(text.length + 10, 70)) + c.reset);
}

async function setupEmail(existing) {
  header('1/2  Email OTP (Gmail SMTP)');
  console.log(`${c.dim}OTP emails are sent FROM your account TO whatever address each user types in.${c.reset}\n`);

  const skip = await ask(`Configure email OTP now? ${c.dim}[Y/n]${c.reset} `);
  if (skip.toLowerCase() === 'n') return null;

  console.log(`\n${c.yellow}You need a Gmail App Password (not your normal password):${c.reset}`);
  console.log(`  1. Turn on 2-Step Verification: ${c.cyan}https://myaccount.google.com/security${c.reset}`);
  console.log(`  2. Create an App Password:       ${c.cyan}https://myaccount.google.com/apppasswords${c.reset}`);
  console.log(`  3. Copy the 16-character code it shows you.\n`);

  const defaultUser = existing.SMTP_USER || '';
  const user = (await ask(`Gmail address to send FROM ${c.dim}${defaultUser ? `[${defaultUser}]` : ''}${c.reset}: `)) || defaultUser;
  if (!user || !user.includes('@')) {
    console.log(`${c.red}Not a valid email address - skipping email setup.${c.reset}`);
    return null;
  }

  const pass = await ask('16-character App Password: ');
  const clean = pass.replace(/\s+/g, '');
  if (!clean) {
    console.log(`${c.red}No password entered - skipping email setup.${c.reset}`);
    return null;
  }
  if (clean.length !== 16) {
    console.log(`${c.yellow}Heads up: Gmail App Passwords are normally 16 characters (you entered ${clean.length}).${c.reset}`);
  }

  const fromName = (await ask(`Sender display name ${c.dim}[Software Workforce ATS]${c.reset}: `)) || 'Software Workforce ATS';

  return {
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_USER: user,
    SMTP_PASS: clean,
    FROM_EMAIL: user,
    FROM_NAME: fromName
  };
}

async function setupWhatsApp(existing) {
  header('2/2  WhatsApp OTP');
  console.log(`${c.dim}Pick a gateway. Meta is free but needs a Business account; UltraMsg is faster to start.${c.reset}\n`);
  console.log(`  ${c.bold}1${c.reset}  Meta WhatsApp Cloud API  ${c.dim}(free tier, more setup)${c.reset}`);
  console.log(`  ${c.bold}2${c.reset}  UltraMsg                 ${c.dim}(scan a QR code, paid)${c.reset}`);
  console.log(`  ${c.bold}3${c.reset}  Skip WhatsApp for now\n`);

  const choice = await ask('Choice [1/2/3]: ');

  if (choice === '2') {
    const instance = await ask('UltraMsg Instance ID (e.g. instance12345): ');
    const token = await ask('UltraMsg Token: ');
    if (!instance || !token) {
      console.log(`${c.red}Missing values - skipping WhatsApp setup.${c.reset}`);
      return null;
    }
    return { ULTRAMSG_INSTANCE_ID: instance, ULTRAMSG_TOKEN: token };
  }

  if (choice !== '1') return null;

  console.log(`\n${c.yellow}From https://developers.facebook.com -> your app -> WhatsApp -> API Setup:${c.reset}`);
  console.log(`  - ${c.bold}Phone number ID${c.reset}: the long number under your test number (NOT the phone number)`);
  console.log(`  - ${c.bold}Access token${c.reset}: use a permanent System User token; the temporary one expires in 24h\n`);

  const phoneId = (await ask('WhatsApp Phone Number ID: ')) || existing.WHATSAPP_PHONE_ID || '';
  const token = (await ask('WhatsApp Access Token: ')) || existing.WHATSAPP_API_TOKEN || '';
  if (!phoneId || !token) {
    console.log(`${c.red}Missing values - skipping WhatsApp setup.${c.reset}`);
    return null;
  }

  console.log(`\n${c.yellow}IMPORTANT - the part everyone misses:${c.reset}`);
  console.log(`Meta blocks plain text messages to anyone who has not messaged you in the`);
  console.log(`last 24 hours. For signup OTPs that is every single user. You need an`);
  console.log(`approved ${c.bold}AUTHENTICATION${c.reset} template (WhatsApp Manager -> Message Templates).`);
  console.log(`Without it, OTPs will look like they send but never arrive.\n`);

  const template = await ask(`Approved OTP template name ${c.dim}(blank if you don't have one yet)${c.reset}: `);
  const lang = template ? (await ask(`Template language code ${c.dim}[en_US]${c.reset}: `)) || 'en_US' : 'en_US';
  const cc = (await ask(`Default country code for bare numbers ${c.dim}[91]${c.reset}: `)) || '91';

  return {
    WHATSAPP_PHONE_ID: phoneId,
    WHATSAPP_API_TOKEN: token,
    WHATSAPP_OTP_TEMPLATE: template || '',
    WHATSAPP_OTP_TEMPLATE_LANG: lang,
    DEFAULT_COUNTRY_CODE: cc.replace(/\D/g, '') || '91'
  };
}

async function main() {
  console.log(`\n${c.bold}TalentFlow ATS - OTP delivery setup${c.reset}`);
  console.log(`${c.dim}Writes credentials to ${ENV_PATH}${c.reset}`);

  const existing = readEnv();
  const updates = {};

  const emailUpdates = await setupEmail(existing);
  if (emailUpdates) Object.assign(updates, emailUpdates);

  const waUpdates = await setupWhatsApp(existing);
  if (waUpdates) Object.assign(updates, waUpdates);

  if (!Object.keys(updates).length) {
    console.log(`\n${c.yellow}Nothing configured. Run this again when you have your credentials.${c.reset}\n`);
    rl.close();
    return;
  }

  writeEnv(updates);
  console.log(`\n${c.green}✓ Saved ${Object.keys(updates).length} settings to backend/.env${c.reset}`);

  header('Live test');
  const testEmail = emailUpdates ? await ask('Send a test email to (blank to skip): ') : '';
  const testPhone = waUpdates ? await ask('Send a test WhatsApp to, with country code (blank to skip): ') : '';
  rl.close();

  if (!testEmail && !testPhone) {
    console.log(`\n${c.green}Done.${c.reset} Start the app with ${c.bold}npm run dev${c.reset}, or verify anytime with ${c.bold}npm run verify:otp${c.reset}\n`);
    return;
  }

  // Re-load env with the new values and send through the real services.
  Object.entries(updates).forEach(([k, v]) => {
    process.env[k] = v;
  });

  console.log(`\n${c.dim}Dispatching...${c.reset}`);
  const { runDiagnostic } = require('./verify-otp-setup.js');
  await runDiagnostic({ testEmail, testPhone });
}

main().catch((err) => {
  console.error(`\n${c.red}Setup failed:${c.reset}`, err.message);
  rl.close();
  process.exit(1);
});
