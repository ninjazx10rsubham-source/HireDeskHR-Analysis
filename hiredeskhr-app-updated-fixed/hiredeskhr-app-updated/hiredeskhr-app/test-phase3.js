// test-phase3.js: Comprehensive Multi-Tenant Data Isolation Test Suite
const http = require('http');

const BASE_URL = 'http://localhost:5001';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
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

const fs = require('fs');
const path = require('path');

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
  return '123456';
}

async function registerAndLogin(email, name, companyName) {
  const randomPhone = '9' + Math.floor(100000000 + Math.random() * 900000000);
  const start = await request('POST', '/api/auth/signup/start', {
    email,
    clientNumber: randomPhone,
    name,
    companyName,
    plan: 'growth'
  });
  if (start.status !== 200 || !start.body.success) {
    throw new Error(`signup/start failed for ${email}: ${JSON.stringify(start.body)}`);
  }

  const sessionId = start.body.sessionId;
  const otp = start.body.devEmailOtp || getSessionOtp(sessionId);

  const verify = await request('POST', '/api/auth/signup/verify', {
    sessionId,
    emailOtp: otp,
    email
  });

  if (verify.status !== 200 || !verify.body.token) {
    throw new Error(`signup/verify failed for ${email}: ${JSON.stringify(verify.body)}`);
  }

  return {
    token: verify.body.token,
    user: verify.body.user,
    organization: verify.body.organization
  };
}

async function runTests() {
  console.log('================================================================');
  console.log('⚡ RUNNING PHASE 3 MULTI-TENANT ARCHITECTURE VERIFICATION SUITE');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------
    // Step 1: Create Company A (Alpha Corp)
    // -------------------------------------------------------------
    console.log('--- Step 1: Register and Authenticate Company A ---');
    const emailA = `alpha_admin_${Date.now()}@alphacorp.com`;
    const authA = await registerAndLogin(emailA, 'Alice Alpha', 'Alpha Corp');
    assert(!!authA.token, `Company A authenticated with token`);
    const tokenA = authA.token;
    const orgIdA = authA.user.organizationId;
    assert(!!orgIdA, `Company A organization ID obtained: ${orgIdA}`);

    // Create Job in Company A
    const jobResA = await request('POST', '/api/jobs', {
      title: 'Senior Backend Architect',
      department: 'Engineering',
      location: 'New York, NY',
      workplaceType: 'remote',
      employmentType: 'full-time',
      experienceMin: 5,
      experienceMax: 10,
      skills: ['Node.js', 'PostgreSQL', 'Microservices'],
      description: 'Design multi-tenant cloud architecture.'
    }, { Authorization: `Bearer ${tokenA}` });
    const jobIdA = jobResA.body.job?.id || jobResA.body.id;
    assert(jobResA.status === 201 && !!jobIdA, `Created Job in Company A: ${jobIdA}`);

    // Create Client Company in Company A
    const clientResA = await request('POST', '/api/clients', {
      companyName: 'Alpha VIP Client',
      contactPerson: 'Director Dan',
      email: 'dan@alphaclient.com',
      industry: 'FinTech'
    }, { Authorization: `Bearer ${tokenA}` });
    assert(clientResA.status === 201 && clientResA.body.client?.id, `Created Client Profile in Company A: ${clientResA.body.client?.id}`);
    const clientIdA = clientResA.body.client?.id;

    // Create Candidate in Company A
    const candResA = await request('POST', '/api/candidates', {
      firstName: 'John',
      lastName: 'AlphaCandidate',
      email: `john_alpha_${Date.now()}@example.com`,
      jobId: jobIdA,
      skills: ['Node.js', 'Cloud'],
      stage: 'applied'
    }, { Authorization: `Bearer ${tokenA}` });
    assert(candResA.status === 201 && candResA.body.id, `Created Candidate in Company A: ${candResA.body?.id}`);
    const candidateIdA = candResA.body.id;

    // Schedule Interview in Company A
    const intResA = await request('POST', '/api/interviews', {
      candidateId: candidateIdA,
      jobId: jobIdA,
      roundName: 'Technical Round 1',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 45
    }, { Authorization: `Bearer ${tokenA}` });
    assert(intResA.status === 201 && intResA.body.interview?.id, `Scheduled Interview in Company A: ${intResA.body.interview?.id}`);
    const interviewIdA = intResA.body.interview?.id;

    // Compose Email Thread in Company A
    const emailResA = await request('POST', '/api/emails/compose', {
      candidateId: candidateIdA,
      subject: 'Interview scheduled with Alpha Corp',
      content: 'We look forward to talking to you!'
    }, { Authorization: `Bearer ${tokenA}` });
    assert(emailResA.status === 200 && emailResA.body.thread?.id, `Composed Email Thread in Company A: ${emailResA.body.thread?.id}`);
    const threadIdA = emailResA.body.thread?.id;

    // -------------------------------------------------------------
    // Step 2: Create Company B (Beta Solutions)
    // -------------------------------------------------------------
    console.log('\n--- Step 2: Register and Authenticate Company B ---');
    const emailB = `beta_admin_${Date.now()}@betasolutions.com`;
    const authB = await registerAndLogin(emailB, 'Bob Beta', 'Beta Solutions');
    assert(!!authB.token, `Company B authenticated with token`);
    const tokenB = authB.token;
    const orgIdB = authB.user.organizationId;
    assert(!!orgIdB && orgIdB !== orgIdA, `Company B has distinct orgId: ${orgIdB} !== ${orgIdA}`);

    // Create Job in Company B
    const jobResB = await request('POST', '/api/jobs', {
      title: 'Frontend React Specialist',
      department: 'Engineering',
      location: 'San Francisco, CA',
      workplaceType: 'remote',
      employmentType: 'full-time',
      experienceMin: 3,
      experienceMax: 6,
      skills: ['React', 'TypeScript', 'TailwindCSS'],
      description: 'Build responsive UI components.'
    }, { Authorization: `Bearer ${tokenB}` });
    const jobIdB = jobResB.body.job?.id || jobResB.body.id;
    assert(jobResB.status === 201 && !!jobIdB, `Created Job in Company B: ${jobIdB}`);

    // -------------------------------------------------------------
    // Step 3: Verify Cross-Tenant Block on Jobs
    // -------------------------------------------------------------
    console.log('\n--- Step 3: Cross-Tenant Isolation Tests on Jobs ---');

    // 3.1 Company B attempts to list Company A jobs via ?orgId=
    const listCrossJobs = await request('GET', `/api/jobs?orgId=${orgIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(listCrossJobs.status === 403 && listCrossJobs.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant jobs list via query param: 403 (${listCrossJobs.body.code})`);

    // 3.2 Company B attempts to get Company A job by ID
    const getCrossJob = await request('GET', `/api/jobs/${jobIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(getCrossJob.status === 403 && getCrossJob.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant GET single job: 403 (${getCrossJob.body.code})`);

    // 3.3 Company B attempts to update Company A job
    const putCrossJob = await request('PUT', `/api/jobs/${jobIdA}`, { title: 'Hacked Job Title' }, { Authorization: `Bearer ${tokenB}` });
    assert(putCrossJob.status === 403 && putCrossJob.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant PUT job: 403 (${putCrossJob.body.code})`);

    // 3.4 Company B attempts to delete Company A job
    const delCrossJob = await request('DELETE', `/api/jobs/${jobIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(delCrossJob.status === 403 && delCrossJob.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant DELETE job: 403 (${delCrossJob.body.code})`);

    // 3.5 Company B attempts to publish Company A job to LinkedIn
    const pubCrossJob = await request('POST', `/api/jobs/${jobIdA}/publish-linkedin`, null, { Authorization: `Bearer ${tokenB}` });
    assert(pubCrossJob.status === 403 && pubCrossJob.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant LinkedIn publish: 403 (${pubCrossJob.body.code})`);

    // 3.6 Company B attempts to get candidates for Company A job
    const candCrossJob = await request('GET', `/api/jobs/${jobIdA}/candidates`, null, { Authorization: `Bearer ${tokenB}` });
    assert(candCrossJob.status === 403 && candCrossJob.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant job candidates list: 403 (${candCrossJob.body.code})`);

    // 3.7 Company B regular list should only contain Company B jobs
    const listMyJobsB = await request('GET', '/api/jobs', null, { Authorization: `Bearer ${tokenB}` });
    const hasJobA = listMyJobsB.body.some(j => j.id === jobIdA);
    const hasJobB = listMyJobsB.body.some(j => j.id === jobIdB);
    assert(listMyJobsB.status === 200 && !hasJobA && hasJobB,
      `Company B job list strictly scoped to Company B (has Company B job, does NOT have Company A job)`);

    // -------------------------------------------------------------
    // Step 4: Verify Cross-Tenant Block on Candidates
    // -------------------------------------------------------------
    console.log('\n--- Step 4: Cross-Tenant Isolation Tests on Candidates ---');

    // 4.1 Query cross-tenant candidates list via ?orgId=
    const listCrossCand = await request('GET', `/api/candidates?orgId=${orgIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(listCrossCand.status === 403 && listCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant candidates list via query param: 403 (${listCrossCand.body.code})`);

    // 4.2 Get cross-tenant candidate by ID
    const getCrossCand = await request('GET', `/api/candidates/${candidateIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(getCrossCand.status === 403 && getCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant GET single candidate: 403 (${getCrossCand.body.code})`);

    // 4.3 Update stage of cross-tenant candidate
    const patchCrossCand = await request('PATCH', `/api/candidates/${candidateIdA}/stage`, { stage: 'interview' }, { Authorization: `Bearer ${tokenB}` });
    assert(patchCrossCand.status === 403 && patchCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant PATCH candidate stage: 403 (${patchCrossCand.body.code})`);

    // 4.4 Update cross-tenant candidate
    const putCrossCand = await request('PUT', `/api/candidates/${candidateIdA}`, { firstName: 'Hacked' }, { Authorization: `Bearer ${tokenB}` });
    assert(putCrossCand.status === 403 && putCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant PUT candidate: 403 (${putCrossCand.body.code})`);

    // 4.5 Add note to cross-tenant candidate
    const noteCrossCand = await request('POST', `/api/candidates/${candidateIdA}/notes`, { note: 'Unauthorized note' }, { Authorization: `Bearer ${tokenB}` });
    assert(noteCrossCand.status === 403 && noteCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant POST note: 403 (${noteCrossCand.body.code})`);

    // 4.6 Delete cross-tenant candidate
    const delCrossCand = await request('DELETE', `/api/candidates/${candidateIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(delCrossCand.status === 403 && delCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant DELETE candidate: 403 (${delCrossCand.body.code})`);

    // 4.7 Create candidate in Company B linking to Company A's job
    const createCrossCand = await request('POST', '/api/candidates', {
      firstName: 'Cross',
      lastName: 'Infiltrator',
      email: `cross_${Date.now()}@example.com`,
      jobId: jobIdA
    }, { Authorization: `Bearer ${tokenB}` });
    assert(createCrossCand.status === 403 && createCrossCand.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked linking candidate to another company's job requisition: 403 (${createCrossCand.body.code})`);

    // -------------------------------------------------------------
    // Step 5: Verify Cross-Tenant Block on Interviews & Calendar
    // -------------------------------------------------------------
    console.log('\n--- Step 5: Cross-Tenant Isolation Tests on Interviews & Calendar ---');

    // 5.1 Query cross-tenant interviews list
    const listCrossInt = await request('GET', `/api/interviews?orgId=${orgIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(listCrossInt.status === 403 && listCrossInt.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant interviews list: 403 (${listCrossInt.body.code})`);

    // 5.2 Get cross-tenant interview by ID
    const getCrossInt = await request('GET', `/api/interviews/${interviewIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(getCrossInt.status === 403 && getCrossInt.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant GET interview: 403 (${getCrossInt.body.code})`);

    // 5.3 Submit scorecard to cross-tenant interview
    const scoreCrossInt = await request('POST', `/api/interviews/${interviewIdA}/scorecard`, {
      recommendation: 'STRONG_HIRE',
      notes: 'Unauthorized scorecard'
    }, { Authorization: `Bearer ${tokenB}` });
    assert(scoreCrossInt.status === 403 && scoreCrossInt.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant submit scorecard: 403 (${scoreCrossInt.body.code})`);

    // 5.4 Cancel cross-tenant interview
    const cancelCrossInt = await request('DELETE', `/api/interviews/${interviewIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(cancelCrossInt.status === 403 && cancelCrossInt.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant cancel interview: 403 (${cancelCrossInt.body.code})`);

    // 5.5 Schedule interview for cross-tenant candidate
    const schedCrossInt = await request('POST', '/api/interviews', {
      candidateId: candidateIdA,
      jobId: jobIdB,
      roundName: 'Unauthorized Round'
    }, { Authorization: `Bearer ${tokenB}` });
    assert(schedCrossInt.status === 403 && schedCrossInt.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked scheduling interview for another company's candidate: 403 (${schedCrossInt.body.code})`);

    // 5.6 Download calendar .ics invite of cross-tenant interview
    const icsCross = await request('GET', `/api/calendar/invite/${interviewIdA}.ics`, null, { Authorization: `Bearer ${tokenB}` });
    assert(icsCross.status === 403 && icsCross.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant calendar invite download: 403 (${icsCross.body.code})`);

    // -------------------------------------------------------------
    // Step 6: Verify Cross-Tenant Block on Emails
    // -------------------------------------------------------------
    console.log('\n--- Step 6: Cross-Tenant Isolation Tests on Emails ---');

    // 6.1 Query cross-tenant email threads list
    const listCrossEmails = await request('GET', `/api/emails?orgId=${orgIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(listCrossEmails.status === 403 && listCrossEmails.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant email threads list: 403 (${listCrossEmails.body.code})`);

    // 6.2 Get cross-tenant email thread
    const getCrossThread = await request('GET', `/api/emails/${threadIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(getCrossThread.status === 403 && getCrossThread.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant GET email thread: 403 (${getCrossThread.body.code})`);

    // 6.3 Reply to cross-tenant email thread
    const replyCrossThread = await request('POST', `/api/emails/${threadIdA}/reply`, {
      content: 'Unauthorized reply'
    }, { Authorization: `Bearer ${tokenB}` });
    assert(replyCrossThread.status === 403 && replyCrossThread.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant email reply: 403 (${replyCrossThread.body.code})`);

    // 6.4 Compose email to cross-tenant candidate
    const composeCross = await request('POST', '/api/emails/compose', {
      candidateId: candidateIdA,
      subject: 'Phishing Attempt',
      content: 'Unauthorized content'
    }, { Authorization: `Bearer ${tokenB}` });
    assert(composeCross.status === 403 && composeCross.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked compose email to another company's candidate: 403 (${composeCross.body.code})`);

    // -------------------------------------------------------------
    // Step 7: Verify Cross-Tenant Block on Clients
    // -------------------------------------------------------------
    console.log('\n--- Step 7: Cross-Tenant Isolation Tests on Clients ---');

    // 7.1 Query cross-tenant clients list
    const listCrossClients = await request('GET', `/api/clients?orgId=${orgIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(listCrossClients.status === 403 && listCrossClients.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant clients list: 403 (${listCrossClients.body.code})`);

    // 7.2 Get cross-tenant client by ID
    const getCrossClient = await request('GET', `/api/clients/${clientIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(getCrossClient.status === 403 && getCrossClient.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant GET client: 403 (${getCrossClient.body.code})`);

    // 7.3 Update cross-tenant client
    const putCrossClient = await request('PUT', `/api/clients/${clientIdA}`, {
      companyName: 'Hacked Client'
    }, { Authorization: `Bearer ${tokenB}` });
    assert(putCrossClient.status === 403 && putCrossClient.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant PUT client: 403 (${putCrossClient.body.code})`);

    // 7.4 Delete cross-tenant client
    const delCrossClient = await request('DELETE', `/api/clients/${clientIdA}`, null, { Authorization: `Bearer ${tokenB}` });
    assert(delCrossClient.status === 403 && delCrossClient.body.code === 'TENANT_ISOLATION_VIOLATION',
      `Blocked cross-tenant DELETE client: 403 (${delCrossClient.body.code})`);

    // -------------------------------------------------------------
    // Step 8: Platform Admin Global Access Verification
    // -------------------------------------------------------------
    console.log('\n--- Step 8: Platform Admin Global Access Verification ---');
    const adminLoginStart = await request('POST', '/api/auth/login/start', { email: 'admin@hiredeskhr.com' });
    const adminOtp = adminLoginStart.body.devEmailOtp || getSessionOtp(adminLoginStart.body.sessionId);
    const adminVerify = await request('POST', '/api/auth/login/verify', {
      sessionId: adminLoginStart.body.sessionId,
      otp: adminOtp,
      email: 'admin@hiredeskhr.com'
    });
    assert(adminVerify.status === 200 && !!adminVerify.body.token, `Platform Admin authenticated`);
    const adminToken = adminVerify.body.token;

    // Platform Admin can view Company A's job
    const adminGetJobA = await request('GET', `/api/jobs/${jobIdA}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(adminGetJobA.status === 200 && adminGetJobA.body.id === jobIdA,
      `Platform Admin can access Company A job (${adminGetJobA.body?.title})`);

    // Platform Admin can view Company B's job
    const adminGetJobB = await request('GET', `/api/jobs/${jobIdB}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(adminGetJobB.status === 200 && adminGetJobB.body.id === jobIdB,
      `Platform Admin can access Company B job (${adminGetJobB.body?.title})`);

    // Platform Admin can query specific company jobs via ?orgId=
    const adminListA = await request('GET', `/api/jobs?orgId=${orgIdA}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(adminListA.status === 200 && adminListA.body.some(j => j.id === jobIdA),
      `Platform Admin can query Company A specific jobs with orgId parameter`);

    console.log('\n================================================================');
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Unhandled test failure:', err);
    process.exit(1);
  }
}

runTests();
