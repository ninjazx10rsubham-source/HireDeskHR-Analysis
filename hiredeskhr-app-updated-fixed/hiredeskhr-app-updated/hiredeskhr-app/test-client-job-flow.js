const API_BASE = 'http://localhost:5001/api';
const fs = require('fs');
const path = require('path');

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function getOtpForSession(sessionId) {
  try {
    const sessionsFile = path.resolve(__dirname, 'backend/src/data/sessions.json');
    if (fs.existsSync(sessionsFile)) {
      const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'));
      const found = data.find(([id]) => id === sessionId);
      if (found && found[1]) return found[1].emailOtp;
    }
  } catch (e) {}
  return null;
}

async function runClientJobFlowTest() {
  console.log('====================================================');
  console.log('🧪 TESTING CLIENT JOB LIFECYCLE (CLOSE ONLY, NO DELETE)');
  console.log('====================================================\n');

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

  // 1. Authenticate Client
  console.log('--- Step 1: Client Authentication ---');
  const clientEmail = `client_${Date.now()}@acmeinnovations.com`;
  const signupStartRes = await request('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Elena Rostova',
      companyName: 'Acme Innovations Inc',
      email: clientEmail,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert(signupStartRes.status === 200, 'Client signup initiation succeeded');

  const otp = signupStartRes.data.devEmailOtp || getOtpForSession(signupStartRes.data.sessionId);
  assert(Boolean(otp), 'Signup OTP code retrieved successfully');

  const verifyRes = await request('/auth/signup/verify', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: signupStartRes.data.sessionId,
      emailOtp: otp
    })
  });
  assert(verifyRes.status === 200 && verifyRes.data.token, 'Client verified OTP and received auth token');
  const clientToken = verifyRes.data.token;

  // 2. Client Posts a Job Requisition
  console.log('\n--- Step 2: Client Posts a Job Requisition ---');
  const jobPayload = {
    title: 'Senior Frontend Architect',
    department: 'Engineering',
    location: 'Austin, TX',
    workplaceType: 'Remote',
    employmentType: 'Full-time',
    description: 'Lead modern frontend architecture using React, Vite, and TypeScript.',
    requirements: ['7+ years experience with React and TypeScript', 'Strong system design skills'],
    skills: ['React', 'TypeScript', 'TailwindCSS', 'GraphQL'],
    salaryMin: 140000,
    salaryMax: 180000,
    currency: 'USD',
    experienceMin: 5,
    experienceMax: 10,
    openingsCount: 3
  };

  const postJobRes = await request('/jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify(jobPayload)
  });

  assert(postJobRes.status === 201 && postJobRes.data.job, 'Job posted successfully with 201 Created');
  const createdJob = postJobRes.data.job;
  assert(createdJob.status === 'active', 'Initial job status is "active"');
  assert(createdJob.title === 'Senior Frontend Architect', 'Job title correctly preserved');
  assert(createdJob.openingsCount === 3, 'Openings count correctly stored');

  // 3. Client Attempts to DELETE the Job -> MUST BE BLOCKED (403 Forbidden)
  console.log('\n--- Step 3: Verify Client CANNOT Delete Job (403 Forbidden) ---');
  const deleteAttemptRes = await request(`/jobs/${createdJob.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${clientToken}` }
  });

  assert(
    deleteAttemptRes.status === 403,
    `Client DELETE request is blocked with 403 Forbidden (${deleteAttemptRes.data.error})`
  );

  // 4. Verify Job STILL Exists in System and Database
  console.log('\n--- Step 4: Verify Job Data Intact in System & Database ---');
  const getJobRes = await request(`/jobs/${createdJob.id}`, {
    headers: { Authorization: `Bearer ${clientToken}` }
  });
  assert(getJobRes.status === 200 && getJobRes.data.id === createdJob.id, 'Job requisition remains 100% intact in database after failed delete');

  // 5. Client Closes the Job via Close Action
  console.log('\n--- Step 5: Client Closes the Job (Close Job Button) ---');
  const closeJobRes = await request(`/jobs/${createdJob.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify({ status: 'closed' })
  });

  assert(closeJobRes.status === 200, 'Close job API call returns 200 OK');
  assert(closeJobRes.data.job?.status === 'closed', 'Job status successfully transitioned to "closed"');

  // 6. Verify Closed Job is Retained with All History
  console.log('\n--- Step 6: Verify Closed Job Retains Complete Data & History ---');
  const clientJobsListRes = await request('/jobs?status=all', {
    headers: { Authorization: `Bearer ${clientToken}` }
  });
  const clientJobs = clientJobsListRes.data.data || clientJobsListRes.data;
  const foundClosedJob = Array.isArray(clientJobs) && clientJobs.find(j => j.id === createdJob.id);

  assert(Boolean(foundClosedJob), 'Closed job is returned in client jobs list (preserved in history)');
  assert(foundClosedJob.status === 'closed', 'Closed job retains status "closed"');
  assert(foundClosedJob.description === jobPayload.description, 'Job description remains intact');
  assert(foundClosedJob.skills?.length === jobPayload.skills.length, 'Skills list remains intact');

  // 7. Client Reopens the Job (Reopen Job Button)
  console.log('\n--- Step 7: Client Reopens the Job (Reopen Job Button) ---');
  const reopenJobRes = await request(`/jobs/${createdJob.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${clientToken}` },
    body: JSON.stringify({ status: 'active' })
  });

  assert(reopenJobRes.status === 200, 'Reopen job API call returns 200 OK');
  assert(reopenJobRes.data.job?.status === 'active', 'Job status successfully restored to "active"');

  // 8. Verify Admin Functionality Remains Unchanged
  console.log('\n--- Step 8: Verify Admin Functionality Remains Intact ---');
  const adminLoginRes = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'admin@hiredeskhr.com',
      password: 'admin@1234512345',
      loginType: 'ADMIN'
    })
  });
  assert(adminLoginRes.status === 200 && adminLoginRes.data.token, 'Admin logs in successfully');
  const adminToken = adminLoginRes.data.token;

  const adminJobsRes = await request('/admin/jobs', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminJobsRes.status === 200 && Array.isArray(adminJobsRes.data.jobs), 'Admin can view all platform jobs');

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runClientJobFlowTest().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
