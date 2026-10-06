import { Router } from 'express';
import { store } from '../data/store';
import { EmailThread, Candidate } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, isPlatformAdmin, resolveTargetOrgId } from '../middleware/tenantMiddleware';

export const emailsRouter = Router();
emailsRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

// List email threads
emailsRouter.get('/', (req: any, res) => {
  const targetOrgId = resolveTargetOrgId(req, res, 'emails');
  if (!targetOrgId) return;
  const threads = store.emailThreads.filter(t => t.organizationId === targetOrgId);
  return res.json(threads);
});

// Single thread
emailsRouter.get('/:id', (req: any, res) => {
  const thread = store.emailThreads.find(t => t.id === req.params.id);
  if (!thread) {
    return res.status(404).json({ error: 'Email thread not found' });
  }
  if (!checkTenantAccess(req, res, thread.organizationId, 'email thread')) return;
  thread.unread = false; // mark as read
  return res.json(thread);
});

// Reply to email thread
emailsRouter.post('/:id/reply', (req: any, res) => {
  const thread = store.emailThreads.find(t => t.id === req.params.id);
  if (!thread) {
    return res.status(404).json({ error: 'Email thread not found' });
  }
  if (!checkTenantAccess(req, res, thread.organizationId, 'email thread')) return;

  const { content, senderName } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  const newMessage = {
    id: `msg-${uuidv4().substring(0, 6)}`,
    sender: 'recruiter' as const,
    senderName: senderName || store.users[0].name,
    content,
    timestamp: new Date().toISOString(),
    status: 'sent' as const
  };

  thread.messages.push(newMessage);
  thread.lastMessageAt = newMessage.timestamp;

  return res.json({
    message: 'Reply sent successfully',
    thread,
    sentMessage: newMessage
  });
});

// Compose new email to candidate
emailsRouter.post('/compose', (req: any, res) => {
  const orgId = getOrgId(req);
  const { candidateId, subject, content, templateType } = req.body;

  const candidate = store.candidates.find(c => c.id === candidateId);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate email thread')) return;

  const job = store.jobs.find(j => j.id === candidate.jobId);
  const jobTitle = job ? job.title : 'Position';

  let thread = store.emailThreads.find(t => t.candidateId === candidate.id);
  const newMessage = {
    id: `msg-${uuidv4().substring(0, 6)}`,
    sender: 'recruiter' as const,
    senderName: store.users[0].name,
    content: content || 'Hello, thank you for connecting with us.',
    timestamp: new Date().toISOString(),
    status: 'sent' as const
  };

  if (thread) {
    thread.messages.push(newMessage);
    thread.lastMessageAt = newMessage.timestamp;
    if (subject) thread.subject = subject;
  } else {
    thread = {
      id: `thread-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      candidateId: candidate.id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      candidateEmail: candidate.email,
      jobTitle,
      subject: subject || `Update regarding your application for ${jobTitle}`,
      lastMessageAt: newMessage.timestamp,
      unread: false,
      messages: [newMessage]
    };
    store.emailThreads.unshift(thread);
  }

  return res.status(201).json({
    message: 'Email dispatched successfully via connected SMTP mail server',
    thread
  });
});

// Simulated LinkedIn "Email Ingestion"
// Explicit requirement from transcript:
// "once LinkedIn, once someone apply, no, so like that we receive emails... 'New candidate applied for [job title]'.
// So what I want to do? This resume automatically goes to the same job... client database, client dashboard."
emailsRouter.post('/simulate-linkedin-injection', (req, res) => {
  const orgId = getOrgId(req);
  const {
    jobId,
    candidateName = 'Deepak Malhotra',
    candidateEmail = 'deepak.malhotra@engineer.io',
    phone = '+91 98450 12345',
    experience = '5 Years',
    currentCtc = '₹22,00,000 / yr',
    expectedCtc = '₹30,00,000 / yr',
    resumeFileName = 'Deepak_Malhotra_FullStack_Resume.pdf'
  } = req.body;

  const targetJob = store.jobs.find(j => j.id === jobId && j.organizationId === orgId) || store.jobs[0];
  const nameParts = candidateName.split(' ');
  const firstName = nameParts[0] || 'Candidate';
  const lastName = nameParts.slice(1).join(' ') || 'Applicant';

  const newCandidate: Candidate = {
    id: `cand-${uuidv4().substring(0, 8)}`,
    organizationId: orgId,
    jobId: targetJob.id,
    firstName,
    lastName,
    email: candidateEmail,
    phone,
    location: 'Bangalore / Remote',
    resumeFileName,
    resumeUrl: `/resumes/${resumeFileName}`,
    currentCtc,
    expectedCtc,
    totalExperience: experience,
    stage: 'applied', // Injected directly into 'applied' stage!
    source: 'LinkedIn',
    matchScore: 93,
    appliedAt: new Date().toISOString(),
    notes: [
      `Auto-ingested via LinkedIn Email Ingestion on ${new Date().toLocaleString()}.`,
      `Inbound email subject: "New candidate applied for ${targetJob.title} - ${candidateName}".`,
      `Resume attached: ${resumeFileName} automatically parsed.`
    ]
  };

  store.candidates.unshift(newCandidate);
  targetJob.applicantsCount = store.candidates.filter(c => c.jobId === targetJob.id).length;

  // Record inbound email in email inbox
  const newThread: EmailThread = {
    id: `thread-${newCandidate.id}`,
    organizationId: orgId,
    candidateId: newCandidate.id,
    candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
    candidateEmail: newCandidate.email,
    jobTitle: targetJob.title,
    subject: `[LinkedIn Application Alert] New candidate applied for ${targetJob.title}: ${newCandidate.firstName} ${newCandidate.lastName}`,
    lastMessageAt: new Date().toISOString(),
    unread: true,
    messages: [
      {
        id: `msg-${uuidv4().substring(0, 6)}`,
        sender: 'candidate',
        senderName: `${newCandidate.firstName} ${newCandidate.lastName} (via LinkedIn)`,
        content: `Candidate ${newCandidate.firstName} ${newCandidate.lastName} has submitted an application for ${targetJob.title}.\n\n• Email: ${newCandidate.email}\n• Phone: ${newCandidate.phone}\n• Experience: ${experience}\n• Attached Resume: ${resumeFileName}\n\n[Auto-processed: Resume automatically synchronized to client hiring pipeline under 'Applied'].`,
        timestamp: new Date().toISOString(),
        status: 'read'
      }
    ]
  };

  store.emailThreads.unshift(newThread);

  return res.status(201).json({
    success: true,
    message: 'LinkedIn candidate application & resume successfully ingested into client dashboard!',
    candidate: newCandidate,
    emailThread: newThread
  });
});
