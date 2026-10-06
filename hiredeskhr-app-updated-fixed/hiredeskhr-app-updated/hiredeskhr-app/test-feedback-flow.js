/**
 * test-feedback-flow.js
 * Comprehensive automated test suite for Requirement 9:
 * "Feature Request / Report Feedback Form"
 */

const BASE_URL = 'http://localhost:5001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING REQUIREMENT 9: FEEDBACK & FEATURE REQUEST TESTS');
  console.log('======================================================\n');

  // Test 1: Health check
  const health = await request('/api/health');
  assert(health.ok && health.data?.status === 'healthy', 'Backend health check is operational');

  // Test 2: Validation - Missing name
  const val1 = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ email: 'test@example.com', subject: 'Bug in dashboard', description: 'Cannot see jobs' })
  });
  assert(val1.status === 400 && val1.data?.field === 'name', 'Rejects submission with missing name');

  // Test 3: Validation - Invalid email
  const val2 = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ name: 'John Doe', email: 'not-an-email', subject: 'Feature idea', description: 'Add slack integration' })
  });
  assert(val2.status === 400 && val2.data?.field === 'email', 'Rejects submission with invalid email');

  // Test 4: Validation - Short description
  const val3 = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ name: 'John Doe', email: 'john@example.com', subject: 'Feature idea', description: 'hi' })
  });
  assert(val3.status === 400 && val3.data?.field === 'description', 'Rejects submission with short description (<5 chars)');

  // Test 5: Successful Public Submission: "Request a Feature"
  const timestamp = Date.now();
  const sub1 = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Priya Sharma',
      email: `priya.${timestamp}@techinnovate.io`,
      type: 'Request a Feature',
      subject: `Automated WhatsApp Alerts for Candidate Shortlisting #${timestamp}`,
      description: 'Would love to see direct WhatsApp notifications when a candidate is moved to client review stage.'
    })
  });
  assert(sub1.status === 201 && sub1.data?.success === true, 'Public user can submit "Request a Feature"');
  assert(sub1.data?.id && sub1.data.id.startsWith('fb-'), `Submission receives valid ID starting with "fb-": ${sub1.data?.id}`);
  assert(
    sub1.data?.message === 'Thank you! Your request has been submitted successfully. Our team will review it.',
    'Displays exact confirmation message'
  );
  assert(sub1.data?.submission?.status === 'New', 'Initial submission status is "New"');

  const sub1Id = sub1.data?.id;

  // Test 6: Duplicate Spam Prevention
  const dupSub = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Priya Sharma',
      email: `priya.${timestamp}@techinnovate.io`,
      type: 'Request a Feature',
      subject: `Automated WhatsApp Alerts for Candidate Shortlisting #${timestamp}`,
      description: 'Would love to see direct WhatsApp notifications when a candidate is moved to client review stage.'
    })
  });
  assert(dupSub.status === 429 && dupSub.data?.code === 'DUPLICATE_SUBMISSION', 'Prevents rapid duplicate spam submissions with 429');

  // Test 7: Successful Public Submission: "Report an Issue" with Attachment
  const sub2 = await request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      name: 'David Miller',
      email: `david.${timestamp}@cloudscale.net`,
      type: 'Report an Issue',
      subject: `Formatting discrepancy in salary slider #${timestamp}`,
      description: 'On Safari 17.2, the currency dropdown overlapping with the max salary input.',
      attachmentUrl: '/uploads/attachments/screenshot-bug.png',
      attachmentName: 'screenshot-bug.png'
    })
  });
  assert(sub2.status === 201 && sub2.data?.submission?.type === 'Report an Issue', 'Public user can submit "Report an Issue"');
  assert(sub2.data?.submission?.attachmentUrl === '/uploads/attachments/screenshot-bug.png', 'Attachment URL is correctly linked');

  const sub2Id = sub2.data?.id;

  // Test 8: Security Check - Public unauthenticated access to GET /api/feedback is BLOCKED
  const unauthGet = await request('/api/feedback');
  assert(unauthGet.status === 401, 'Unauthenticated access to GET /api/feedback blocked with 401');

  // Test 9: Security Check - Client role (token-user-client-alex) access to GET /api/feedback is FORBIDDEN
  const clientGet = await request('/api/feedback', {
    headers: { Authorization: 'Bearer token-user-client-alex' }
  });
  assert(clientGet.status === 403, 'Client account access to GET /api/feedback blocked with 403 Forbidden');

  // Test 10: Security Check - Client role cannot PATCH feedback status
  const clientPatch = await request(`/api/feedback/${sub1Id}/status`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token-user-client-alex' },
    body: JSON.stringify({ status: 'Resolved' })
  });
  assert(clientPatch.status === 403, 'Client account cannot modify feedback status (403 Forbidden)');

  // Test 11: Admin Access - Admin (token-user-shravani) CAN retrieve feedback list
  const adminGet = await request('/api/feedback', {
    headers: { Authorization: 'Bearer token-user-shravani' }
  });
  assert(adminGet.status === 200 && adminGet.data?.success === true, 'Admin can access GET /api/feedback');
  assert(Array.isArray(adminGet.data?.feedback), 'Admin response contains feedback array');

  const foundSub1 = adminGet.data?.feedback?.find(f => f.id === sub1Id);
  const foundSub2 = adminGet.data?.feedback?.find(f => f.id === sub2Id);
  assert(Boolean(foundSub1), `Admin list contains submitted feature request (${sub1Id})`);
  assert(Boolean(foundSub2), `Admin list contains submitted issue report (${sub2Id})`);

  // Test 12: Admin Filters - Filter by Type
  const filterType = await request('/api/feedback?type=Request%20a%20Feature', {
    headers: { Authorization: 'Bearer token-user-shravani' }
  });
  assert(
    filterType.ok && filterType.data?.feedback?.every(f => f.type === 'Request a Feature'),
    'Admin can filter feedback by type="Request a Feature"'
  );

  // Test 13: Admin Status Update - Move from "New" to "In Review" and add admin notes
  const patch1 = await request(`/api/feedback/${sub1Id}/status`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token-user-shravani' },
    body: JSON.stringify({
      status: 'In Review',
      adminNotes: 'Reviewed by product team. Scheduled for Q4 sprint backlog.'
    })
  });
  assert(patch1.status === 200 && patch1.data?.submission?.status === 'In Review', 'Admin can update feedback status to "In Review"');
  assert(
    patch1.data?.submission?.adminNotes === 'Reviewed by product team. Scheduled for Q4 sprint backlog.',
    'Admin can add admin notes to feedback'
  );

  // Test 14: Admin Status Update - Move Issue to "Resolved"
  const patch2 = await request(`/api/feedback/${sub2Id}/status`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token-user-shravani' },
    body: JSON.stringify({
      status: 'Resolved',
      adminNotes: 'CSS z-index patch deployed in build v1.0.4. Confirmed fixed on Safari.'
    })
  });
  assert(patch2.status === 200 && patch2.data?.submission?.status === 'Resolved', 'Admin can resolve feedback issue');

  // Test 15: Invalid status validation
  const patchInvalid = await request(`/api/feedback/${sub1Id}/status`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token-user-shravani' },
    body: JSON.stringify({ status: 'InvalidStatus' })
  });
  assert(patchInvalid.status === 400, 'Rejects invalid feedback status with 400');

  // Summary
  console.log('\n======================================================');
  console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
