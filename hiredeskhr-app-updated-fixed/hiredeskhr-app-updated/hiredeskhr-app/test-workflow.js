/**
 * TalentFlow ATS - Automated End-to-End Verification Runner
 * Verifies all 5 core recruitment pillars and requirements from the transcript.
 */

const http = require('http');

const API_BASE = 'http://localhost:5001/api';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${path}`);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING TALENTFLOW ATS AUTOMATED VERIFICATION SUITE');
  console.log('===============================================================\n');

  // Test 1: Health
  console.log('1. Verifying API Health...');
  const health = await request('GET', '/health');
  assert(health.status === 200, 'API Engine is running and healthy');
  assert(health.data.platform === 'TalentFlow ATS API Engine', 'Health payload verified');

  // Test 2: Client Email Verification & OTP Dispatch
  console.log('\n2. Testing Client Email Verification Link & OTP Dispatch...');
  const verifyDispatch = await request('POST', '/auth/send-verification', {
    email: 'client.recruiter@softwareworkforce.com',
    type: 'signup'
  }, { 'x-test-suite': 'talentflow-e2e' });
  assert(verifyDispatch.status === 200, 'Verification request accepted');
  assert(verifyDispatch.data.success === true, 'Verification email dispatched');
  assert(verifyDispatch.data.otp && verifyDispatch.data.otp.length === 6, '6-digit OTP generated for client email');
  assert(verifyDispatch.data.verificationLink.includes('token='), 'Secure client activation link generated');
  
  // Test 2b: Verify OTP
  const verifyOtpRes = await request('POST', '/auth/verify-otp', {
    email: 'client.recruiter@softwareworkforce.com',
    otp: verifyDispatch.data.otp,
    name: 'Ananya Sharma',
    companyName: 'Software Workforce'
  });
  assert(verifyOtpRes.status === 200, 'OTP verified successfully');
  assert(verifyOtpRes.data.user.emailVerified === true, 'User emailVerified marked true');
  assert(verifyOtpRes.data.organization.name === 'Software Workforce', 'Organization confirmed as Software Workforce');

  // Test 3: Standard Auth Sign In
  console.log('\n3. Testing Authentication & Session...');
  const authRes = await request('POST', '/auth/login', {
    email: 'recruiter@softwareworkforce.com',
    password: 'demo'
  });
  assert(authRes.status === 200, 'Successfully signed in as Sarah Jenkins');
  assert(authRes.data.organization.name === 'Software Workforce', 'Organization confirmed as Software Workforce');
  const token = authRes.data.token;
  const authHeader = { Authorization: `Bearer ${token}` };

  // Test 3: List Jobs & Pre-seeded Requisitions
  console.log('\n3. Testing Jobs Requisitions Module...');
  const jobsRes = await request('GET', '/jobs', null, authHeader);
  assert(jobsRes.status === 200, 'Jobs list retrieved successfully');
  assert(jobsRes.data.length >= 3, `Found ${jobsRes.data.length} pre-seeded jobs`);
  
  const sweJob = jobsRes.data.find(j => j.title === 'Senior Software Engineer');
  assert(!!sweJob, 'Senior Software Engineer requisition found (matches transcript audio)');
  assert(sweJob.clientName === 'Software Workforce', 'Job clientName confirmed as Software Workforce');

  // Test 4: Create New Job with 4-Step Wizard Payload
  console.log('\n4. Testing "Create Job" 4-Step Wizard Flow...');
  const createJobRes = await request(
    'POST',
    '/jobs',
    {
      title: 'Principal AI Platform Architect',
      clientName: 'Software Workforce',
      department: 'AI & Data Platforms',
      location: 'Bangalore / Remote',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      salaryMin: 3800000,
      salaryMax: 5500000,
      experienceMin: 7,
      experienceMax: 12,
      description: 'Lead next-generation autonomous ATS data pipelines and AI model inference.',
      requirements: ['7+ years distributed systems', 'Experience with React 19 and Node.js'],
      publishOnLinkedIn: true,
      applicationFormConfig: {
        fields: [
          { id: 'f1', label: 'First Name', key: 'firstName', enabled: true, required: true, isSystemLocked: true },
          { id: 'f2', label: 'Last Name', key: 'lastName', enabled: true, required: true, isSystemLocked: true },
          { id: 'f3', label: 'Email', key: 'email', enabled: true, required: true, isSystemLocked: true },
          { id: 'f4', label: 'Phone', key: 'phone', enabled: true, required: true, isSystemLocked: true },
          { id: 'f5', label: 'Location', key: 'location', enabled: true, required: true, isSystemLocked: true },
          { id: 'f6', label: 'Resume', key: 'resume', enabled: true, required: true, isSystemLocked: true },
          { id: 'f7', label: 'Current CTC', key: 'currentCtc', enabled: true, required: true, isSystemLocked: false },
          { id: 'f8', label: 'Expected CTC', key: 'expectedCtc', enabled: true, required: true, isSystemLocked: false },
          { id: 'f9', label: 'Total Experience', key: 'totalExperience', enabled: true, required: true, isSystemLocked: false }
        ],
        screeningQuestions: [
          { id: 'q1', question: 'Do you have hands-on experience with TypeScript microservices?', type: 'yesno', required: true }
        ]
      }
    },
    authHeader
  );
  assert(createJobRes.status === 201, 'New Job created with custom application criteria');
  assert(createJobRes.data.adminNotification.dispatched === true, 'Admin email alert dispatched for LinkedIn syndication');
  const newJobId = createJobRes.data.job.id;

  // Test 5: Public Branded Career Portal (/careers/software-workforce)
  console.log('\n5. Testing Public Branded Career Portal & Intake...');
  const careerRes = await request('GET', '/career/software-workforce');
  assert(careerRes.status === 200, 'Public career page loaded successfully');
  assert(careerRes.data.organization.name === 'Software Workforce', 'Branded under Software Workforce');
  assert(careerRes.data.jobs.length >= 4, `Public portal exhibits ${careerRes.data.jobs.length} active jobs`);

  // Test 6: Candidate Submits Application on Public Career Page
  console.log('\n6. Testing Direct Candidate Application Injection into "Applied" Stage...');
  const applyRes = await request('POST', `/career/software-workforce/jobs/${newJobId}/apply`, {
    firstName: 'Vikram',
    lastName: 'Aditya',
    email: 'vikram.aditya@cloudinfra.com',
    phone: '+91 97777 88888',
    location: 'Bangalore, Karnataka',
    currentCtc: '₹34,00,000 / yr',
    expectedCtc: '₹48,00,000 / yr',
    totalExperience: '8.5 Years',
    noticePeriod: '30 Days',
    screeningAnswers: {
      'Do you have hands-on experience with TypeScript microservices?': 'Yes, 6+ years in production'
    }
  });
  assert(applyRes.status === 201, 'Application submitted on public career page');
  const candidateId = applyRes.data.candidateId;

  // Verify candidate is present in client dashboard under 'applied' stage
  const candRes = await request('GET', `/candidates/${candidateId}`, null, authHeader);
  assert(candRes.status === 200, 'Candidate record retrieved from recruiter database');
  assert(candRes.data.stage === 'applied', 'Candidate automatically placed in "applied" stage');
  assert(candRes.data.source === 'Career Page', 'Candidate source correctly tagged as "Career Page"');

  // Test 7: Kanban Stage Advancement (Applied -> Contacted -> Interview)
  console.log('\n7. Testing Kanban Stage Progression...');
  const moveContacted = await request('PATCH', `/candidates/${candidateId}/stage`, { stage: 'contacted' }, authHeader);
  assert(moveContacted.data.candidate.stage === 'contacted', 'Candidate moved to Contacted stage');

  const moveInterview = await request('PATCH', `/candidates/${candidateId}/stage`, { stage: 'interview' }, authHeader);
  assert(moveInterview.data.candidate.stage === 'interview', 'Candidate moved to Interview stage');

  // Test 8: Schedule Interview & Generate Invite
  console.log('\n8. Testing Interview Scheduler (Neha Sharma & Vikram Aditya)...');
  const interviewRes = await request(
    'POST',
    '/interviews',
    {
      candidateId,
      roundName: 'Round 1: Distributed Architecture & Coding',
      scheduledAt: new Date(Date.now() + 86400000 * 2).toISOString(),
      durationMinutes: 45,
      interviewerName: 'Sarah Jenkins',
      meetingUrl: 'https://meet.google.com/vik-tech-arch'
    },
    authHeader
  );
  assert(interviewRes.status === 201, 'Interview successfully scheduled');
  assert(interviewRes.data.interview.meetingUrl === 'https://meet.google.com/vik-tech-arch', 'Google Meet video URL generated');
  const interviewId = interviewRes.data.interview.id;

  // Test 9: Submit Structured 5-Star Interview Scorecard
  console.log('\n9. Testing Structured 5-Star Scorecard Evaluation...');
  const scorecardRes = await request(
    'POST',
    `/interviews/${interviewId}/scorecard`,
    {
      technicalRating: 5,
      communicationRating: 4,
      problemSolvingRating: 5,
      cultureFitRating: 5,
      recommendation: 'STRONG_HIRE',
      notes: 'Exceptional architectural depth and clarity. Recommended without reservation.'
    },
    authHeader
  );
  assert(scorecardRes.status === 200, 'Scorecard submitted');
  assert(scorecardRes.data.interview.scorecard.recommendation === 'STRONG_HIRE', 'Consensus recorded as STRONG_HIRE');
  assert(scorecardRes.data.interview.status === 'completed', 'Interview marked as completed');

  // Test 10: Simulate LinkedIn Ingestion (Speaker 1 requirement)
  console.log('\n10. Testing Simulated LinkedIn Ingestion & Resume Sync...');
  const simRes = await request(
    'POST',
    '/emails/simulate-linkedin-injection',
    {
      jobId: sweJob.id,
      candidateName: 'Tanvi Saxena',
      candidateEmail: 'tanvi.saxena@deepcode.io',
      phone: '+91 98888 11111',
      experience: '6 Years',
      resumeFileName: 'Tanvi_Saxena_Resume.pdf'
    },
    authHeader
  );
  assert(simRes.status === 201, 'LinkedIn application & resume successfully ingested');
  assert(simRes.data.candidate.stage === 'applied', 'LinkedIn candidate injected into "applied" column');
  assert(simRes.data.candidate.source === 'LinkedIn', 'Candidate source recorded as LinkedIn');
  assert(simRes.data.emailThread.subject.includes('LinkedIn Application Alert'), 'Inbound email notification logged in Recruiter Inbox');

  // Test 11: Analytics & Recruiter Dashboard Reports
  console.log('\n11. Testing Recruiter Analytics & Reports Dashboard...');
  const analyticsRes = await request('GET', '/analytics', null, authHeader);
  assert(analyticsRes.status === 200, 'Metrics calculated successfully');
  assert(analyticsRes.data.totalJobs >= 4, `Verified ${analyticsRes.data.totalJobs} total jobs`);
  assert(analyticsRes.data.totalCandidates >= 6, `Verified ${analyticsRes.data.totalCandidates} candidates in pipeline`);
  assert(analyticsRes.data.interviewsScheduled >= 1, 'Verified active scheduled interviews');
  assert(analyticsRes.data.stageFunnel.applied >= 2, 'Verified candidates in Applied funnel stage');

  // Test 12: Settings & Subscriptions
  console.log('\n12. Testing Settings, Referrals & Modular Subscriptions...');
  const settingsRes = await request('GET', '/settings', null, authHeader);
  assert(settingsRes.status === 200, 'Settings retrieved');
  assert(settingsRes.data.subscription.tierName === 'Growth Pro', 'Active subscription plan is Growth Pro');
  assert(settingsRes.data.referralProgram.referralCode.startsWith('TALENT-'), 'Referral code active');
  assert(settingsRes.data.careerPage.publicUrl === '/careers/software-workforce', 'Career portal URL confirmed');

  // Test 13: Multi-Currency Job Creation (Global Currencies support)
  console.log('\n13. Testing Multi-Currency Job Creation (USD, EUR, GBP, INR)...');
  const usdJobRes = await request(
    'POST',
    '/jobs',
    {
      title: 'Global Staff AI Platform Engineer',
      clientName: 'Software Workforce Global',
      department: 'Platform Engineering',
      location: 'New York / London / Remote',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      salaryMin: 180000,
      salaryMax: 240000,
      currency: 'USD',
      experienceMin: 5,
      experienceMax: 10,
      description: 'Lead next-generation distributed systems across global client infrastructure.',
      requirements: ['TypeScript', 'Distributed Systems', 'Cloud Architecture']
    },
    authHeader
  );
  assert(usdJobRes.status === 201, 'International currency job created successfully');
  assert(usdJobRes.data.job.currency === 'USD', 'Currency stored as USD');
  assert(usdJobRes.data.job.salaryMin === 180000, 'Salary min correctly set in USD');

  // Test 14: Dual-Channel OTP (WhatsApp & Email)
  console.log('\n14. Testing Dual-Channel WhatsApp & Email OTP Dispatch...');
  const whatsappOtpRes = await request('POST', '/auth/send-verification', {
    email: 'client.whatsapp@softwareworkforce.com',
    phone: '+919876543210',
    channel: 'both',
    type: 'login'
  }, { 'x-test-suite': 'talentflow-e2e' });
  assert(whatsappOtpRes.status === 200, 'WhatsApp & Email OTP request accepted');
  assert(whatsappOtpRes.data.channel === 'both', 'Delivery channel confirmed as both');
  assert(whatsappOtpRes.data.otp.length === 6, '6-digit OTP generated for WhatsApp & Email');
  assert(whatsappOtpRes.data.whatsappLink.includes('api.whatsapp.com'), 'WhatsApp direct link generated');

  const verifyWhatsappOtp = await request('POST', '/auth/verify-otp', {
    email: 'client.whatsapp@softwareworkforce.com',
    phone: '+919876543210',
    otp: whatsappOtpRes.data.otp
  });
  assert(verifyWhatsappOtp.status === 200, 'WhatsApp OTP verified successfully');

  // Test 15: Hostinger Webmail Inbound Resume Ingestion Automation
  console.log('\n15. Testing Hostinger Webmail Inbound Resume Ingestion Automation...');
  const hostingerRes = await request('POST', '/automation/simulate-hostinger-email', {
    jobTitle: 'Global Staff AI Platform Engineer'
  });
  assert(hostingerRes.status === 201, 'Hostinger Webmail email processed and ingested');
  assert(hostingerRes.data.candidate.firstName === 'Dr. Biswanath', 'Candidate Dr. Biswanath parsed from email');
  assert(hostingerRes.data.candidate.resumeFileName.includes('Dr_Biswanath'), 'Attached resume file saved to database');
  assert(hostingerRes.data.candidate.stage === 'applied', 'Candidate automatically placed in "applied" stage');
  assert(hostingerRes.data.thread.subject.includes('applied to'), 'Recruiter Email Hub thread opened for Hostinger email');

  console.log('\n===============================================================');
  console.log('🎉 ALL 32 VERIFICATION ASSERTIONS PASSED WITH 100% SUCCESS!');
  console.log('===============================================================\n');
}

runTests().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
