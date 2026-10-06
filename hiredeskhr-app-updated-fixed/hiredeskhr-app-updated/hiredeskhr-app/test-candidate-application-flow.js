/**
 * Comprehensive Automated Verification Suite for Requirement 6, 7 & 8:
 * Candidate Resume / Application Flow, Security & Multi-Job Application
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5001';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = null;
  }
  return { status: res.status, headers: res.headers, data: json, text };
}

function createPdfBuffer(sizeKb = 250) {
  const targetBytes = sizeKb * 1024;
  const header = '%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <<>> /Contents 4 0 R>> endobj\n4 0 obj <</Length ';
  const filler = 'A'.repeat(Math.max(10, targetBytes - 500));
  const stream = `>> stream\nBT /F1 12 Tf 50 700 Td (${filler}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000210 00000 n \ntrailer <</Size 5 /Root 1 0 R>>\nstartxref\n300\n%%EOF\n`;
  const body = `${header}${stream.length}${stream}`;
  return Buffer.from(body);
}

function createFormData(filename, buffer, mimeType) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fullBody = Buffer.concat([head, buffer, tail]);
  return {
    body: fullBody,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function runTests() {
  console.log('===============================================================');
  console.log('🚀 RUNNING COMPREHENSIVE VERIFICATION SUITE (REQUIREMENTS 6, 7 & 8)');
  console.log('===============================================================\n');

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

  // --- Step 0: Login as Admin and Get Clients & Jobs ---
  console.log('--- Step 0: Setup Credentials & Test Data ---');
  const adminToken = 'token-user-shravani';
  const adminMe = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(adminMe.status === 200, `Admin authentication verified (${adminMe.data?.user?.email})`);

  // Fetch all jobs
  const jobsRes = await request('/api/jobs', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(jobsRes.status === 200 && Array.isArray(jobsRes.data), 'Fetched jobs successfully');
  const allJobs = jobsRes.data || [];

  // Find or create Job A (for Client A - CloudScale) and Job B (for Client B - Apex)
  let jobA = allJobs.find(j => j.clientId === 'client-cloudscale') || allJobs[0];
  let jobB = allJobs.find(j => j.clientId && j.clientId !== jobA.clientId);

  if (!jobB) {
    // Create distinct client and job
    const clientBRes = await request('/api/clients', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: 'Apex Innovations Corp',
        contactPerson: 'David Miller',
        email: 'david.miller@apexinnovations.com',
        phone: '+1 555 9876',
        country: 'United States',
        industry: 'FinTech'
      })
    });
    const clientBId = clientBRes.data.client.id;

    const jobBRes = await request('/api/jobs', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Senior Backend Engineer',
        clientName: 'Apex Innovations Corp',
        clientId: clientBId,
        department: 'Engineering',
        location: 'Remote (United States)',
        country: 'United States',
        workplaceType: 'Remote',
        employmentType: 'Full-time',
        salaryMin: 120000,
        salaryMax: 160000,
        currency: 'USD',
        skills: ['Node.js', 'PostgreSQL', 'Microservices'],
        openingsCount: 2,
        description: 'Lead backend microservices development.',
        requirements: ['5+ years Node.js', 'Distributed systems experience'],
        status: 'active'
      })
    });
    jobB = jobBRes.data?.job || jobBRes.data;
  }

  console.log(`  Job A: [${jobA.jobCode || jobA.id}] "${jobA.title}" (Client: ${jobA.clientName}, ClientId: ${jobA.clientId})`);
  console.log(`  Job B: [${jobB.jobCode || jobB.id}] "${jobB.title}" (Client: ${jobB.clientName}, ClientId: ${jobB.clientId})`);

  // --- Point 12: Reject Invalid/Non-PDF files ---
  console.log('\n--- Test Point 12: Reject Invalid / Non-PDF Files ---');
  const txtBuffer = Buffer.from('This is a plain text resume, not a valid PDF file.');
  const txtForm = createFormData('my_resume.txt', txtBuffer, 'text/plain');
  const txtUploadRes = await request('/api/upload/resume', {
    method: 'POST',
    headers: { 'Content-Type': txtForm.contentType },
    body: txtForm.body
  });
  assert(
    txtUploadRes.status === 400 && txtUploadRes.data?.error?.includes('Only PDF resumes are accepted'),
    `Non-PDF file (.txt) properly rejected with 400: "${txtUploadRes.data?.error}"`
  );

  const exeBuffer = Buffer.from('MZBinaryExecutableSimulation');
  const exeForm = createFormData('malicious.exe', exeBuffer, 'application/x-msdownload');
  const exeUploadRes = await request('/api/upload/resume', {
    method: 'POST',
    headers: { 'Content-Type': exeForm.contentType },
    body: exeForm.body
  });
  assert(
    exeUploadRes.status === 400,
    `Executable file (.exe) properly rejected with 400: "${exeUploadRes.data?.error}"`
  );

  // --- Point 13: Reject Oversized Files (> 5MB) ---
  console.log('\n--- Test Point 13: Reject Oversized Files (> 5 MB) ---');
  const oversizedBuffer = createPdfBuffer(5500); // 5.5 MB
  const oversizedForm = createFormData('giant_resume.pdf', oversizedBuffer, 'application/pdf');
  const oversizedUploadRes = await request('/api/upload/resume', {
    method: 'POST',
    headers: { 'Content-Type': oversizedForm.contentType },
    body: oversizedForm.body
  });
  assert(
    oversizedUploadRes.status === 400 && oversizedUploadRes.data?.error?.includes('too large'),
    `Oversized file (5.5MB) rejected with 400: "${oversizedUploadRes.data?.error}"`
  );

  // --- Point 3: Upload a 200–400 KB PDF ---
  console.log('\n--- Test Point 3: Upload a Valid 200–400 KB PDF ---');
  const validPdfBuffer = createPdfBuffer(280); // 280 KB
  const validForm = createFormData('Rahul_Sharma_Resume.pdf', validPdfBuffer, 'application/pdf');
  const uploadRes = await request('/api/upload/resume', {
    method: 'POST',
    headers: { 'Content-Type': validForm.contentType },
    body: validForm.body
  });
  assert(uploadRes.status === 201 && uploadRes.data?.success === true, 'Valid 280 KB PDF uploaded successfully (201 Created)');
  assert(uploadRes.data?.fileKey && uploadRes.data?.url?.includes('/api/candidates/resume/'), `Secure resume URL generated: ${uploadRes.data?.url}`);
  const uploadedResumeUrl = uploadRes.data.url;
  const uploadedFileKey = uploadRes.data.fileKey;

  // --- Point 1 & 2 & 4: Candidate applies to Job A (JOB-1025) ---
  console.log('\n--- Test Points 1, 2 & 4: Candidate applies to Job A with Job ID ---');
  const candidateEmail = `rahul.${Date.now()}@example.com`;
  const applyJobARes = await request(`/api/career/software-workforce/jobs/${jobA.id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: candidateEmail,
      phone: '+91 98765 43210',
      location: 'Bangalore, India',
      resumeFileName: 'Rahul_Sharma_Resume.pdf',
      resumeUrl: uploadedResumeUrl,
      currentCtc: '₹24,00,000 / yr',
      expectedCtc: '₹32,00,000 / yr',
      totalExperience: '5.5 Years',
      noticePeriod: '30 Days',
      screeningAnswers: { 'Years of Experience': '5.5' },
      source: 'Career Page'
    })
  });
  assert(applyJobARes.status === 201 && applyJobARes.data?.success === true, 'Application to Job A submitted successfully');
  assert(applyJobARes.data?.applicationId && applyJobARes.data.applicationId.startsWith('APP-'), `Application ID created: ${applyJobARes.data?.applicationId}`);
  const applicationAId = applyJobARes.data.applicationId;
  const candidateAId = applyJobARes.data.candidateId;

  // Verify candidate record in backend
  const candidateAGet = await request(`/api/candidates/${candidateAId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(candidateAGet.status === 200, 'Candidate A record fetched');
  assert(candidateAGet.data?.jobId === jobA.id, `Candidate A is linked to Job A ID (${jobA.id})`);
  assert(candidateAGet.data?.applicationId === applicationAId, `Candidate A has exact Application ID (${applicationAId})`);

  // --- Point 7, 8, 9 & 10: Same candidate applies to Job B (JOB-1080) ---
  console.log('\n--- Test Points 7, 8, 9 & 10: Same Candidate applies to Job B (Multi-Job) ---');
  const validPdfBBuffer = createPdfBuffer(310); // 310 KB
  const validBForm = createFormData('Rahul_Sharma_Backend_Resume.pdf', validPdfBBuffer, 'application/pdf');
  const uploadBRes = await request('/api/upload/resume', {
    method: 'POST',
    headers: { 'Content-Type': validBForm.contentType },
    body: validBForm.body
  });
  const uploadedBResumeUrl = uploadBRes.data.url;

  const applyJobBRes = await request(`/api/career/software-workforce/jobs/${jobB.id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: candidateEmail, // SAME EMAIL!
      phone: '+91 98765 43210',
      location: 'Bangalore, India',
      resumeFileName: 'Rahul_Sharma_Backend_Resume.pdf',
      resumeUrl: uploadedBResumeUrl,
      currentCtc: '₹24,00,000 / yr',
      expectedCtc: '₹34,00,000 / yr',
      totalExperience: '5.5 Years',
      noticePeriod: '30 Days',
      source: 'Career Page'
    })
  });
  assert(applyJobBRes.status === 201 && applyJobBRes.data?.success === true, 'Same candidate successfully applied to Job B without duplicate error');
  const applicationBId = applyJobBRes.data.applicationId;
  const candidateBId = applyJobBRes.data.candidateId;
  assert(applicationAId !== applicationBId, `Application A (${applicationAId}) and Application B (${applicationBId}) are distinct records`);
  assert(candidateAId !== candidateBId, `Candidate A record (${candidateAId}) and Candidate B record (${candidateBId}) are separate`);

  // Verify duplicate prevention for the SAME job
  console.log('\n--- Duplicate Prevention: Attempting to apply again to Job A ---');
  const duplicateJobARes = await request(`/api/career/software-workforce/jobs/${jobA.id}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: 'Rahul',
      lastName: 'Sharma',
      email: candidateEmail,
      resumeFileName: 'Rahul_Sharma_Resume.pdf',
      resumeUrl: uploadedResumeUrl
    })
  });
  assert(
    duplicateJobARes.status === 409,
    `Applying twice to the SAME job rejected with 409 Conflict: "${duplicateJobARes.data?.error}"`
  );

  // --- Point 5 & 6: Client Dashboard & Job Candidates Isolation ---
  console.log('\n--- Test Points 5 & 6: Client Dashboard, Job Drill-Down & Resume Download ---');
  // Login as Client A (Alex Rivera, CloudScale)
  const clientAToken = 'token-user-client-alex';

  // Fetch client A portal me
  const clientAPortal = await request('/api/clients/portal/me', {
    headers: {
      Authorization: `Bearer ${clientAToken}`,
      'x-client-id': jobA.clientId || ''
    }
  });
  assert(clientAPortal.status === 200, 'Client A portal loaded successfully');
  const clientACandidates = clientAPortal.data?.candidates || [];
  const foundCandAUnderClientA = clientACandidates.some(c => c.id === candidateAId && c.jobId === jobA.id);
  assert(foundCandAUnderClientA, `Client A sees Candidate under Job A (${jobA.jobCode || jobA.title})`);

  // Verify Job A candidates drill-down endpoint
  const jobACandidatesRes = await request(`/api/clients/portal/me/jobs/${jobA.id}/candidates`, {
    headers: {
      Authorization: `Bearer ${clientAToken}`,
      'x-client-id': jobA.clientId || ''
    }
  });
  assert(jobACandidatesRes.status === 200, `Client A can open Job A drill-down candidates list`);
  const jobACands = jobACandidatesRes.data?.candidates || [];
  assert(jobACands.some(c => c.id === candidateAId), `Job A candidates list contains Candidate A`);
  assert(!jobACands.some(c => c.id === candidateBId), `Job A candidates list DOES NOT contain Candidate B from Job B`);

  // Verify Client A can download/view Candidate A's resume
  const viewResumeRes = await request(`/api/candidates/${candidateAId}/resume`, {
    headers: { Authorization: `Bearer ${clientAToken}` }
  });
  assert(
    viewResumeRes.status === 200 && viewResumeRes.headers.get('content-type')?.includes('application/pdf'),
    'Client A can view/download Candidate A resume as application/pdf'
  );

  // Verify query parameter token download support
  const queryTokenResumeRes = await request(`/api/candidates/${candidateAId}/resume?token=${clientAToken}`);
  assert(
    queryTokenResumeRes.status === 200 && queryTokenResumeRes.headers.get('content-type')?.includes('application/pdf'),
    'Resume view works via URL query param (?token=...) for browser new tabs'
  );

  // --- Point 11: Security & Client Isolation ---
  console.log('\n--- Test Point 11: Client Isolation (Client A cannot download Client B resume) ---');
  // Client A attempts to download Candidate B's resume (who applied to Client B's job)
  const unauthorizedResumeRes = await request(`/api/candidates/${candidateBId}/resume`, {
    headers: { Authorization: `Bearer ${clientAToken}` }
  });
  assert(
    unauthorizedResumeRes.status === 403,
    `Client A downloading Client B resume blocked with 403 Forbidden: "${unauthorizedResumeRes.data?.error}"`
  );

  // Unauthenticated resume download attempt
  const unauthResumeRes = await request(`/api/candidates/${candidateAId}/resume`);
  assert(
    unauthResumeRes.status === 401,
    `Unauthenticated resume access blocked with 401 Unauthorized: "${unauthResumeRes.data?.error}"`
  );

  // Direct /uploads/resumes unauthenticated access
  const directStaticRes = await request(`/uploads/resumes/${uploadedFileKey}`);
  assert(
    directStaticRes.status === 401,
    `Direct unauthenticated access to /uploads/resumes blocked with 401 Unauthorized: "${directStaticRes.data?.error}"`
  );

  // Client A attempting direct /uploads/resumes of Client B's resume
  const fileBKey = path.basename(uploadedBResumeUrl);
  const clientADirectBRes = await request(`/uploads/resumes/${fileBKey}`, {
    headers: { Authorization: `Bearer ${clientAToken}` }
  });
  assert(
    clientADirectBRes.status === 403,
    `Client A accessing Client B resume file directly blocked with 403 Forbidden: "${clientADirectBRes.data?.error}"`
  );

  // --- Candidate Pipeline Stage Update by Client ---
  console.log('\n--- Candidate Pipeline Stage Progression by Client ---');
  const stageUpdateRes = await request(`/api/candidates/${candidateAId}/stage`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${clientAToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ stage: 'screening' })
  });
  assert(
    stageUpdateRes.status === 200 && stageUpdateRes.data?.candidate?.stage === 'screening',
    'Client updated Candidate A stage from "applied" to "screening"'
  );

  // --- Point 14: Existing Functionality Regression Check ---
  console.log('\n--- Test Point 14: Regression Check (Existing Pricing, Location & Interviews) ---');
  const settingsRes = await request('/api/settings', {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(settingsRes.status === 200, 'Settings endpoint functional');
  assert(Boolean(settingsRes.data?.subscription?.plan), `Subscription plan verified: ${settingsRes.data?.subscription?.plan} (${settingsRes.data?.subscription?.tierName})`);

  // Create a new Remote Job to verify Remote (${country}) formatting
  const testRemoteJobRes = await request('/api/jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Global Fullstack Lead',
      clientName: 'CloudScale Global Inc',
      clientId: 'client-cloudscale',
      department: 'Engineering',
      country: 'Japan',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      skills: ['React', 'TypeScript', 'Node.js'],
      openingsCount: 1,
      description: 'Fully remote global role.',
      requirements: ['5+ years React'],
      status: 'draft'
    })
  });
  const createdRemoteJob = testRemoteJobRes.data?.job;
  assert(
    testRemoteJobRes.status === 201 && createdRemoteJob?.location === 'Remote (Japan)',
    `Remote location automatically formatted as "Remote (Japan)": "${createdRemoteJob?.location}"`
  );

  console.log('\n===============================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
