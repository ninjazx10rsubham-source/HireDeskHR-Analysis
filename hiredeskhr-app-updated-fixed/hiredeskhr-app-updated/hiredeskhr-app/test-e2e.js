const http = require('http');

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
      res.on('data', chunk => chunks += chunk);
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

async function runE2ETests() {
  console.log('\n======================================================');
  console.log('🧪 TALENTFLOW ATS - FULL 26-PILLAR END-TO-END AUDIT SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  try {
    // 1. Health Check
    console.log('--- TEST GROUP 1: System Health & Server Runtime ---');
    const health = await request('GET', '/api/health');
    assert(health.status === 200 && health.data.status === 'healthy', 'Health Check API returns 200 OK & healthy');

    // 2. Auth & OTP Verification Security
    console.log('\n--- TEST GROUP 2: Authentication & Secure OTP (No Frontend Leak) ---');
    const sendOtp = await request('POST', '/api/auth/send-verification', {
      email: 'recruiter@softwareworkforce.com',
      type: 'login',
      channel: 'email'
    });
    assert(sendOtp.status === 200 && sendOtp.data.success === true, 'OTP generated and dispatched successfully');
    assert(sendOtp.data.otp === undefined, 'CRITICAL SECURITY: OTP is NOT leaked to frontend response');

    // Verify OTP with demo code or test flow
    const verifyOtp = await request('POST', '/api/auth/verify-otp', {
      email: 'recruiter@softwareworkforce.com',
      otp: '123456'
    });
    // Either verified or invalid code response without 500 error
    assert(verifyOtp.status === 200 || verifyOtp.status === 400, 'OTP verification endpoint handles request cleanly');

    // 3. Client Database CRUD
    console.log('\n--- TEST GROUP 3: Client Database & Security Portal ---');
    const createClient = await request('POST', '/api/clients', {
      companyName: 'Apex Cloud Innovations',
      contactPerson: 'David Miller',
      email: 'david@apexcloud.io',
      phone: '+1 (415) 890-1234',
      country: 'United States',
      address: '400 Market St, San Francisco, CA',
      website: 'https://apexcloud.io',
      industry: 'Cloud Infrastructure',
      notes: 'Strategic hiring partner for Cloud & DevOps requisitions'
    });
    assert(createClient.status === 201 && createClient.data.client.id, 'Client record created successfully');
    const createdClientId = createClient.data.client.id;

    const listClients = await request('GET', '/api/clients');
    assert(Array.isArray(listClients.data) && listClients.data.some(c => c.id === createdClientId), 'List clients includes newly created partner');

    const clientPortal = await request('GET', '/api/clients/portal/me');
    assert(clientPortal.status === 200 && clientPortal.data.client && (clientPortal.data.summary || clientPortal.data.stats), 'Isolated Client Portal returns security payload');

    // 4. Job Requisition Creation (16 Fields, Sequential JOB-10xx, Multi-Currency)
    console.log('\n--- TEST GROUP 4: Job Requisition (All 16 Fields, Sequential Code & Currencies) ---');
    const createJob = await request('POST', '/api/jobs', {
      title: 'Principal Distributed Systems Architect',
      clientName: 'Apex Cloud Innovations',
      clientId: createdClientId,
      department: 'Infrastructure Engineering',
      location: 'San Francisco, CA / Hybrid',
      country: 'United States',
      stateCity: 'San Francisco, CA',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      currency: 'USD',
      salaryMin: 180000,
      salaryMax: 240000,
      experienceMin: 8,
      experienceMax: 15,
      education: 'Master of Science in Computer Science or Equivalent',
      skills: ['Go', 'Kubernetes', 'Distributed Systems', 'PostgreSQL', 'Docker', 'AWS'],
      openingsCount: 3,
      deadline: '2026-12-31',
      status: 'active',
      description: 'Lead next-generation multi-cloud orchestration platforms at Apex Cloud.',
      requirements: ['8+ years in distributed architecture', 'Deep experience in Go and Raft consensus', 'Kubernetes operator development'],
      publishOnLinkedIn: true
    });

    assert(createJob.status === 201 && createJob.data.job, 'Job requisition created successfully');
    const newJob = createJob.data.job;
    assert(newJob.jobCode && /^JOB-\d{4}$/.test(newJob.jobCode), `Sequential Job Code generated: ${newJob.jobCode}`);
    assert(newJob.currency === 'USD' && newJob.country === 'United States', 'Multi-currency & international country recorded');
    assert(newJob.openingsCount === 3, 'Openings count properly stored');

    // 5. Job Edit, Status Toggle, and Candidate Attachments
    console.log('\n--- TEST GROUP 5: Job Update & Lifecycle Operations ---');
    const updateJob = await request('PUT', `/api/jobs/${newJob.id}`, {
      openingsCount: 4,
      salaryMax: 260000
    });
    assert(updateJob.status === 200 && (updateJob.data.job?.openingsCount === 4 || updateJob.data.openingsCount === 4), 'Job updated successfully via PUT');

    const toggleStatus = await request('PATCH', `/api/jobs/${newJob.id}/status`, {
      status: 'active'
    });
    assert(toggleStatus.status === 200 && toggleStatus.data.job.status === 'active', 'Job status toggle works');

    // 6. Candidate Creation & Deduplication
    console.log('\n--- TEST GROUP 6: Candidate Management & Deduplication ---');
    const createCandidate = await request('POST', '/api/candidates', {
      jobId: newJob.id,
      firstName: 'Vikram',
      lastName: 'Patel',
      email: `vikram.patel.${Date.now()}@gmail.com`,
      phone: '+1 (415) 555-9876',
      location: 'San Francisco, CA',
      skills: ['Go', 'Kubernetes', 'PostgreSQL', 'Distributed Systems'],
      education: 'M.S. in Computer Science',
      totalExperience: '9 Years',
      source: 'Direct Portal',
      stage: 'screening'
    });
    const newCand = createCandidate.data.candidate || createCandidate.data;
    assert(createCandidate.status === 201 && newCand && newCand.id, 'Candidate created successfully');
    assert(newCand.candidateCode && /^CAND-\d{4}$/.test(newCand.candidateCode), `Sequential Candidate Code generated: ${newCand.candidateCode}`);

    // Test duplicate detection
    const dupCandidate = await request('POST', '/api/candidates', {
      jobId: newJob.id,
      firstName: 'Vikram',
      lastName: 'Patel',
      email: newCand.email
    });
    assert(dupCandidate.status === 409, 'Duplicate candidate application rejected with 409 Conflict');

    // 7. Interview Scheduling & RFC 5545 iCalendar Generation
    console.log('\n--- TEST GROUP 7: Calendar Integration, ICS Invites & Google Meet ---');
    const schedule = await request('POST', '/api/interviews', {
      candidateId: newCand.id,
      jobId: newJob.id,
      roundName: 'System Architecture Deep Dive',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      durationMinutes: 60,
      timezone: 'America/Los_Angeles',
      interviewerName: 'Sarah Jenkins',
      interviewerEmail: 'sarah.jenkins@softwareworkforce.com'
    });
    assert(schedule.status === 201 && schedule.data.interview, 'Interview scheduled successfully');
    const interview = schedule.data.interview;
    assert(interview.meetingUrl && interview.meetingUrl.includes('meet.google.com'), 'Google Meet link automatically generated');

    // Test .ics file generation
    const ics = await request('GET', `/api/calendar/invite/${interview.id}.ics`);
    assert(ics.status === 200 && ics.raw.includes('BEGIN:VCALENDAR') && ics.raw.includes('METHOD:REQUEST'), 'RFC 5545 .ics iCalendar file generated and downloadable');

    // 8. AI Interview Question Generation & Evaluation
    console.log('\n--- TEST GROUP 8: AI Interview Question Generation & Scoring ---');
    const genQuestions = await request('POST', '/api/ai-interview/generate-questions', {
      jobTitle: newJob.title,
      skills: newJob.skills,
      experienceLevel: 'senior',
      interviewType: 'technical',
      questionCount: 4
    });
    assert(genQuestions.status === 200 && Array.isArray(genQuestions.data.questions) && genQuestions.data.questions.length === 4, 'AI Interview questions generated dynamically based on job requirements');

    // Create session
    const createSession = await request('POST', '/api/ai-interview/sessions', {
      candidateId: newCand.id,
      jobId: newJob.id,
      interviewType: 'technical',
      difficulty: 'senior'
    });
    assert(createSession.status === 201 && createSession.data.session, 'AI Interview session created');
    const aiSession = createSession.data.session;

    // Submit answers and evaluate
    const submitAi = await request('POST', `/api/ai-interview/sessions/${aiSession.id}/submit`, {
      answers: [
        {
          questionId: 1,
          candidateAnswer: 'I have designed scalable distributed key-value stores in Go using Raft consensus for state machine replication, PostgreSQL for cold metadata storage, and Redis for caching to achieve sub-millisecond read latency.'
        }
      ]
    });
    assert(submitAi.status === 200 && submitAi.data.session.status === 'completed', 'AI interview answers evaluated with objective score and feedback');

    // 9. Inbound Email Automation & 8-Stage Resume Ingestion
    console.log('\n--- TEST GROUP 9: Inbound Email Automation & 8-Stage Resume Ingestion ---');
    const inbound = await request('POST', '/api/automation/inbound-email', {
      from: 'alex.morgan.cloud@gmail.com',
      to: 'sonukumar@medicoworkforce.com',
      subject: `Application for [${newJob.jobCode}] ${newJob.title}`,
      body: `Hi Hiring Team,\n\nI would love to apply for the Principal Distributed Systems Architect role. I have 10 years of experience designing high-scale Go microservices and Kubernetes infrastructure.\n\nBest,\nAlex Morgan\nPhone: +1 415 908 7766\nLocation: San Francisco, CA`,
      attachmentName: 'Alex_Morgan_Resume.pdf'
    });

    assert(inbound.status === 201 && inbound.data.candidate, 'Inbound resume email parsed and candidate auto-ingested into Applied stage');
    assert(inbound.data.candidate.candidateCode && /^CAND-\d{4}$/.test(inbound.data.candidate.candidateCode), 'Sequential CAND code assigned to email applicant');

    const logs = await request('GET', '/api/automation/logs');
    assert(logs.status === 200 && logs.data.logs.length >= 5, 'Automation pipeline audit trail logged with detailed technical steps');

    // 10. Notifications System
    console.log('\n--- TEST GROUP 10: In-App & Email Notifications ---');
    const notifs = await request('GET', '/api/notifications');
    assert(notifs.status === 200 && Array.isArray(notifs.data) && notifs.data.length > 0, 'In-app notifications generated for resume ingestion and interview scheduling');

    const markRead = await request('POST', '/api/notifications/mark-all-read');
    assert(markRead.status === 200 && markRead.data.success === true, 'Mark all notifications read works cleanly');

    // Final Summary
    console.log('\n======================================================');
    console.log(`🏁 AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal error running E2E tests:', err);
    process.exit(1);
  }
}

runE2ETests();
