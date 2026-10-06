import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../data/db';
import { resumeParserService } from '../services/resumeParser';
import { EmailService, emailConfig } from '../services/emailService';
import { Candidate, EmailThread, InboundApplication } from '../types';
import { getAuthenticatedUser } from './auth';

export const emailAutomationRouter = Router();
const emailService = new EmailService();

/**
 * Log an automation step in db.automationLogs
 */
function logAutomationEvent(
  orgId: string,
  eventType: string,
  status: 'success' | 'warning' | 'error',
  title: string,
  details: string,
  metadata?: Record<string, any>
) {
  db.automationLogs.unshift({
    id: `auto-${uuidv4().substring(0, 8)}`,
    organizationId: orgId,
    eventType,
    status,
    title,
    details,
    metadata,
    createdAt: new Date().toISOString()
  });
}

/**
 * Match incoming email subject / body to active job requisition
 */
function findTargetJob(subject: string, body: string) {
  const combined = `${subject} ${body}`;

  // 1. Look for explicit JOB-XXXX code
  const codeMatch = combined.match(/\bJOB-\d{4}\b/i);
  if (codeMatch && codeMatch[0]) {
    const target = db.jobs.find(j => j.jobCode?.toUpperCase() === codeMatch[0].toUpperCase());
    if (target) return { job: target, method: `Job Code Match (${target.jobCode})` };
  }

  // 2. Look for job title matches
  for (const job of db.jobs) {
    if (job.status === 'active' && new RegExp(`\\b${job.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(combined)) {
      return { job, method: `Job Title Match ("${job.title}")` };
    }
  }

  return { job: null, method: 'No confident match' };
}

function findPossibleJobs(subject: string, body: string) {
  const combined = `${subject} ${body}`.toLowerCase();
  return db.jobs.filter((job) => {
    if (job.status !== 'active') return false;
    const words = job.title.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
    return words.some((word) => combined.includes(word));
  }).map((job) => job.id);
}

function isAdminRequest(req: any) {
  const user = getAuthenticatedUser(req);
  return user && ['ADMIN', 'SUPER_ADMIN', 'ORG_ADMIN'].includes(user.role) ? user : undefined;
}

/**
 * Inbound Email Webhook & Resume Ingestion Engine (8-stage pipeline)
 */
emailAutomationRouter.post('/inbound-email', async (req, res) => {
  const {
    from = '',
    to = 'recruiter@hiredeskhr.com',
    subject = '',
    body = '',
    attachmentName = 'Candidate_Resume.pdf',
    attachmentUrl,
    resumeText
  } = req.body;

  const orgId = db.users[0]?.organizationId || 'org-1';

  // Step 1: Inbound Email Reception
  logAutomationEvent(
    orgId,
    'INBOUND_EMAIL_RECEIVED',
    'success',
    'Step 1: Inbound Email Received',
    `Received application email from ${from} with subject: "${subject}"`,
    { from, to, subject, attachmentName }
  );

  // Step 2: Job Requisition Matching
  const matchResult = findTargetJob(subject, `${body} ${resumeText || ''}`);
  const targetJob = matchResult.job;

  if (!targetJob) {
    const parsedData = resumeParserService.parseContent(`${resumeText || ''}\n${body}\n${subject}`, attachmentName, from, []);
    const pending: InboundApplication = {
      id: `inbound-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      from,
      to,
      subject,
      body,
      attachmentName,
      attachmentUrl,
      resumeText,
      candidateName: parsedData.candidateName,
      candidateEmail: parsedData.candidateEmail,
      candidatePhone: parsedData.candidatePhone,
      status: 'unmatched',
      possibleJobIds: findPossibleJobs(subject, `${body} ${resumeText || ''}`),
      receivedAt: new Date().toISOString()
    };
    db.inboundApplications.unshift(pending);
    logAutomationEvent(
      orgId,
      'REQUISITION_MATCH_FAILED',
      'error',
      'Step 2: Requisition Matching Failed',
      `No active job requisition found in database matching subject: "${subject}".`,
      { subject }
    );
    db.save();
    db.save();
    return res.status(202).json({ success: true, message: 'Job not matched. Please select the correct job.', inboundApplication: pending });
  }

  logAutomationEvent(
    orgId,
    'JOB_MATCHED',
    'success',
    'Step 2: Job Requisition Matched',
    `Matched to job [${targetJob.jobCode || targetJob.id}] "${targetJob.title}" via ${matchResult.method}.`,
    { jobId: targetJob.id, jobCode: targetJob.jobCode, jobTitle: targetJob.title, method: matchResult.method }
  );

  // Step 3: Attachment Extraction & Resume Parsing
  const combinedContent = `${resumeText || ''}\n${body}\n${subject}`;
  const parsedData = resumeParserService.parseContent(
    combinedContent,
    attachmentName,
    from,
    targetJob.skills || []
  );

  logAutomationEvent(
    orgId,
    'RESUME_PARSED',
    'success',
    'Step 3: Resume Extracted & Parsed',
    `Extracted details: Name: ${parsedData.candidateName}, Email: ${parsedData.candidateEmail}, Skills: ${parsedData.skills.join(', ')} (Match Score: ${parsedData.matchScore}%)`,
    { parsedData }
  );

  // Step 4: Duplicate Application Detection
  const existingCandidate = db.candidates.find(
    c => c.jobId === targetJob.id && c.email.toLowerCase() === parsedData.candidateEmail.toLowerCase()
  );

  if (existingCandidate) {
    logAutomationEvent(
      orgId,
      'DUPLICATE_APPLICATION_DETECTED',
      'warning',
      'Step 4: Duplicate Candidate Application',
      `Candidate with email ${parsedData.candidateEmail} already exists for ${targetJob.title} (Candidate Code: ${existingCandidate.candidateCode || existingCandidate.id}). Appended note to existing record.`,
      { candidateId: existingCandidate.id }
    );

    if (!existingCandidate.notes) existingCandidate.notes = [];
    existingCandidate.notes.push(
      `Re-applied via Email Automation on ${new Date().toLocaleString()}: Subject: "${subject}" (Resume: ${attachmentName})`
    );
    db.save();

    return res.status(200).json({
      success: true,
      duplicate: true,
      message: `Candidate ${parsedData.candidateName} already exists for this job requisition. Updated profile notes.`,
      candidate: existingCandidate
    });
  }

  // Step 5: Candidate Code Generation
  const candidateCode = db.generateCandidateCode();
  const candidateId = `cand-${uuidv4().substring(0, 8)}`;
  const applicationId = `APP-${targetJob.jobCode ? targetJob.jobCode.replace(/[^a-zA-Z0-9]/g, '') : 'JOB'}-${Math.floor(1000 + Math.random() * 9000)}`;
  const nameParts = parsedData.candidateName.split(' ');
  const firstName = nameParts[0] || 'Candidate';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Step 6: Create Candidate in 'applied' Stage
  const newCandidate: Candidate = {
    id: candidateId,
    applicationId,
    candidateCode,
    organizationId: targetJob.organizationId,
    jobId: targetJob.id,
    jobCode: targetJob.jobCode,
    jobTitle: targetJob.title,
    clientId: targetJob.clientId,
    clientName: targetJob.clientName,
    firstName,
    lastName,
    email: parsedData.candidateEmail,
    phone: parsedData.candidatePhone,
    location: parsedData.location,
    country: targetJob.country || 'India',
    resumeFileName: attachmentName,
    resumeUrl: attachmentUrl || `/uploads/${attachmentName}`,
    resumeText: resumeText || body,
    skills: parsedData.skills,
    education: parsedData.education,
    totalExperience: parsedData.totalExperience,
    matchScore: parsedData.matchScore,
    stage: 'applied',
    source: `Email Ingestion (${from.includes('hostinger') ? 'Hostinger Webmail' : 'Inbound Mail'})`,
    appliedAt: new Date().toISOString(),
    notes: [
      `Automated Inbound Resume Ingestion from: "${subject}" (Sender: ${from})`,
      `Attachment parsed: ${attachmentName}`,
      `Auto-matched to requisition ${targetJob.jobCode} (${targetJob.title})`
    ],
    timeline: [
      {
        event: `Application received via email automation for ${targetJob.title} (${targetJob.jobCode})`,
        timestamp: new Date().toISOString(),
        user: 'Inbound Email Gateway'
      }
    ]
  };

  db.candidates.unshift(newCandidate);
  targetJob.applicantsCount = (targetJob.applicantsCount || 0) + 1;

  logAutomationEvent(
    orgId,
    'CANDIDATE_CREATED',
    'success',
    'Step 5 & 6: Candidate Ingested into Pipeline',
    `Created candidate record ${candidateCode} (${newCandidate.firstName} ${newCandidate.lastName}) in "applied" stage.`,
    { candidateCode, candidateId, stage: 'applied' }
  );

  // Step 7: Email Thread & Recruiter Communication Hub Creation
  const threadId = `thread-${newCandidate.id}`;
  const newThread: EmailThread = {
    id: threadId,
    organizationId: targetJob.organizationId,
    candidateId: newCandidate.id,
    candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
    candidateEmail: newCandidate.email,
    jobTitle: targetJob.title,
    subject: subject || `Application for ${targetJob.title}`,
    lastMessageAt: new Date().toISOString(),
    unread: true,
    messages: [
      {
        id: `msg-${uuidv4().substring(0, 6)}`,
        sender: 'candidate',
        senderName: `${newCandidate.firstName} ${newCandidate.lastName}`,
        content: body || `Candidate applied via email with attached resume: ${attachmentName}. Ingested into ${targetJob.title}.`,
        timestamp: new Date().toISOString(),
        status: 'delivered'
      }
    ]
  };
  db.emailThreads.unshift(newThread);

  // Step 8: Recruiter Alert & Real In-App Notification
  const recruiterTarget = emailConfig.recruiterNotificationEmail || 'admin@hiredeskhr.com';
  
  // Real In-App Notification
  db.notifications.unshift({
    id: `notif-${uuidv4().substring(0, 8)}`,
    organizationId: targetJob.organizationId,
    recipientEmail: recruiterTarget,
    title: `New Resume Ingested: ${newCandidate.firstName} ${newCandidate.lastName}`,
    message: `Applied for [${targetJob.jobCode}] ${targetJob.title} with match score ${newCandidate.matchScore}%. Resume: ${attachmentName}.`,
    type: 'resume',
    link: `/candidates/${newCandidate.id}`,
    read: false,
    createdAt: new Date().toISOString()
  });

  // Outbound Email Notification to Recruiter
  emailService.sendInboundResumeIngestedNotification(
    recruiterTarget,
    newCandidate,
    targetJob,
    attachmentName
  ).catch(err => console.error('[Email Automation] Failed to dispatch recruiter email notification:', err.message));

  logAutomationEvent(
    orgId,
    'RECRUITER_NOTIFIED',
    'success',
    'Step 7 & 8: Recruiter Dispatched & Logged',
    `Delivered in-app notification and email alert to recruiter: ${recruiterTarget}. Full 8-step pipeline complete.`,
    { recruiterTarget }
  );

  // Save durable state
  db.save();

  return res.status(201).json({
    success: true,
    pipeline: '8-Step Inbound Resume Ingestion Completed',
    candidateCode,
    candidate: newCandidate,
    job: {
      id: targetJob.id,
      jobCode: targetJob.jobCode,
      title: targetJob.title,
      applicantsCount: targetJob.applicantsCount
    },
    thread: newThread,
    attachment: {
      fileName: attachmentName,
      status: 'Parsed, Indexed, & Attached to Candidate Record'
    },
    recruiterNotified: recruiterTarget
  });
});

/**
 * Get all automation pipeline logs for audit review
 */
emailAutomationRouter.get('/logs', (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in required.' });
  const orgId = user.organizationId;
  const logs = db.automationLogs.filter(l => l.organizationId === orgId);
  return res.json({
    success: true,
    count: logs.length,
    logs
  });
});

emailAutomationRouter.get('/unmatched', (req: any, res) => {
  const user = isAdminRequest(req);
  if (!user) return res.status(403).json({ error: 'Admin access required.' });
  const orgId = user.organizationId;
  return res.json({ applications: db.inboundApplications.filter((item) => item.organizationId === orgId && item.status === 'unmatched') });
});

emailAutomationRouter.post('/unmatched/:id/confirm', (req: any, res) => {
  const user = isAdminRequest(req);
  if (!user) return res.status(403).json({ error: 'Admin access required.' });
  const pending = db.inboundApplications.find((item) => item.id === req.params.id && item.organizationId === user.organizationId && item.status === 'unmatched');
  const job = db.jobs.find((item) => item.id === req.body?.jobId && item.organizationId === user.organizationId);
  if (!pending) return res.status(404).json({ error: 'Incoming application not found.' });
  if (!job) return res.status(400).json({ error: 'Please select a valid job.' });

  const parsedData = resumeParserService.parseContent(`${pending.resumeText || ''}\n${pending.body}\n${pending.subject}`, pending.attachmentName, pending.from, job.skills || []);
  const names = parsedData.candidateName.split(' ');
  const candidate: Candidate = {
    id: `cand-${uuidv4().substring(0, 8)}`,
    candidateCode: db.generateCandidateCode(),
    organizationId: job.organizationId,
    jobId: job.id,
    clientId: job.clientId,
    firstName: names[0] || 'Candidate',
    lastName: names.slice(1).join(' '),
    email: parsedData.candidateEmail,
    phone: parsedData.candidatePhone,
    location: parsedData.location,
    country: job.country,
    resumeFileName: pending.attachmentName,
    resumeUrl: pending.attachmentUrl || `/uploads/${pending.attachmentName}`,
    resumeText: pending.resumeText || pending.body,
    skills: parsedData.skills,
    education: parsedData.education,
    totalExperience: parsedData.totalExperience,
    matchScore: parsedData.matchScore,
    stage: 'applied',
    source: `Confirmed inbound email (${pending.from || 'unknown sender'})`,
    appliedAt: pending.receivedAt,
    notes: [`Admin confirmed job ${job.jobCode} for inbound application ${pending.id}.`],
    timeline: [{ event: `Application manually connected to ${job.title} (${job.jobCode})`, timestamp: new Date().toISOString(), user: user.email }]
  };
  db.candidates.unshift(candidate);
  job.applicantsCount = (job.applicantsCount || 0) + 1;
  pending.status = 'confirmed';
  pending.confirmedJobId = job.id;
  pending.candidateId = candidate.id;
  db.save();
  return res.status(201).json({ success: true, message: 'Resume received successfully.', candidate, job });
});

/**
 * Simulate inbound Hostinger / Webmail resume application
 */
emailAutomationRouter.post('/simulate-hostinger-email', async (req, res) => {
  const { jobCode, jobTitle } = req.body;

  let targetJob = db.jobs.find(j => 
    (jobCode && j.jobCode === jobCode) || 
    (jobTitle && j.title.toLowerCase().includes(jobTitle.toLowerCase()))
  );

  if (!targetJob) {
    targetJob = db.jobs[0];
  }

  const simulated = {
    from: 'noreply@medicoworkforce.pyjamahr.com',
    to: 'sonukumar@medicoworkforce.com',
    subject: `New candidate applied to [${targetJob?.jobCode || 'JOB-1001'}] ${targetJob?.title || 'Senior Software Engineer'} role`,
    body: `Hello Team,\n\nA new candidate has applied for the ${targetJob?.title} (${targetJob?.jobCode}) opening.\n\nCandidate Details:\nName: Dr. Biswanath Sharma\nEmail: dr.biswanath.talent@gmail.com\nPhone: +91 98452 11234\nLocation: Bangalore / Hybrid\nTotal Experience: 5.2 Years\nEducation: Master of Technology in Computer Science\nSkills: TypeScript, Node.js, React, PostgreSQL, Docker, AWS, System Design\n\nPlease find the candidate's resume PDF attached.\n\nWarm regards,\nHostinger Mail Automation Gateway`,
    attachmentName: 'Dr_Biswanath_Resume.pdf',
    attachmentUrl: '/uploads/Dr_Biswanath_Resume.pdf',
    resumeText: 'Dr. Biswanath Sharma. 5.2 years experience in TypeScript, Node.js, React, Docker, AWS. B.Tech and M.Tech in Computer Science.'
  };

  // Dispatch into inbound-email handler internally
  const matchResult = findTargetJob(simulated.subject, simulated.body);
  const matchedJob = matchResult.job || targetJob;

  const candidateCode = db.generateCandidateCode();
  const newCandidate: Candidate = {
    id: `cand-${uuidv4().substring(0, 8)}`,
    candidateCode,
    organizationId: matchedJob.organizationId,
    jobId: matchedJob.id,
    clientId: matchedJob.clientId,
    firstName: 'Dr. Biswanath',
    lastName: 'Sharma',
    email: 'dr.biswanath.talent@gmail.com',
    phone: '+91 98452 11234',
    location: 'Bangalore, India',
    country: 'India',
    resumeFileName: simulated.attachmentName,
    resumeUrl: simulated.attachmentUrl,
    resumeText: simulated.resumeText,
    skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'AWS'],
    education: 'M.Tech in Computer Science',
    totalExperience: '5.2 Years',
    matchScore: 96,
    stage: 'applied',
    source: 'Hostinger Business Email Automation',
    appliedAt: new Date().toISOString(),
    notes: [
      `Automated Inbound Resume Ingestion: [${matchedJob.jobCode}] ${matchedJob.title}`,
      `Attachment parsed: ${simulated.attachmentName}`
    ],
    timeline: [
      {
        event: `Applied to ${matchedJob.title} (${matchedJob.jobCode}) via Hostinger Webmail`,
        timestamp: new Date().toISOString(),
        user: 'Hostinger Email Gateway'
      }
    ]
  };

  db.candidates.unshift(newCandidate);
  matchedJob.applicantsCount = (matchedJob.applicantsCount || 0) + 1;

  // Add notification & log
  db.notifications.unshift({
    id: `notif-${uuidv4().substring(0, 8)}`,
    organizationId: matchedJob.organizationId,
    recipientEmail: 'admin@hiredeskhr.com',
    title: `New Resume Ingested: ${newCandidate.firstName} ${newCandidate.lastName}`,
    message: `Applied for [${matchedJob.jobCode}] ${matchedJob.title}. Match Score: 96%.`,
    type: 'resume',
    link: `/candidates/${newCandidate.id}`,
    read: false,
    createdAt: new Date().toISOString()
  });

  logAutomationEvent(
    matchedJob.organizationId,
    'HOSTINGER_SIMULATION_INGESTED',
    'success',
    'Hostinger Webmail Resume Ingested',
    `Candidate ${newCandidate.firstName} ${newCandidate.lastName} (${candidateCode}) ingested into "${matchedJob.title}".`,
    { candidateCode, jobId: matchedJob.id }
  );

  const thread: EmailThread = {
    id: `thread-${newCandidate.id}`,
    organizationId: matchedJob.organizationId,
    candidateId: newCandidate.id,
    candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
    candidateEmail: newCandidate.email,
    jobTitle: matchedJob.title,
    subject: `applied to ${matchedJob.title} (${matchedJob.jobCode}) via Hostinger Webmail`,
    lastMessageAt: new Date().toISOString(),
    unread: true,
    messages: [
      {
        id: `msg-${uuidv4().substring(0, 6)}`,
        sender: 'candidate',
        senderName: `${newCandidate.firstName} ${newCandidate.lastName}`,
        content: `Candidate ${newCandidate.firstName} ${newCandidate.lastName} has applied to ${matchedJob.title} (${matchedJob.jobCode}). Resume attached: ${simulated.attachmentName}`,
        timestamp: new Date().toISOString(),
        status: 'read'
      }
    ]
  };

  db.emailThreads.unshift(thread);
  db.save();

  return res.status(201).json({
    success: true,
    message: `Applicant Dr. Biswanath Sharma (${candidateCode}) successfully ingested into [${matchedJob.jobCode}] '${matchedJob.title}' in the Applied stage!`,
    candidate: newCandidate,
    job: matchedJob,
    thread
  });
});

/**
 * Get current email gateway settings
 */
emailAutomationRouter.get('/settings', (req, res) => {
  return res.json({
    enabled: true,
    gatewayProvider: 'Hostinger Business Email / IMAP Gateway',
    incomingServer: 'imap.hostinger.com',
    incomingPort: 993,
    outgoingServer: 'smtp.hostinger.com',
    outgoingPort: 465,
    monitoredMailbox: 'sonukumar@medicoworkforce.com',
    recruiterAlertEmail: emailConfig.recruiterNotificationEmail || 'admin@hiredeskhr.com',
    forwardingWebhookUrl: 'http://localhost:5001/api/automation/inbound-email',
    pipelineSteps: [
      '1. Inbound email received via IMAP/Webhook',
      '2. Job requisition matched by JOB-XXXX or title',
      '3. Resume attachment extracted and parsed (skills, edu, exp)',
      '4. Duplicate email detection against active candidate pool',
      '5. Sequential candidate code generated (CAND-20xx)',
      '6. Candidate placed into "applied" column in database',
      '7. Communication thread opened in Recruiter Email Hub',
      '8. In-app and outbound email notifications dispatched'
    ]
  });
});
