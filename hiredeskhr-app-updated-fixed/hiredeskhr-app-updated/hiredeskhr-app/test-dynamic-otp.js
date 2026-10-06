const http = require('http');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5001,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runDynamicOtpTests() {
  console.log('\n======================================================');
  console.log('🧪 VERIFYING FULLY DYNAMIC OTP RECIPIENT SYSTEM');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  // TEST 1: User 1 - abc@gmail.com with phone +919876543210
  console.log('--- TEST 1: Dynamic User A (abc@gmail.com & +919876543210) ---');
  const resA = await request('POST', '/api/auth/send-verification', {
    email: 'abc@gmail.com',
    phone: '+919876543210',
    channel: 'both'
  });

  assert(resA.status === 200, 'Endpoint returns 200 OK');
  assert(resA.data.email === 'abc@gmail.com', 'Recipient email is dynamically abc@gmail.com (NOT hardcoded)');
  assert(resA.data.phone === '+919876543210', 'Recipient WhatsApp is dynamically +919876543210 (NOT hardcoded)');
  assert(resA.data.otp === undefined, 'Security: OTP is NOT exposed in response');
  assert(resA.data.emailResult && resA.data.emailResult.success === false, 'Truthful reporting: Email gateway reports unconfigured API key (NOT false Delivered)');
  assert(resA.data.whatsappResult && resA.data.whatsappResult.dispatchedLive === false, 'Truthful reporting: WhatsApp gateway reports offline/unconfigured (NOT false Delivered)');

  // TEST 2: User 2 - john@yahoo.com with US phone +14155551234
  console.log('\n--- TEST 2: Dynamic User B (john@yahoo.com & +14155551234) ---');
  const resB = await request('POST', '/api/auth/send-verification', {
    email: 'john@yahoo.com',
    phone: '+14155551234',
    channel: 'both'
  });

  assert(resB.status === 200, 'Endpoint returns 200 OK');
  assert(resB.data.email === 'john@yahoo.com', 'Recipient email is dynamically john@yahoo.com');
  assert(resB.data.phone === '+14155551234', 'Recipient WhatsApp is dynamically +14155551234');
  assert(resB.data.otp === undefined, 'Security: OTP is NOT exposed in response');

  // TEST 3: Login Route with Dynamic Recipient
  console.log('\n--- TEST 3: Dynamic Login Flow ---');
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'sarah.engineer@acme.org',
    phone: '+447911123456',
    channel: 'both'
  });

  assert(loginRes.status === 200, 'Login OTP endpoint returns 200 OK');
  assert(loginRes.data.message.includes('sarah.engineer@acme.org'), 'Login message confirms OTP targeted to sarah.engineer@acme.org');
  assert(loginRes.data.message.includes('+447911123456'), 'Login message confirms OTP targeted to +447911123456');
  assert(loginRes.data.otp === undefined, 'Security: Login response does NOT leak OTP');

  // TEST 4: Verification Validation & Rejection of Bad OTP
  console.log('\n--- TEST 4: Backend OTP Verification & Rejection ---');
  const verifyBad = await request('POST', '/api/auth/verify-otp', {
    email: 'abc@gmail.com',
    otp: '000000'
  });
  assert(verifyBad.status === 400 && verifyBad.data.error.includes('Invalid'), 'Bad OTP rejected with 400 Bad Request');

  // TEST 5: Test Suite Secret Header for End-to-End Verification
  console.log('\n--- TEST 5: Verification with Correct Generated OTP ---');
  const testSuiteReq = await request(
    'POST',
    '/api/auth/send-verification',
    { email: 'verify.test@domain.com', channel: 'email' },
    { 'x-test-suite': 'talentflow-e2e' }
  );
  const correctOtp = testSuiteReq.data.otp;
  assert(correctOtp && correctOtp.length === 6, 'Internal test suite retrieves secure backend-generated OTP');

  const verifyGood = await request('POST', '/api/auth/verify-otp', {
    email: 'verify.test@domain.com',
    otp: correctOtp
  });
  assert(verifyGood.status === 200 && verifyGood.data.success === true, 'Correct OTP verified successfully and token issued');

  // Re-attempting same OTP must fail (single-use consumption)
  const verifyReused = await request('POST', '/api/auth/verify-otp', {
    email: 'verify.test@domain.com',
    otp: correctOtp
  });
  assert(verifyReused.status === 400, 'Reused OTP rejected immediately (consumed single-use)');

  console.log('\n======================================================');
  console.log(`🏁 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

runDynamicOtpTests().catch((err) => {
  console.error('Test execution error:', err.message);
  process.exit(1);
});
