const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5001';

function request(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function getSessionOtp(sessionId) {
  const possiblePaths = [
    path.resolve(__dirname, 'backend/dist/data/sessions.json'),
    path.resolve(__dirname, 'backend/src/data/sessions.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const [id, s] of parsed) {
          if (id === sessionId) return s.emailOtp;
        }
      }
    } catch (e) {}
  }
  return '123456';
}

function expireSession(sessionId) {
  const possiblePaths = [
    path.resolve(__dirname, 'backend/dist/data/sessions.json'),
    path.resolve(__dirname, 'backend/src/data/sessions.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const parsed = JSON.parse(raw);
        for (const entry of parsed) {
          if (entry[0] === sessionId) {
            entry[1].expiresAt = Date.now() - 5000; // Expired 5 seconds ago
          }
        }
        fs.writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf-8');
      }
    } catch (e) {}
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 HiredeskHR SaaS E2E Verification Test Suite');
  console.log('================================================================\n');

  // ===========================================================================
  // TEST SUITE 1: CLIENT REGISTRATION, DUPLICATE CHECK & 10-MIN OTP VERIFICATION
  // ===========================================================================
  console.log('--- Suite 1: Client Registration, Duplicate Check & 10-Min OTP Flow ---');

  const randSuffix = Date.now();
  const testClientEmail = `client_${randSuffix}@alpha${randSuffix}.io`;
  const testClientPassword = 'SecurePassword@123';

  // 1a. Password mismatch validation
  const mismatchRes = await request('POST', '/api/auth/signup/start', {
    email: testClientEmail,
    name: 'Alpha Recruiter',
    password: testClientPassword,
    confirmPassword: 'DifferentPassword456',
    companyName: `Alpha Corporation ${randSuffix}`,
    plan: 'growth'
  });
  assert(mismatchRes.status === 400 && mismatchRes.body.error === 'Passwords do not match.', 'Password mismatch is rejected with 400');

  // 1b. Short password validation (<6 chars)
  const shortPwdRes = await request('POST', '/api/auth/signup/start', {
    email: testClientEmail,
    name: 'Alpha Recruiter',
    password: '123',
    confirmPassword: '123',
    companyName: `Alpha Corporation ${randSuffix}`,
    plan: 'growth'
  });
  assert(shortPwdRes.status === 400 && shortPwdRes.body.error.includes('at least 6 characters'), 'Short password (<6 chars) is rejected with 400');

  // 1c. Valid signup start -> sends 10-minute OTP
  const startRes = await request('POST', '/api/auth/signup/start', {
    email: testClientEmail,
    name: 'Alpha Recruiter',
    password: testClientPassword,
    confirmPassword: testClientPassword,
    companyName: `Alpha Corporation ${randSuffix}`,
    plan: 'growth'
  });
  assert(
    startRes.status === 200 && startRes.body.sessionId && startRes.body.expiresInSeconds >= 595 && startRes.body.expiresInSeconds <= 600,
    'Valid signup creates session and sends 10-minute OTP (expires in 600 seconds)'
  );
  const sessionId = startRes.body.sessionId;
  const correctOtp = startRes.body.devEmailOtp || getSessionOtp(sessionId);

  // 1d. Invalid OTP submission
  const invalidVerify = await request('POST', '/api/auth/signup/verify', {
    sessionId,
    emailOtp: '000000',
    email: testClientEmail
  });
  assert(invalidVerify.status === 400 || !invalidVerify.body.complete, 'Invalid OTP is rejected (modal stays open with error)');

  // 1e. Correct OTP submission -> registers account and returns token
  const validVerify = await request('POST', '/api/auth/signup/verify', {
    sessionId,
    emailOtp: correctOtp,
    email: testClientEmail
  });
  assert(validVerify.status === 200 && validVerify.body.token && validVerify.body.user, 'Correct OTP verifies successfully, returns token and auto-transitions to dashboard');
  const clientToken = validVerify.body.token;
  const clientOrgId = validVerify.body.organization.id;

  // 1f. Duplicate registration with the SAME email -> Must be rejected with 409
  const duplicateRes = await request('POST', '/api/auth/signup/start', {
    email: testClientEmail,
    name: 'Alpha Recruiter Duplicate',
    password: testClientPassword,
    confirmPassword: testClientPassword,
    companyName: `Alpha Corporation Duplicate`,
    plan: 'growth'
  });
  assert(
    duplicateRes.status === 409 &&
    duplicateRes.body.error === 'This email is already registered. Please sign in instead.',
    'Duplicate email registration is rejected with 409 and exact message: "This email is already registered. Please sign in instead."'
  );

  // ===========================================================================
  // TEST SUITE 2: CLIENT LOGIN (EMAIL + PASSWORD, NO OTP)
  // ===========================================================================
  console.log('\n--- Suite 2: Client Login (Email + Password, No OTP) ---');

  // 2a. Invalid client password -> 401
  const wrongClientPwd = await request('POST', '/api/auth/login', {
    email: testClientEmail,
    password: 'WrongPassword999',
    loginType: 'CLIENT'
  });
  assert(wrongClientPwd.status === 401 && wrongClientPwd.body.error === 'Invalid email or password.', 'Client wrong password rejected with "Invalid email or password."');

  // 2b. Valid client password -> 200 (direct login, no OTP required)
  const goodClientLogin = await request('POST', '/api/auth/login', {
    email: testClientEmail,
    password: testClientPassword,
    loginType: 'CLIENT'
  });
  assert(goodClientLogin.status === 200 && goodClientLogin.body.token && goodClientLogin.body.user.email === testClientEmail, 'Client logs in directly with email and password (no OTP)');

  // ===========================================================================
  // TEST SUITE 3: CLIENT FORGOT PASSWORD & 10-MINUTE OTP EXPIRATION
  // ===========================================================================
  console.log('\n--- Suite 3: Client Forgot Password & 10-Minute OTP Expiration ---');

  // 3a. Forgot password with non-existent email -> 404
  const unknownEmailReset = await request('POST', '/api/auth/forgot-password', {
    email: 'nonexistent_client@nowhere.io'
  });
  assert(
    unknownEmailReset.status === 404 && unknownEmailReset.body.error.includes('No client account found'),
    'Forgot password for non-existent email rejects with 404 "No client account found with this email address."'
  );

  // 3b. Forgot password with Admin email -> 404 (only Client accounts can reset password)
  const adminResetAttempt = await request('POST', '/api/auth/forgot-password', {
    email: 'admin@hiredeskhr.com'
  });
  assert(
    adminResetAttempt.status === 404,
    'Forgot password strictly protects Admin account and allows resets only for Client accounts'
  );

  // 3c. Valid Client email -> Generates 10-minute OTP
  const forgotStart = await request('POST', '/api/auth/forgot-password', {
    email: testClientEmail
  });
  assert(
    forgotStart.status === 200 && forgotStart.body.sessionId && forgotStart.body.expiresInSeconds >= 595 && forgotStart.body.expiresInSeconds <= 600,
    'Forgot password sends 10-minute verification OTP (expires in 600 seconds)'
  );
  const resetSessionId = forgotStart.body.sessionId;
  const resetOtp = forgotStart.body.devEmailOtp || getSessionOtp(resetSessionId);

  // 3d. Incorrect Reset OTP -> 400
  const wrongResetOtp = await request('POST', '/api/auth/reset-password/verify-otp', {
    sessionId: resetSessionId,
    email: testClientEmail,
    otp: '000000'
  });
  assert(
    wrongResetOtp.status === 400 && wrongResetOtp.body.error.includes('Invalid verification code'),
    'Incorrect reset OTP is rejected with remaining attempts counter'
  );

  // 3e. Strict Server-Side 10-Minute Expiration Test
  expireSession(resetSessionId);
  const expiredOtpVerify = await request('POST', '/api/auth/reset-password/verify-otp', {
    sessionId: resetSessionId,
    email: testClientEmail,
    otp: resetOtp
  });
  assert(
    expiredOtpVerify.status === 400 &&
    expiredOtpVerify.body.error === 'This OTP has expired. Please request a new OTP.' &&
    expiredOtpVerify.body.code === 'SESSION_EXPIRED',
    'Server-side strictly rejects expired OTP with exact message: "This OTP has expired. Please request a new OTP."'
  );

  // 3f. Resend OTP -> invalidates expired OTP and generates fresh 10-minute OTP
  const resendReset = await request('POST', '/api/auth/forgot-password', {
    email: testClientEmail
  }, { 'x-test-suite': 'true' });
  assert(resendReset.status === 200 && resendReset.body.sessionId, 'Resending OTP invalidates previous OTP and generates new session');
  const freshSessionId = resendReset.body.sessionId;
  const freshOtp = resendReset.body.devEmailOtp || getSessionOtp(freshSessionId);

  // 3g. Verify fresh OTP -> 200 verified
  const validOtpVerify = await request('POST', '/api/auth/reset-password/verify-otp', {
    sessionId: freshSessionId,
    email: testClientEmail,
    otp: freshOtp
  });
  assert(
    validOtpVerify.status === 200 && validOtpVerify.body.verified === true,
    'Valid OTP is confirmed (allows user to proceed to Set New Password screen)'
  );

  // 3h. Password mismatch on set new password -> 400
  const mismatchNewPwd = await request('POST', '/api/auth/reset-password', {
    sessionId: freshSessionId,
    email: testClientEmail,
    password: 'BrandNewPassword@456',
    confirmPassword: 'MismatchPassword@999'
  });
  assert(mismatchNewPwd.status === 400 && mismatchNewPwd.body.error === 'Passwords do not match.', 'Password mismatch is rejected with 400');

  // 3i. Valid new password -> 200 Password successfully reset
  const brandNewPassword = 'BrandNewPassword@456';
  const resetSuccess = await request('POST', '/api/auth/reset-password', {
    sessionId: freshSessionId,
    email: testClientEmail,
    password: brandNewPassword,
    confirmPassword: brandNewPassword
  });
  assert(
    resetSuccess.status === 200 && resetSuccess.body.message.includes('Password successfully reset'),
    'Password successfully reset with salt + scrypt hash'
  );

  // 3j. Client logs in with NEW password -> 200 (No OTP)
  const loginWithNewPwd = await request('POST', '/api/auth/login', {
    email: testClientEmail,
    password: brandNewPassword,
    loginType: 'CLIENT'
  });
  assert(
    loginWithNewPwd.status === 200 && loginWithNewPwd.body.token,
    'Client successfully signs in using the NEW password (no OTP required on subsequent logins)'
  );

  // 3k. Client attempting old password -> 401
  const loginWithOldPwd = await request('POST', '/api/auth/login', {
    email: testClientEmail,
    password: testClientPassword,
    loginType: 'CLIENT'
  });
  assert(
    loginWithOldPwd.status === 401 && loginWithOldPwd.body.error === 'Invalid email or password.',
    'Old password is completely invalidated and rejected with 401'
  );

  // ===========================================================================
  // TEST SUITE 4: ADMIN LOGIN (EMAIL + PASSWORD, NO OTP)
  // ===========================================================================
  console.log('\n--- Suite 4: Admin Login (Backend .env, No OTP) ---');

  // 4a. Admin wrong password -> 401
  const wrongAdminPwd = await request('POST', '/api/auth/login', {
    email: 'admin@hiredeskhr.com',
    password: 'wrongpassword',
    loginType: 'ADMIN'
  });
  assert(wrongAdminPwd.status === 401 && wrongAdminPwd.body.error === 'Invalid admin email or password.', 'Admin wrong password rejected with "Invalid admin email or password."');

  // 4b. Admin correct credentials -> 200
  const goodAdminLogin = await request('POST', '/api/auth/login', {
    email: 'admin@hiredeskhr.com',
    password: 'admin@1234512345',
    loginType: 'ADMIN'
  });
  assert(
    goodAdminLogin.status === 200 &&
    goodAdminLogin.body.token &&
    (goodAdminLogin.body.user.role === 'ADMIN' || goodAdminLogin.body.user.role === 'SUPER_ADMIN'),
    'Admin logs in successfully with backend .env credentials (admin@hiredeskhr.com / admin@1234512345)'
  );
  const adminToken = goodAdminLogin.body.token;

  // ===========================================================================
  // TEST SUITE 5: MULTI-TENANT ISOLATION & ACCESS CONTROL
  // ===========================================================================
  console.log('\n--- Suite 5: Multi-Tenant Isolation & Access Control ---');

  // Client creates a Job
  const createJobRes = await request('POST', '/api/jobs', {
    title: 'Senior Frontend Engineer (Alpha)',
    clientName: `Alpha Corporation ${randSuffix}`,
    department: 'Engineering',
    location: 'Bangalore, India',
    workplaceType: 'Hybrid',
    employmentType: 'Full-time',
    currency: 'INR',
    description: 'Alpha exclusive requisition',
    requirements: ['React', 'TypeScript']
  }, { Authorization: `Bearer ${clientToken}` });

  assert(createJobRes.status === 201 && (createJobRes.body.job?.id || createJobRes.body.id), 'Client successfully creates their job opening');
  const alphaJobId = createJobRes.body.job?.id || createJobRes.body.id;

  // Client creates a Candidate
  const createCandRes = await request('POST', '/api/candidates', {
    jobId: alphaJobId,
    firstName: 'Rahul',
    lastName: 'Sharma',
    email: `rahul_${randSuffix}@candidate.io`,
    phone: '9811122233',
    location: 'Bangalore',
    stage: 'sourcing',
    skills: ['React', 'TypeScript'],
    source: 'LinkedIn'
  }, { Authorization: `Bearer ${clientToken}` });

  assert(createCandRes.status === 201 && (createCandRes.body.candidate?.id || createCandRes.body.id), 'Client adds candidate to talent pool');

  // Register a Second Client (Beta Inc)
  const betaSuffix = Date.now() + 10;
  const testClientBetaEmail = `client_${betaSuffix}@beta${betaSuffix}.io`;
  const betaPassword = 'BetaPassword@456';
  const startBeta = await request('POST', '/api/auth/signup/start', {
    email: testClientBetaEmail,
    password: betaPassword,
    confirmPassword: betaPassword,
    name: 'Beta Recruiter',
    companyName: `Beta Systems ${betaSuffix}`,
    plan: 'enterprise'
  });
  const betaOtp = startBeta.body.devEmailOtp || getSessionOtp(startBeta.body.sessionId);
  const verifyBeta = await request('POST', '/api/auth/signup/verify', {
    sessionId: startBeta.body.sessionId,
    emailOtp: betaOtp,
    email: testClientBetaEmail
  });
  const betaToken = verifyBeta.body.token;
  const betaOrgId = verifyBeta.body.organization.id;

  // Beta creates a job
  const createBetaJob = await request('POST', '/api/jobs', {
    title: 'Cloud DevOps Architect (Beta)',
    clientName: 'Beta Systems',
    department: 'Infrastructure',
    location: 'Remote, India',
    workplaceType: 'Remote',
    employmentType: 'Full-time',
    currency: 'INR',
    description: 'Beta exclusive job',
    requirements: ['Kubernetes', 'GCP']
  }, { Authorization: `Bearer ${betaToken}` });
  const betaJobId = createBetaJob.body.job?.id || createBetaJob.body.id;

  // Verify Alpha Client CANNOT see Beta Job
  const alphaJobsList = await request('GET', '/api/jobs', null, { Authorization: `Bearer ${clientToken}` });
  const alphaSeesBetaJob = alphaJobsList.body.some(j => j.id === betaJobId);
  assert(!alphaSeesBetaJob, 'Client Alpha CANNOT see Client Beta jobs in Job list');

  // Verify Alpha Client CANNOT query Beta organization jobs directly
  const crossOrgAttempt = await request('GET', `/api/jobs?organizationId=${betaOrgId}`, null, { Authorization: `Bearer ${clientToken}` });
  assert(crossOrgAttempt.status === 403, 'Cross-tenant query by Client Alpha returns 403 Forbidden');

  // Verify Client CANNOT access Admin Portal endpoint
  const clientAdminAttempt = await request('GET', '/api/admin/overview', null, { Authorization: `Bearer ${clientToken}` });
  assert(
    clientAdminAttempt.status === 403 && clientAdminAttempt.body.code === 'FORBIDDEN_CLIENT_PORTAL',
    'Client CANNOT access Admin Portal (/api/admin/overview returns 403 FORBIDDEN_CLIENT_PORTAL)'
  );

  // ===========================================================================
  // TEST SUITE 6: ADMIN PORTAL GLOBAL VISIBILITY & 5 TABS
  // ===========================================================================
  console.log('\n--- Suite 6: Admin Portal Platform-Wide Control Center ---');

  // 6a. Admin Overview (Tab 1: Clients)
  const adminOverview = await request('GET', '/api/admin/overview', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminOverview.status === 200, 'Admin can access /api/admin/overview');
  assert(Array.isArray(adminOverview.body.clients), 'Admin overview returns all registered clients');

  const sampleClient = adminOverview.body.clients[0];
  assert(
    sampleClient &&
    sampleClient.companyName &&
    sampleClient.subscriptionStatus &&
    ['Paid', 'Free'].includes(sampleClient.subscriptionStatus) &&
    sampleClient.status &&
    ['Active', 'Inactive'].includes(sampleClient.status) &&
    typeof sampleClient.totalJobsPosted === 'number' &&
    typeof sampleClient.totalApplications === 'number',
    'Admin client row contains: Client Name, Jobs Posted, Applications, Subscription status (Paid/Free), and Status'
  );

  // 6b. Admin Jobs Overview (Tab 2: Jobs Overview)
  const adminJobs = await request('GET', '/api/admin/jobs', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminJobs.status === 200 && Array.isArray(adminJobs.body.jobs), 'Admin can access /api/admin/jobs (Cross-client jobs)');
  assert(
    adminJobs.body.jobs.some(j => j.id === alphaJobId) && adminJobs.body.jobs.some(j => j.id === betaJobId),
    'Admin Jobs Overview shows jobs across BOTH Alpha and Beta clients'
  );

  // 6c. Admin Applications Overview (Tab 3: Applications Overview)
  const adminApps = await request('GET', '/api/admin/applications', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminApps.status === 200 && Array.isArray(adminApps.body.applications), 'Admin can access /api/admin/applications (Cross-client talent pool)');

  // 6d. Admin Subscriptions Overview (Tab 4: Subscription Overview)
  const adminSubs = await request('GET', '/api/admin/subscriptions', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminSubs.status === 200 && adminSubs.body.summary && Array.isArray(adminSubs.body.subscriptions), 'Admin can access /api/admin/subscriptions');
  assert(typeof adminSubs.body.summary.totalMrr === 'number' && adminSubs.body.summary.paidSubscriptions >= 0, 'Admin Subscriptions Overview returns MRR and Paid/Free breakdown');

  // 6e. Admin Statistics (Tab 5: Client Statistics)
  const adminStats = await request('GET', '/api/admin/statistics', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminStats.status === 200 && adminStats.body.hiringConversionRate && Array.isArray(adminStats.body.clientLeaderboard), 'Admin can access /api/admin/statistics with hiring conversion rate and client leaderboard');

  // SUMMARY
  console.log('\n================================================================');
  console.log(`Test Execution Finished: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
