const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5001';

function request(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = data ? JSON.stringify(data) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let chunks = '';
      res.on('data', chunk => (chunks += chunk));
      res.on('end', () => {
        try {
          const parsed = chunks ? JSON.parse(chunks) : {};
          resolve({ status: res.statusCode, data: parsed, raw: chunks });
        } catch {
          resolve({ status: res.statusCode, raw: chunks });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function getSessionOtp(sessionId) {
  try {
    const sessionsFile = path.resolve(__dirname, 'backend/src/data/sessions.json');
    if (fs.existsSync(sessionsFile)) {
      const raw = fs.readFileSync(sessionsFile, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const [id, s] of parsed) {
        if (id === sessionId) return s.emailOtp;
      }
    }
  } catch (e) {}
  return null;
}

async function runPhase2Tests() {
  console.log('\n======================================================');
  console.log('🧪 VERIFYING PHASE 2 — AUTHENTICATION & PORTAL SEPARATION');
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

  try {
    // 1. Client Signup Flow
    console.log('--- TEST 1: Client Signup & OTP Generation ---');
    const testEmail = `test.client.${Date.now()}@examplecorp.com`;
    const signupStart = await request('POST', '/api/auth/signup/start', {
      email: testEmail,
      clientNumber: '9876543210',
      name: 'Test Client Owner',
      companyName: 'Example Corp International',
      plan: 'growth'
    });

    assert(signupStart.status === 200 && signupStart.data.success, 'Signup OTP initiated successfully');
    const sessionId = signupStart.data.sessionId;
    assert(Boolean(sessionId), 'Session ID returned to client');

    // Edge Case: Incorrect OTP
    console.log('\n--- TEST 2: OTP Error Handling (Incorrect OTP) ---');
    const wrongOtpRes = await request('POST', '/api/auth/signup/verify', {
      sessionId,
      emailOtp: '000000',
      email: testEmail
    });
    assert(wrongOtpRes.status === 400 || wrongOtpRes.data.success === false, 'Incorrect OTP rejected gracefully');

    // Retrieve correct OTP from session
    const correctOtp = signupStart.data.devEmailOtp || getSessionOtp(sessionId);
    assert(Boolean(correctOtp), 'Valid 6-digit OTP resolved from verification session');

    // Verify correct OTP
    console.log('\n--- TEST 3: Correct OTP Verification & Client Token Issuance ---');
    const verifyRes = await request('POST', '/api/auth/signup/verify', {
      sessionId,
      emailOtp: correctOtp,
      email: testEmail
    });

    assert(verifyRes.status === 200 && verifyRes.data.success, 'Correct OTP verified with status 200 OK');
    assert(Boolean(verifyRes.data.token), 'Auth Bearer token issued upon OTP verification');
    assert(verifyRes.data.user.role === 'CLIENT_ADMIN', 'New client is assigned CLIENT_ADMIN role');
    assert(Boolean(verifyRes.data.user.clientId), 'New client is assigned a unique clientId');
    assert(Boolean(verifyRes.data.organization.id), 'Organization created and linked to client');

    const clientToken = verifyRes.data.token;
    const clientOrgId = verifyRes.data.organization.id;

    // 4. Client Portal Access (Own Data)
    console.log('\n--- TEST 4: Client Portal Access ---');
    const clientMe = await request('GET', '/api/auth/me', null, {
      Authorization: `Bearer ${clientToken}`
    });
    assert(clientMe.status === 200 && clientMe.data.user.email === testEmail, '/api/auth/me resolves client profile');

    const clientPortal = await request('GET', '/api/clients/portal/me', null, {
      Authorization: `Bearer ${clientToken}`,
      'x-organization-id': clientOrgId,
      'x-client-id': verifyRes.data.user.clientId
    });
    assert(clientPortal.status === 200 && clientPortal.data.client.companyName === 'Example Corp International', 'Client can access their dedicated Client Portal');

    // 5. Client Security: Cannot access Admin Portal routes
    console.log('\n--- TEST 5: Security Boundary — Client Forbidden from Admin Portal ---');
    const clientToAdmin = await request('GET', '/api/admin/overview', null, {
      Authorization: `Bearer ${clientToken}`
    });
    assert(clientToAdmin.status === 403, 'Client request to /api/admin/overview is blocked with 403 Forbidden', `Got status ${clientToAdmin.status}`);
    assert(clientToAdmin.data.code === 'FORBIDDEN_CLIENT_PORTAL' || clientToAdmin.data.error?.includes('Forbidden') || clientToAdmin.data.error?.includes('permission'), 'Helpful security explanation returned on forbidden admin access');

    // 6. Admin Authentication & Global Access
    console.log('\n--- TEST 6: Platform Admin Login & Global Access ---');
    const adminEmail = 'admin@hiredeskhr.com';
    const adminLoginStart = await request('POST', '/api/auth/login/start', {
      email: adminEmail
    });
    assert(adminLoginStart.status === 200 && adminLoginStart.data.success, 'Admin sign-in OTP dispatched');

    const adminOtp = adminLoginStart.data.devEmailOtp || getSessionOtp(adminLoginStart.data.sessionId);
    const adminVerify = await request('POST', '/api/auth/login/verify', {
      sessionId: adminLoginStart.data.sessionId,
      otp: adminOtp,
      email: adminEmail
    });
    assert(adminVerify.status === 200 && adminVerify.data.success, 'Admin sign-in OTP verified successfully');
    assert(adminVerify.data.user.role === 'ADMIN', 'Admin user retains platform ADMIN role');

    const adminToken = adminVerify.data.token;
    const adminOverview = await request('GET', '/api/admin/overview', null, {
      Authorization: `Bearer ${adminToken}`
    });
    assert(adminOverview.status === 200 && adminOverview.data.summary, 'Platform Admin successfully accesses global Admin Portal');
    assert(Array.isArray(adminOverview.data.clients) && adminOverview.data.clients.length > 0, 'Admin can see cross-client company data');

    // 7. Resend OTP Functionality
    console.log('\n--- TEST 7: Resend OTP Endpoint ---');
    const resendStart = await request('POST', '/api/auth/login/start', {
      email: 'recruiter@hiredeskhr.com'
    });
    const resendRes = await request('POST', '/api/auth/resend', {
      sessionId: resendStart.data.sessionId,
      email: 'recruiter@hiredeskhr.com',
      channel: 'email'
    });
    assert(resendRes.status === 200 && resendRes.data.success, 'Resend OTP generates new code and resets expiration');

    console.log('\n======================================================');
    console.log(`PHASE 2 TEST SUMMARY: ${passed} passed, ${failed} failed`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running Phase 2 tests:', err);
    process.exit(1);
  }
}

runPhase2Tests();
