#!/usr/bin/env node
/**
 * TalentFlow ATS - OTP delivery diagnostic.
 *
 *   npm run verify:otp
 *   npm run verify:otp -- --email you@example.com --phone +919999999999
 *
 * Checks your credentials, explains anything that is wrong in plain language,
 * and optionally sends a real test message.
 */

const path = require('path');

// Compile the TypeScript services on the fly so this script always tests the
// exact same code path the running server uses.
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
  dir: path.resolve(__dirname, 'backend')
});

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

const ok = (m) => console.log(`  ${c.green}✓${c.reset} ${m}`);
const bad = (m) => console.log(`  ${c.red}✗${c.reset} ${m}`);
const warn = (m) => console.log(`  ${c.yellow}!${c.reset} ${m}`);
const hint = (m) => console.log(`    ${c.dim}→ ${m}${c.reset}`);

function header(text) {
  console.log(`\n${c.bold}${text}${c.reset}`);
}

async function runDiagnostic({ testEmail = '', testPhone = '' } = {}) {
  const backend = path.resolve(__dirname, 'backend', 'src');
  const { EmailService, resolveEmailCreds } = require(path.join(backend, 'services', 'emailService.ts'));
  const { WhatsAppService, resolveWaCreds, normalizePhone } = require(path.join(backend, 'services', 'whatsappService.ts'));

  const emailService = new EmailService();
  const whatsappService = new WhatsAppService();

  let allGood = true;

  // ---------------- EMAIL ----------------
  header('EMAIL OTP');
  const mail = resolveEmailCreds();

  if (!mail.anyConfigured) {
    allGood = false;
    bad('No email provider configured.');
    hint('Run "npm run setup:otp", or set SMTP_USER + SMTP_PASS in backend/.env');
  } else {
    if (mail.smtpConfigured) {
      ok(`SMTP credentials present for ${c.bold}${mail.smtpUser}${c.reset} (${mail.smtpHost}:${mail.smtpPort})`);
      process.stdout.write(`  ${c.dim}connecting...${c.reset}\r`);
      const check = await emailService.verifySmtp();
      process.stdout.write('                          \r');
      if (check.ok) {
        ok(check.message);
      } else {
        allGood = false;
        bad(check.message);
        if (check.hint) hint(check.hint);
      }
    }
    if (mail.elasticConfigured) ok('Elastic Email API key present (used as fallback).');
  }

  // ---------------- WHATSAPP ----------------
  header('WHATSAPP OTP');
  const wa = resolveWaCreds();

  if (!wa.anyConfigured) {
    allGood = false;
    bad('No WhatsApp gateway configured.');
    hint('Run "npm run setup:otp", or set WHATSAPP_API_TOKEN + WHATSAPP_PHONE_ID in backend/.env');
  } else {
    process.stdout.write(`  ${c.dim}checking gateway...${c.reset}\r`);
    const check = await whatsappService.verifyWhatsApp();
    process.stdout.write('                              \r');
    if (check.ok) {
      ok(check.message);
      if (check.code === 'WA_NO_TEMPLATE') {
        warn('No authentication template configured.');
        hint('OTPs will NOT reach users who have not messaged you in the last 24 hours.');
        hint('Create an AUTHENTICATION template in WhatsApp Manager, then set WHATSAPP_OTP_TEMPLATE.');
      }
    } else {
      allGood = false;
      bad(check.message);
      if (check.hint) hint(check.hint);
    }
    console.log(`  ${c.dim}Bare numbers get country code +${wa.defaultCountryCode} (DEFAULT_COUNTRY_CODE)${c.reset}`);
  }

  // ---------------- LIVE TEST ----------------
  if (testEmail || testPhone) {
    header('LIVE TEST');
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    if (testEmail) {
      const r = await emailService.sendOtpEmail(testEmail, code, 'http://localhost:5174/verify?test=true');
      if (r.success) ok(`Email sent to ${testEmail} (code ${code}). Check inbox and spam.`);
      else {
        allGood = false;
        bad(`Email to ${testEmail} failed: ${r.message}`);
        if (r.hint) hint(r.hint);
      }
    }

    if (testPhone) {
      const normalized = normalizePhone(testPhone, wa.defaultCountryCode);
      const r = await whatsappService.sendWhatsAppOtp(testPhone, code);
      if (r.dispatchedLive) ok(`WhatsApp sent to +${normalized} (code ${code}) via ${r.transport}.`);
      else {
        allGood = false;
        bad(`WhatsApp to +${normalized} failed: ${r.message}`);
        if (r.hint) hint(r.hint);
      }
    }
  }

  header(allGood ? `${c.green}Everything is configured correctly.${c.reset}` : `${c.yellow}Some things still need fixing (see above).${c.reset}`);
  if (!allGood) {
    console.log(`${c.dim}Run "npm run setup:otp" to re-enter credentials.${c.reset}`);
  }
  console.log('');

  return allGood;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { testEmail: '', testPhone: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email') out.testEmail = args[++i] || '';
    if (args[i] === '--phone') out.testPhone = args[++i] || '';
  }
  return out;
}

module.exports = { runDiagnostic };

if (require.main === module) {
  runDiagnostic(parseArgs())
    .then((good) => process.exit(good ? 0 : 1))
    .catch((err) => {
      console.error(`\n${c.red}Diagnostic crashed:${c.reset}`, err.message);
      process.exit(1);
    });
}
