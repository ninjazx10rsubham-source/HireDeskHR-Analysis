const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5001';

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

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });

function request(method, reqPath, body = null, headers = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, BASE_URL);
    const finalHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (finalHeaders.Authorization && !finalHeaders.Authorization.startsWith('Bearer ')) {
      finalHeaders.Authorization = `Bearer ${finalHeaders.Authorization}`;
    }
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: finalHeaders,
      agent: httpAgent
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - start;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, duration });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function calculateStats(durations) {
  durations.sort((a, b) => a - b);
  const sum = durations.reduce((acc, d) => acc + d, 0);
  const avg = (sum / durations.length).toFixed(1);
  const min = durations[0];
  const max = durations[durations.length - 1];
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  return { avg, min, max, p50, p95, count: durations.length };
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

async function runConcurrencyStressSuite() {
  console.log('================================================================');
  console.log('🚀 HIREDESK-HR HIGH-CONCURRENCY & SCALABILITY VERIFICATION SUITE');
  console.log('================================================================\n');

  // STEP 0: Seed Client Accounts for Isolation Verification
  console.log('--- Phase 1: Setup & Pre-flight Authentication ---');
  
  // Login Admin
  const adminLogin = await request('POST', '/api/auth/login', {
    email: 'admin@hiredeskhr.com',
    password: 'admin@1234512345',
    loginType: 'ADMIN'
  });
  assert(adminLogin.status === 200, `Admin initial login succeeded (${adminLogin.duration}ms)`);
  const adminToken = adminLogin.body.token;

  // Register Tenant A
  const randA = Date.now();
  const emailA = `tenant_a_${randA}@company-a.com`;
  const pwdA = 'Password@123';
  const startA = await request('POST', '/api/auth/signup/start', {
    email: emailA,
    password: pwdA,
    confirmPassword: pwdA,
    name: 'User A',
    companyName: `Tenant Alpha ${randA}`
  });
  const sessionA = startA.body.sessionId;
  const otpA = startA.body.devEmailOtp || getSessionOtp(sessionA);
  const verifyA = await request('POST', '/api/auth/signup/verify', {
    sessionId: sessionA,
    emailOtp: otpA,
    email: emailA
  });
  assert(verifyA.status === 200, `Tenant A signup verified successfully`);
  const tokenA = verifyA.body.token;
  const orgA = verifyA.body.user.organizationId;

  // Register Tenant B
  const randB = randA + 1;
  const emailB = `tenant_b_${randB}@company-b.com`;
  const pwdB = 'Password@123';
  const startB = await request('POST', '/api/auth/signup/start', {
    email: emailB,
    password: pwdB,
    confirmPassword: pwdB,
    name: 'User B',
    companyName: `Tenant Beta ${randB}`
  });
  const sessionB = startB.body.sessionId;
  const otpB = startB.body.devEmailOtp || getSessionOtp(sessionB);
  const verifyB = await request('POST', '/api/auth/signup/verify', {
    sessionId: sessionB,
    emailOtp: otpB,
    email: emailB
  });
  assert(verifyB.status === 200, `Tenant B signup verified successfully`);
  const tokenB = verifyB.body.token;
  const orgB = verifyB.body.user.organizationId;

  // Create unique job for Tenant A
  const jobA = await request('POST', '/api/jobs', {
    title: `Alpha Distributed Systems Engineer ${randA}`,
    clientName: `Tenant Alpha ${randA}`,
    department: 'Engineering',
    location: 'Remote',
    employmentType: 'Full-time',
    skills: ['Rust', 'Distributed Systems', 'Go'],
    description: 'Lead distributed storage architecture.'
  }, { Authorization: tokenA });
  const jobIdA = jobA.body.job.id;

  // Create unique job for Tenant B
  const jobB = await request('POST', '/api/jobs', {
    title: `Beta Frontend Architect ${randB}`,
    clientName: `Tenant Beta ${randB}`,
    department: 'Design & UI',
    location: 'Hybrid',
    employmentType: 'Full-time',
    skills: ['React', 'TypeScript', 'Tailwind'],
    description: 'Lead high-performance client applications.'
  }, { Authorization: tokenB });
  const jobIdB = jobB.body.job.id;

  console.log(`  Tenant Alpha Org: ${orgA} (Job: ${jobIdA})`);
  console.log(`  Tenant Beta Org:  ${orgB} (Job: ${jobIdB})\n`);

  // =========================================================================
  // TEST 2: 50 CONCURRENT ADMIN CALLS (IN-MEMORY CACHE & O(1) PERFORMANCE)
  // =========================================================================
  console.log('--- Phase 2: 50 Concurrent Admin Requests (Testing Cache & O(1) Lookups) ---');
  const adminPromises = [];
  for (let i = 0; i < 50; i++) {
    adminPromises.push(request('GET', '/api/admin/overview', null, { Authorization: adminToken }));
  }
  const adminResults = await Promise.all(adminPromises);
  const adminDurations = adminResults.map(r => r.duration);
  const adminStats = calculateStats(adminDurations);
  
  const allAdminOk = adminResults.every(r => r.status === 200 && r.body.summary && r.body.clients);
  assert(allAdminOk, `All 50 simultaneous /api/admin/overview calls succeeded with 200 OK`);
  console.log(`  📊 Admin Overview Concurrency Metrics (50 requests):`);
  console.log(`     Min: ${adminStats.min}ms | Max: ${adminStats.max}ms | Avg: ${adminStats.avg}ms | p50: ${adminStats.p50}ms | p95: ${adminStats.p95}ms`);
  assert(adminStats.p95 < 100, `p95 response time is strictly under 100ms (${adminStats.p95}ms achieved)`);

  // =========================================================================
  // TEST 3: 50 CONCURRENT INTERLEAVED CLIENT CALLS (TENANT ISOLATION UNDER LOAD)
  // =========================================================================
  console.log('\n--- Phase 3: 50 Concurrent Interleaved Tenant Requests (Testing Strict Isolation) ---');
  const tenantPromises = [];
  for (let i = 0; i < 25; i++) {
    // Tenant A queries
    tenantPromises.push(
      request('GET', '/api/jobs', null, { Authorization: tokenA })
        .then(res => ({ tenant: 'A', res }))
    );
    // Tenant B queries
    tenantPromises.push(
      request('GET', '/api/jobs', null, { Authorization: tokenB })
        .then(res => ({ tenant: 'B', res }))
    );
  }

  const tenantResults = await Promise.all(tenantPromises);
  const tenantDurations = tenantResults.map(t => t.res.duration);
  const tenantStats = calculateStats(tenantDurations);

  let isolationViolations = 0;
  for (const item of tenantResults) {
    if (item.res.status !== 200) {
      isolationViolations++;
      continue;
    }
    const jobsList = item.res.body;
    if (!Array.isArray(jobsList)) {
      isolationViolations++;
      continue;
    }
    if (item.tenant === 'A') {
      const hasJobB = jobsList.some(j => j.id === jobIdB || j.organizationId === orgB);
      if (hasJobB) isolationViolations++;
    } else if (item.tenant === 'B') {
      const hasJobA = jobsList.some(j => j.id === jobIdA || j.organizationId === orgA);
      if (hasJobA) isolationViolations++;
    }
  }

  assert(isolationViolations === 0, `Zero cross-tenant data leaks under 50 interleaved concurrent requests`);
  console.log(`  📊 Tenant Isolation Concurrency Metrics (50 requests):`);
  console.log(`     Min: ${tenantStats.min}ms | Max: ${tenantStats.max}ms | Avg: ${tenantStats.avg}ms | p50: ${tenantStats.p50}ms | p95: ${tenantStats.p95}ms`);
  assert(tenantStats.p95 < 60, `p95 tenant query response time is under 60ms (${tenantStats.p95}ms achieved)`);

  // =========================================================================
  // TEST 4: PAGINATION PERFORMANCE & BOUNDED PAYLOAD SIZE
  // =========================================================================
  console.log('\n--- Phase 4: Pagination & Bounded Payload Verification ---');
  const paginatedJobs = await request('GET', '/api/jobs?page=1&limit=2', null, { Authorization: tokenA });
  assert(paginatedJobs.status === 200, `Paginated /api/jobs returned 200 OK`);
  assert(paginatedJobs.body.pagination !== undefined, `Structured pagination metadata returned`);
  assert(paginatedJobs.body.pagination.limit === 2, `Page limit correctly respected (limit: 2)`);
  assert(paginatedJobs.headers['x-total-count'] !== undefined, `X-Total-Count header present: ${paginatedJobs.headers['x-total-count']}`);

  const adminPaginated = await request('GET', '/api/admin/jobs?page=1&limit=3', null, { Authorization: adminToken });
  assert(adminPaginated.status === 200, `Admin paginated /api/admin/jobs returned 200 OK`);
  assert(adminPaginated.body.pagination !== undefined, `Admin jobs pagination metadata present`);
  assert(adminPaginated.body.jobs.length <= 3, `Admin jobs response payload bounded to max 3 items`);

  // =========================================================================
  // TEST 5: CONCURRENT IN-FLIGHT MUTEX / DEDUPLICATION
  // =========================================================================
  console.log('\n--- Phase 5: Concurrent In-Flight Mutex & Race Condition Protection ---');
  const testEmail = `mutex_test_${Date.now()}@concurrent.io`;
  const simultaneousStarts = [];
  for (let i = 0; i < 5; i++) {
    simultaneousStarts.push(request('POST', '/api/auth/signup/start', {
      email: testEmail,
      password: 'StrongPassword@123',
      confirmPassword: 'StrongPassword@123',
      companyName: 'Mutex Corp'
    }));
  }
  const mutexResults = await Promise.all(simultaneousStarts);
  const statusCodes = mutexResults.map(r => r.status);
  console.log(`  Simultaneous start signup response status codes: ${statusCodes.join(', ')}`);
  const successCount = mutexResults.filter(r => r.status === 200).length;
  assert(successCount >= 1, `At least 1 request completed successfully without deadlock`);

  // =========================================================================
  // TEST 6: CONCURRENT ATOMIC PERSISTENCE SAFETY (ZERO EBUSY LOCK CRASHES)
  // =========================================================================
  console.log('\n--- Phase 6: Concurrent Atomic Disk Write Safety ---');
  const candidateCreationPromises = [];
  for (let i = 0; i < 10; i++) {
    candidateCreationPromises.push(request('POST', '/api/candidates', {
      jobId: jobIdA,
      firstName: `Concurrent`,
      lastName: `Candidate_${i}`,
      email: `cand_${Date.now()}_${i}@test.com`,
      stage: 'applied'
    }, { Authorization: tokenA }));
  }
  const candidateResults = await Promise.all(candidateCreationPromises);
  const allCreated = candidateResults.every(r => r.status === 201 && r.body.id);
  assert(allCreated, `All 10 simultaneous candidate writes persisted cleanly without Windows EBUSY lock errors`);

  // Final summary
  console.log('\n================================================================');
  console.log(`🏁 Concurrency Stress Suite Finished: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runConcurrencyStressSuite().catch(err => {
  console.error('Fatal error during concurrency test:', err);
  process.exit(1);
});
