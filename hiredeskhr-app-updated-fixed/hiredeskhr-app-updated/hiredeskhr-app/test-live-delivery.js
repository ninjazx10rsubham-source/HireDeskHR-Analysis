const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

const nodemailer = require('nodemailer');

async function testLiveDelivery() {
  console.log('\n======================================================');
  console.log('🔍 TALENTFLOW ATS - LIVE CREDENTIALS & DISPATCH AUDIT');
  console.log('======================================================\n');

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER || 'shravanihn20@gmail.com';
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const fromEmail = process.env.FROM_EMAIL || smtpUser;
  const elasticApiKey = (process.env.ELASTIC_EMAIL_API_KEY || '').trim();

  const waToken = (process.env.WHATSAPP_API_TOKEN || '').trim();
  const waPhoneId = (process.env.WHATSAPP_PHONE_ID || '').trim();

  console.log('1. [EMAIL CONFIGURATION CHECK]');
  console.log(`   - SMTP Host: ${smtpHost}:${smtpPort}`);
  console.log(`   - SMTP Sender: ${smtpUser}`);
  console.log(`   - SMTP Password (App Password): ${smtpPass ? `CONFIGURED (${smtpPass.length} chars)` : '❌ EMPTY / NOT CONFIGURED'}`);
  console.log(`   - Elastic Email API Key: ${elasticApiKey ? `CONFIGURED (${elasticApiKey.length} chars)` : 'EMPTY (Optional)'}`);

  console.log('\n2. [WHATSAPP CONFIGURATION CHECK]');
  console.log(`   - WhatsApp API Token: ${waToken ? `CONFIGURED (${waToken.length} chars)` : '❌ EMPTY / NOT CONFIGURED'}`);
  console.log(`   - WhatsApp Phone ID: ${waPhoneId ? `CONFIGURED (${waPhoneId})` : '❌ EMPTY / NOT CONFIGURED'}`);

  console.log('\n3. [LIVE TEST: EMAIL DISPATCH TO TEST RECIPIENT]');
  const testRecipient = 'test-candidate@example.com';

  if (!smtpPass && !elasticApiKey) {
    console.log('   ❌ CANNOT DISPATCH LIVE EMAIL:');
    console.log('      Root cause: SMTP_PASS is currently empty in backend/.env.');
    console.log('      Gmail SMTP requires a 16-character App Password generated at:');
    console.log('      https://myaccount.google.com/apppasswords');
  } else if (smtpPass) {
    console.log(`   Attempting real Gmail SMTP authentication to ${smtpHost}:${smtpPort}...`);
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
      console.log('   Verifying SMTP credentials with Gmail server...');
      await transporter.verify();
      console.log('   ✅ SMTP CONNECTION SUCCESSFUL: Gmail authenticated successfully!');
    } catch (err) {
      console.log('   ❌ GMAIL SMTP AUTHENTICATION FAILED:');
      console.log(`      Error: ${err.message}`);
      console.log(`      Code: ${err.code || 'N/A'}`);
      console.log(`      Response: ${err.response || 'N/A'}`);
    }
  }

  console.log('\n4. [LIVE TEST: META WHATSAPP CLOUD API DISPATCH]');
  const testPhone = '918217877923';

  if (!waToken || !waPhoneId) {
    console.log('   ❌ CANNOT DISPATCH LIVE WHATSAPP MESSAGE:');
    console.log('      Root cause: WHATSAPP_API_TOKEN or WHATSAPP_PHONE_ID is empty in backend/.env.');
    console.log('      To send live WhatsApp messages, get your token and phone ID from:');
    console.log('      https://developers.facebook.com');
  } else {
    console.log(`   Attempting Meta WhatsApp API call for +${testPhone}...`);
    try {
      const response = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${waToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: testPhone,
          type: 'text',
          text: { body: 'Test OTP verification code from TalentFlow ATS' }
        })
      });
      const resData = await response.json();
      if (response.ok && resData.messages) {
        console.log(`   ✅ WHATSAPP DISPATCH SUCCESSFUL! Message ID: ${resData.messages[0]?.id}`);
      } else {
        console.log('   ❌ META WHATSAPP API REJECTED REQUEST:');
        console.log('      ' + JSON.stringify(resData, null, 2));
      }
    } catch (err) {
      console.log(`   ❌ NETWORK ERROR: ${err.message}`);
    }
  }

  console.log('\n======================================================\n');
}

testLiveDelivery().catch(console.error);
