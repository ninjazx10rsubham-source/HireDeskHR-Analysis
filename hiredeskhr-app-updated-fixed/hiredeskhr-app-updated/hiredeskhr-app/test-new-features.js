const API_BASE = 'http://localhost:5001/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 TESTING NEW FEATURES & FIXES');
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

  // ----------------------------------------------------
  // TEST 1: Client Signup Company Name Validation
  // ----------------------------------------------------
  console.log('--- TEST 1: Client Signup Company Name Requirement ---');
  const missingCompanyRes = await request('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Client User',
      email: `client_${Date.now()}@acmetest.com`,
      password: 'password123',
      confirmPassword: 'password123'
      // missing companyName
    })
  });
  assert(missingCompanyRes.status === 400 && missingCompanyRes.data.field === 'companyName', 'Signup rejects missing Company Name with 400');

  const emptyCompanyRes = await request('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Client User',
      companyName: '   ',
      email: `client_${Date.now()}@acmetest.com`,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert(emptyCompanyRes.status === 400 && emptyCompanyRes.data.field === 'companyName', 'Signup rejects whitespace-only Company Name with 400');

  const validEmail = `client_${Date.now()}@acmetestcorp.com`;
  const validSignupRes = await request('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Sarah Conner',
      companyName: 'Cyberdyne Systems Corp',
      email: validEmail,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });
  assert(validSignupRes.status === 200 && validSignupRes.data.success, 'Signup with required Company Name succeeds');

const fs = require('fs');
const path = require('path');

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

  const otpCode = validSignupRes.data.devEmailOtp || getOtpForSession(validSignupRes.data.sessionId);
  let clientToken = '';
  let clientOrgId = '';
  let clientId = '';

  if (otpCode) {
    const verifyRes = await request('/auth/signup/verify', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: validSignupRes.data.sessionId,
        emailOtp: otpCode
      })
    });
    assert(verifyRes.status === 200 && verifyRes.data.token, 'Client OTP verification completes successfully');
    clientToken = verifyRes.data.token;
    clientOrgId = verifyRes.data.organization?.id;
    clientId = verifyRes.data.user?.clientId;

    // Verify /auth/me returns companyName
    const meRes = await request('/auth/me', {
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(meRes.data.organization?.name === 'Cyberdyne Systems Corp', 'Organization name is saved as Cyberdyne Systems Corp');
    assert(meRes.data.user?.companyName === 'Cyberdyne Systems Corp', 'User profile reflects Company Name');
  }

  // ----------------------------------------------------
  // TEST 2: Client Job Deletion Protection
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Client Job Deletion Protection (Close Only) ---');
  let testJobId = '';
  if (clientToken) {
    // Post a job as client
    const createJobRes = await request('/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({
        title: 'Cyber Security Specialist',
        department: 'Security',
        location: 'San Francisco, CA',
        workplaceType: 'Remote',
        employmentType: 'Full-time',
        description: 'Protect corporate mainframe against unauthorized network intrusions.',
        requirements: ['3+ years in SOC operations', 'CISSP certification'],
        skills: ['Cybersecurity', 'Firewalls', 'SIEM'],
        salaryMin: 110000,
        salaryMax: 150000,
        currency: 'USD',
        experienceMin: 3,
        experienceMax: 7,
        openingsCount: 2
      })
    });
    assert(createJobRes.status === 201 && createJobRes.data.job, 'Client can post a new job requisition');
    testJobId = createJobRes.data.job?.id;

    // Try to DELETE job as client -> MUST BE 403
    const deleteAttempt = await request(`/jobs/${testJobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${clientToken}` }
    });
    assert(deleteAttempt.status === 403, `Client DELETE job is blocked with 403 Forbidden (${deleteAttempt.data.error})`);

    // Close job via PATCH status -> MUST BE 200
    const closeAttempt = await request(`/jobs/${testJobId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({ status: 'closed' })
    });
    assert(closeAttempt.status === 200 && closeAttempt.data.job?.status === 'closed', 'Client can close job and retain history');
  }

  // ----------------------------------------------------
  // TEST 3: Admin Login & Job Details
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Admin Login & Complete Job Details ---');
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
  assert(adminJobsRes.status === 200 && Array.isArray(adminJobsRes.data.jobs), 'Admin can fetch all platform jobs');

  const targetJob = adminJobsRes.data.jobs.find(j => j.id === testJobId);
  if (targetJob) {
    assert(targetJob.description && targetJob.skills?.length > 0 && targetJob.status === 'closed', 'Admin can inspect complete JD and closed status');
  }

  // ----------------------------------------------------
  // TEST 4: Admin Manual Resume Ingestion to Client Dashboard
  // ----------------------------------------------------
  console.log('\n--- TEST 4: Admin Assign Candidate to Client & Tenant Isolation ---');
  const candidateEmail = `john.connor.${Date.now()}@skynetdefense.io`;
  const assignRes = await request('/admin/candidates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      clientId: clientId,
      jobId: testJobId,
      firstName: 'John',
      lastName: 'Connor',
      email: candidateEmail,
      phone: '+1 555 9876',
      location: 'Los Angeles, CA',
      skills: ['Network Defense', 'Incident Response', 'Python', 'Linux'],
      education: 'B.S. in Computer Engineering',
      totalExperience: '5 Years',
      stage: 'applied',
      resumeFileName: 'John_Connor_Resume.pdf',
      resumeUrl: '/resumes/John_Connor_Resume.pdf',
      notes: 'Received resume via recruiter email. Assigned by Platform Admin.'
    })
  });
  assert(assignRes.status === 201 && assignRes.data.candidate, 'Admin successfully assigns candidate to client');

  // Verify candidate is visible in Client A's Talent Pool
  const clientCandidatesRes = await request('/candidates', {
    headers: { Authorization: `Bearer ${clientToken}` }
  });
  const clientCandidatesList = clientCandidatesRes.data.data || clientCandidatesRes.data;
  const foundInClientA = Array.isArray(clientCandidatesList) && clientCandidatesList.some(c => c.email === candidateEmail);
  assert(foundInClientA, "Candidate appears in target Client's Talent Pool");

  // Create Client B and verify Client B CANNOT see this candidate
  const clientBEmail = `clientB_${Date.now()}@othercorp.com`;
  const clientBStart = await request('/auth/signup/start', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Client B Admin',
      companyName: 'Other Enterprises Ltd',
      email: clientBEmail,
      password: 'password123',
      confirmPassword: 'password123'
    })
  });

  const clientBOtp = clientBStart.data.devEmailOtp || getOtpForSession(clientBStart.data.sessionId);
  if (clientBOtp) {
    const clientBVerify = await request('/auth/signup/verify', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: clientBStart.data.sessionId,
        emailOtp: clientBOtp
      })
    });
    const clientBToken = clientBVerify.data.token;

    const clientBCandidatesRes = await request('/candidates', {
      headers: { Authorization: `Bearer ${clientBToken}` }
    });
    const clientBCandidatesList = clientBCandidatesRes.data.data || clientBCandidatesRes.data;
    const foundInClientB = Array.isArray(clientBCandidatesList) && clientBCandidatesList.some(c => c.email === candidateEmail);
    assert(!foundInClientB, "Candidate is strictly ISOLATED and NOT visible to Client B");
  }

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
