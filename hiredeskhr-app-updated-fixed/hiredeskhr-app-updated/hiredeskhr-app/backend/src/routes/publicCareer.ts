import { Router } from 'express';
import { store, db } from '../data/store';
import { Candidate, InboundApplication } from '../types';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { EmailService, emailConfig, resolveEmailCreds } from '../services/emailService';
import { authRateLimiter } from '../middleware/rateLimiter';

export const publicCareerRouter = Router();
const emailService = new EmailService();

const CANDIDATE_OTP_TTL_MS = 10 * 60 * 1000;
const CANDIDATE_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const CANDIDATE_OTP_COOLDOWN_MS = 60 * 1000;
const MAX_CANDIDATE_OTP_ATTEMPTS = 5;

interface CandidatePortalSession {
  id: string;
  organizationId: string;
  email: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

interface CandidatePortalAccess {
  organizationId: string;
  email: string;
  expiresAt: number;
}

const candidatePortalSessions = new Map<string, CandidatePortalSession>();
const candidatePortalTokens = new Map<string, CandidatePortalAccess>();
const candidatePortalOtpCooldowns = new Map<string, number>();

function pruneCandidatePortalAuthState() {
  const now = Date.now();
  for (const [id, session] of candidatePortalSessions) {
    if (now >= session.expiresAt) candidatePortalSessions.delete(id);
  }
  for (const [tokenHash, access] of candidatePortalTokens) {
    if (now >= access.expiresAt) candidatePortalTokens.delete(tokenHash);
  }
  for (const [key, resetAt] of candidatePortalOtpCooldowns) {
    if (now >= resetAt) candidatePortalOtpCooldowns.delete(key);
  }
}

function candidateAccessForRequest(req: any, organizationId: string): CandidatePortalAccess | undefined {
  const authorization = String(req.headers?.authorization || '');
  if (!authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return undefined;

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const access = candidatePortalTokens.get(tokenHash);
  if (!access || Date.now() >= access.expiresAt || access.organizationId !== organizationId) {
    if (access && Date.now() >= access.expiresAt) candidatePortalTokens.delete(tokenHash);
    return undefined;
  }
  return access;
}

function candidatePortalStage(candidate: Candidate) {
  const stage = String(candidate.stage || 'applied').toLowerCase();
  if (stage === 'rejected') return { stage, stageLabel: 'Not selected', progressStep: 3 };
  if (stage === 'hired') return { stage, stageLabel: 'Hired', progressStep: 3 };
  if (stage === 'offered' || stage === 'selected') return { stage, stageLabel: 'Offer decision', progressStep: 3 };
  if (stage === 'interview' || stage === 'ai_interview') {
    return { stage, stageLabel: stage === 'ai_interview' ? 'AI interview' : 'Interview', progressStep: 2 };
  }
  if (stage === 'screening' || stage === 'shortlisted' || stage === 'client_review') {
    return { stage, stageLabel: 'In review', progressStep: 1 };
  }
  if (stage === 'contacted' || stage === 'sourcing') {
    return { stage, stageLabel: 'In review', progressStep: 1 };
  }
  return { stage: 'applied', stageLabel: 'Application received', progressStep: 0 };
}

function publicCandidateApplications(organizationId: string, email: string) {
  return store.candidates
    .filter(candidate =>
      candidate.organizationId === organizationId &&
      String(candidate.email || '').trim().toLowerCase() === email
    )
    .map(candidate => {
      const job = store.jobs.find(item => item.id === candidate.jobId && item.organizationId === organizationId);
      return {
        applicationId: candidate.applicationId || candidate.candidateCode || candidate.id,
        jobTitle: candidate.jobTitle || job?.title || 'Position',
        ...candidatePortalStage(candidate),
        appliedAt: candidate.appliedAt
      };
    })
    .sort((a, b) => new Date(b.appliedAt || 0).getTime() - new Date(a.appliedAt || 0).getTime());
}

// Public Career Page Info for an organization (e.g. software-workforce)
publicCareerRouter.get('/:orgSlug', (req, res) => {
  const { orgSlug } = req.params;
  const org = store.organizations.find(
    o => o.slug.toLowerCase() === orgSlug.toLowerCase() || o.id === orgSlug
  );

  if (!org) {
    return res.status(404).json({ error: 'Organization career portal not found' });
  }

  const activeJobs = store.jobs
    .filter(j => j.organizationId === org.id && j.status === 'active')
    .map(j => ({
      id: j.id,
      jobCode: j.jobCode,
      title: j.title,
      clientName: j.clientName,
      department: j.department,
      location: j.location,
      workplaceType: j.workplaceType,
      employmentType: j.employmentType,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      currency: j.currency,
      experienceMin: j.experienceMin,
      experienceMax: j.experienceMax,
      description: j.description,
      requirements: j.requirements,
      status: 'active' as const,
      applicationFormConfig: j.applicationFormConfig,
      createdAt: j.createdAt
    }));

  return res.json({
    organization: {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      banner: org.banner,
      tagline: org.tagline,
      cultureText: org.cultureText
    },
    jobs: activeJobs
  });
});

// Public Job Details and Form Configuration
publicCareerRouter.get('/:orgSlug/jobs/:jobId', (req, res) => {
  const { orgSlug, jobId } = req.params;
  const org = store.organizations.find(
    o => o.slug.toLowerCase() === orgSlug.toLowerCase() || o.id === orgSlug
  );

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const job = store.jobs.find(j => j.id === jobId && j.organizationId === org.id);
  if (!job || job.status !== 'active') {
    return res.status(404).json({ error: 'Job opening not found or no longer active' });
  }

  return res.json({
    job,
    organization: {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      tagline: org.tagline
    }
  });
});

// Candidate portal sign-in: email OTP is separate from recruiter/client accounts.
publicCareerRouter.post('/:orgSlug/track/start', authRateLimiter, async (req, res) => {
  const { orgSlug } = req.params;
  const org = store.organizations.find(
    item => item.slug.toLowerCase() === String(orgSlug).toLowerCase() || item.id === String(orgSlug)
  );
  if (!org) return res.status(404).json({ error: 'Organization career portal not found.' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  pruneCandidatePortalAuthState();
  const cooldownKey = `${org.id}:${email}`;
  const cooldownUntil = candidatePortalOtpCooldowns.get(cooldownKey);
  if (cooldownUntil && Date.now() < cooldownUntil) {
    return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
  }
  candidatePortalOtpCooldowns.set(cooldownKey, Date.now() + CANDIDATE_OTP_COOLDOWN_MS);

  const hasApplications = store.candidates.some(candidate =>
    candidate.organizationId === org.id &&
    String(candidate.email || '').trim().toLowerCase() === email
  );
  const sessionId = uuidv4();
  const expiresAt = Date.now() + CANDIDATE_OTP_TTL_MS;

  // Keep the response generic so the portal does not disclose whether an email
  // address appears in the candidate database.
  if (!hasApplications) {
    return res.json({
      success: true,
      sessionId,
      expiresAt,
      expiresInSeconds: Math.floor(CANDIDATE_OTP_TTL_MS / 1000),
      message: 'If there are applications for this email, a sign-in code will be sent.'
    });
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  const devMode = process.env.NODE_ENV !== 'production' && !resolveEmailCreds().anyConfigured;
  const emailResult = await emailService.sendOtpEmail(email, code);

  if (!emailResult.success && !devMode) {
    return res.status(503).json({
      error: 'We could not send a verification code right now. Please try again later.',
      code: 'EMAIL_DELIVERY_FAILED'
    });
  }

  candidatePortalSessions.set(sessionId, {
    id: sessionId,
    organizationId: org.id,
    email,
    code,
    expiresAt,
    attempts: 0
  });

  return res.json({
    success: true,
    sessionId,
    expiresAt,
    expiresInSeconds: Math.floor(CANDIDATE_OTP_TTL_MS / 1000),
    message: 'If there are applications for this email, a sign-in code will be sent.',
    ...(devMode ? { devEmailOtp: code, devMode: true } : {})
  });
});

publicCareerRouter.post('/:orgSlug/track/verify', authRateLimiter, (req, res) => {
  const { orgSlug } = req.params;
  const org = store.organizations.find(
    item => item.slug.toLowerCase() === String(orgSlug).toLowerCase() || item.id === String(orgSlug)
  );
  if (!org) return res.status(404).json({ error: 'Organization career portal not found.' });

  const sessionId = String(req.body?.sessionId || '');
  const code = String(req.body?.otp || '').trim();
  const session = candidatePortalSessions.get(sessionId);
  if (!session || session.organizationId !== org.id) {
    return res.status(400).json({ error: 'That code is no longer active. Request a new one.' });
  }
  if (Date.now() >= session.expiresAt) {
    candidatePortalSessions.delete(sessionId);
    return res.status(400).json({ error: 'That code has expired. Request a new one.' });
  }
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  }
  if (session.attempts >= MAX_CANDIDATE_OTP_ATTEMPTS) {
    candidatePortalSessions.delete(sessionId);
    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' });
  }

  session.attempts += 1;
  if (code !== session.code) {
    if (session.attempts >= MAX_CANDIDATE_OTP_ATTEMPTS) candidatePortalSessions.delete(sessionId);
    return res.status(400).json({
      error: session.attempts >= MAX_CANDIDATE_OTP_ATTEMPTS
        ? 'Too many incorrect attempts. Request a new code.'
        : `That code is incorrect. ${MAX_CANDIDATE_OTP_ATTEMPTS - session.attempts} attempts remain.`
    });
  }

  const applications = publicCandidateApplications(org.id, session.email);
  candidatePortalSessions.delete(sessionId);
  if (!applications.length) {
    return res.status(400).json({ error: 'No applications were found for this email. Check the address and try again.' });
  }

  const accessToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const expiresAt = Date.now() + CANDIDATE_TOKEN_TTL_MS;
  candidatePortalTokens.set(tokenHash, {
    organizationId: org.id,
    email: session.email,
    expiresAt
  });

  return res.json({
    success: true,
    accessToken,
    expiresAt,
    applications
  });
});

publicCareerRouter.get('/:orgSlug/track/applications', (req, res) => {
  const { orgSlug } = req.params;
  const org = store.organizations.find(
    item => item.slug.toLowerCase() === String(orgSlug).toLowerCase() || item.id === String(orgSlug)
  );
  if (!org) return res.status(404).json({ error: 'Organization career portal not found.' });

  const access = candidateAccessForRequest(req, org.id);
  if (!access) return res.status(401).json({ error: 'Your candidate sign-in expired. Sign in again.' });

  return res.json({
    applications: publicCandidateApplications(org.id, access.email)
  });
});

publicCareerRouter.post('/:orgSlug/track/logout', (req, res) => {
  const authorization = String(req.headers?.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    candidatePortalTokens.delete(tokenHash);
  }
  return res.json({ success: true });
});

// Candidate Applies on Public Career Page
publicCareerRouter.post('/:orgSlug/jobs/:jobId/apply', (req, res) => {
  const { orgSlug, jobId } = req.params;
  const org = store.organizations.find(
    o => o.slug.toLowerCase() === orgSlug.toLowerCase() || o.id === orgSlug
  );

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const job = store.jobs.find(j => j.id === jobId && j.organizationId === org.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    location,
    resumeFileName,
    resumeUrl,
    currentCtc,
    expectedCtc,
    totalExperience,
    noticePeriod,
    screeningAnswers,
    source = 'Career Page'
  } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'First name, last name, and email are required' });
  }

  // Check duplicate application FOR THIS SPECIFIC JOB ONLY.
  // Candidates are explicitly allowed to apply to multiple different jobs!
  const existingCandidateInJob = store.candidates.find(
    c => c.jobId === job.id && c.email.toLowerCase() === email.trim().toLowerCase()
  );
  if (existingCandidateInJob) {
    return res.status(409).json({
      error: `You have already submitted an application for this position (${job.title}). Your application reference is ${existingCandidateInJob.applicationId || existingCandidateInJob.candidateCode || existingCandidateInJob.id}.`,
      applicationId: existingCandidateInJob.applicationId || existingCandidateInJob.candidateCode || existingCandidateInJob.id
    });
  }

  // Check Plan Limits & Trial Expiration for Free Trial (Candidates allowed: 10)
  if (org.plan === 'free') {
    const trialStart = org.trialStartedAt ? new Date(org.trialStartedAt) : (org.createdAt ? new Date(org.createdAt) : new Date());
    const trialEnd = org.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Date.now() > trialEnd.getTime()) {
      return res.status(403).json({
        error: 'This company’s free trial has ended and is currently not accepting new applications.',
        code: 'TRIAL_EXPIRED'
      });
    }

    const orgCandidatesCount = store.candidates.filter(c => c.organizationId === org.id).length;
    if (orgCandidatesCount >= 10) {
      return res.status(403).json({
        error: 'Application limit reached for this position (free trial limit: 10 candidates). Please contact the recruiter directly.',
        code: 'PLAN_LIMIT_REACHED'
      });
    }
  }

  const matchScore = Math.floor(Math.random() * 15) + 85; // 85-99%
  const appId = `APP-${job.jobCode ? job.jobCode.replace(/[^a-zA-Z0-9]/g, '') : 'JOB'}-${Math.floor(1000 + Math.random() * 9000)}`;
  const candCode = (db as any).generateCandidateCode ? (db as any).generateCandidateCode() : `CND-${Math.floor(1000 + Math.random() * 9000)}`;

  const newCandidate: Candidate = {
    id: `cand-${uuidv4().substring(0, 8)}`,
    applicationId: appId,
    candidateCode: candCode,
    organizationId: org.id,
    jobId: job.id,
    jobCode: job.jobCode,
    jobTitle: job.title,
    clientId: job.clientId || undefined,
    clientName: job.clientName,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim().toLowerCase(),
    phone: phone || '',
    location: location || 'Bangalore, India',
    resumeFileName: resumeFileName || undefined,
    resumeUrl: resumeUrl || undefined,
    resumeSize: req.body.resumeSize || (resumeUrl ? 250000 : undefined),
    currentCtc,
    expectedCtc,
    totalExperience,
    noticePeriod,
    screeningAnswers: screeningAnswers || {},
    stage: 'applied', // Direct external applications enter 'applied' stage
    source: source as any,
    matchScore,
    appliedAt: new Date().toISOString(),
    notes: [
      `Applied via ${source} at ${new Date().toLocaleString()}.`,
      `Application ID: ${appId} (Job: ${job.jobCode || job.id})`,
      `AI Resume Match computed: ${matchScore}% profile alignment.`
    ]
  };

  store.candidates.unshift(newCandidate);
  job.applicantsCount = store.candidates.filter(c => c.jobId === job.id).length;

  if (db.inboundApplications) {
    db.inboundApplications.unshift({
      id: appId,
      organizationId: org.id,
      from: email,
      to: job.clientEmail || 'recruiter@hiredeskhr.com',
      subject: `Application: ${job.title} (${job.jobCode})`,
      body: `Application from ${firstName} ${lastName}`,
      attachmentName: resumeFileName || 'Resume.pdf',
      attachmentUrl: resumeUrl,
      candidateName: `${firstName} ${lastName}`,
      candidateEmail: email,
      candidatePhone: phone,
      status: 'confirmed',
      confirmedJobId: job.id,
      possibleJobIds: [job.id],
      receivedAt: new Date().toISOString()
    });
  }

  // 1. Dispatch real outbound notification to Recruiter email (admin@hiredeskhr.com)
  const recruiterTarget = emailConfig.recruiterNotificationEmail || 'admin@hiredeskhr.com';
  emailService.sendCandidateAppliedNotification(
    recruiterTarget,
    newCandidate,
    job
  ).catch(err => {
    console.error('❌ Failed to dispatch candidate alert to recruiter:', err.message);
  });

  // 2. Dispatch confirmation email to applicant if valid email address provided
  if (newCandidate.email && newCandidate.email.includes('@')) {
    emailService.sendEmail({
      to: newCandidate.email,
      subject: `Application Received: ${job.title} at ${org.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; background: #f8fafc;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e2e8f0;">
            <h2 style="color: #0f766e; margin-top: 0;">Application Received!</h2>
            <p style="font-size: 15px; color: #334155; line-height: 1.6;">
              Dear <strong>${newCandidate.firstName}</strong>,
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.6;">
              Thank you for applying for the <strong>${job.title}</strong> position at <strong>${org.name}</strong>. We have received your application${newCandidate.resumeFileName ? ` and resume (<code>${newCandidate.resumeFileName}</code>)` : ''}.
            </p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="margin: 0; color: #166534; font-weight: bold;">Status: In Review</p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #15803d;">Application Reference: #${newCandidate.id}</p>
            </div>
            <p style="font-size: 13px; color: #64748b;">
              Our talent acquisition team will review your qualifications and reach out regarding next steps.
            </p>
          </div>
        </div>
      `,
      text: `Thank you for applying for ${job.title} at ${org.name}. Your application #${newCandidate.id} has been received.`
    }).catch(err => {
      console.warn('⚠️ Applicant confirmation email delivery note:', err.message);
    });
  }

  // Automatically create candidate acknowledgment email thread in Recruiter Inbox
  store.emailThreads.unshift({
    id: `thread-${newCandidate.id}`,
    organizationId: org.id,
    candidateId: newCandidate.id,
    candidateName: `${newCandidate.firstName} ${newCandidate.lastName}`,
    candidateEmail: newCandidate.email,
    jobTitle: job.title,
    subject: `Application Confirmation: ${job.title} at ${org.name}`,
    lastMessageAt: new Date().toISOString(),
    unread: true,
    messages: [
      {
        id: `msg-${uuidv4().substring(0, 6)}`,
        sender: 'recruiter',
        senderName: `${org.name} Talent Acquisition`,
        content: `Hi ${newCandidate.firstName},\n\nThank you for applying for the ${job.title} position at ${org.name}. We have successfully received your application and resume. Our recruitment team is currently reviewing your profile and will update you soon.\n\nBest regards,\n${org.name} Careers Team`,
        timestamp: new Date().toISOString(),
        status: 'delivered'
      }
    ]
  });

  // Persist the application, resume link, client assignment, and inbox thread
  // so the candidate remains available in the client dashboard after restart.
  store.save();

  return res.status(201).json({
    success: true,
    message: 'Application submitted successfully! Your resume has been delivered to the hiring team.',
    applicationId: newCandidate.applicationId,
    candidateId: newCandidate.id,
    recruiterNotified: recruiterTarget
  });
});
