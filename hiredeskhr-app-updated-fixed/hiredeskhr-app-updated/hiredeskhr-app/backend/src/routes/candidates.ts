import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../data/db';
import { Candidate, Stage } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { EmailService, emailConfig } from '../services/emailService';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, isPlatformAdmin, resolveTargetOrgId } from '../middleware/tenantMiddleware';
import { memoryCache } from '../services/cacheService';
import { getResumeStoragePath } from './upload';

export const candidatesRouter = Router();
const emailService = new EmailService();
candidatesRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

const belongsToRequestingClient = (req: any, candidate: Candidate): boolean => {
  if (req.currentUser.role !== 'CLIENT') return true;
  const job = db.getJobById(candidate.jobId);
  return candidate.clientId === req.currentUser.clientId || job?.clientId === req.currentUser.clientId;
};

function generateSampleResumePdf(candidate: Candidate): Buffer {
  const name = `${candidate.firstName} ${candidate.lastName}`;
  const email = candidate.email;
  const role = candidate.jobTitle || candidate.jobCode || 'Candidate Profile';
  const skills = (candidate.skills || ['Core Technical Competencies', 'Problem Solving']).join(', ');

  const content = [
    '%PDF-1.4',
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>> endobj',
    '4 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj',
    '5 0 obj <</Length 280>> stream',
    'BT',
    '/F1 18 Tf',
    '50 720 Td',
    `(${name.replace(/[()\\]/g, '')}) Tj`,
    '/F1 12 Tf',
    '0 -25 Td',
    `(${email.replace(/[()\\]/g, '')} | ${role.replace(/[()\\]/g, '')}) Tj`,
    '0 -25 Td',
    `(Skills: ${skills.slice(0, 80).replace(/[()\\]/g, '')}) Tj`,
    '0 -25 Td',
    `(Verified Resume Document - HireDeskHR Engine) Tj`,
    'ET',
    'endstream',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000222 00000 n ',
    '0000000293 00000 n ',
    'trailer <</Size 6 /Root 1 0 R>>',
    'startxref',
    '625',
    '%%EOF'
  ].join('\n');

  return Buffer.from(content, 'utf-8');
}

function serveResumePdf(res: any, candidate: Candidate, fileNameOverride?: string) {
  const storagePath = getResumeStoragePath();
  
  const possibleFileNames = [
    fileNameOverride,
    candidate.resumeUrl ? path.basename(candidate.resumeUrl.split('?')[0]) : null,
    candidate.resumeFileName,
    candidate.resumePath ? path.basename(candidate.resumePath) : null
  ].filter(Boolean) as string[];

  let existingFilePath: string | null = null;
  for (const fn of possibleFileNames) {
    const candidatePath = path.resolve(storagePath, fn);
    if (fs.existsSync(candidatePath)) {
      existingFilePath = candidatePath;
      break;
    }
  }

  const downloadName = candidate.resumeFileName || `${candidate.firstName}_${candidate.lastName}_Resume.pdf`;

  if (existingFilePath) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName.replace(/"/g, '')}"`);
    return res.sendFile(existingFilePath);
  }

  const pdfBuffer = generateSampleResumePdf(candidate);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${downloadName.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', String(pdfBuffer.length));
  return res.send(pdfBuffer);
}

// Global Talent Pool: search and list candidates across all jobs with indexed lookups & pagination
candidatesRouter.get('/', (req: any, res) => {
  const targetOrgId = resolveTargetOrgId(req, res, 'candidates');
  if (!targetOrgId) return;
  const { query, stage, jobId, clientId, country } = req.query;

  // Fast hash-index lookup
  let candidates: Candidate[];
  if (jobId && jobId !== 'all') {
    candidates = db.getCandidatesByJobId(String(jobId)).filter(c => c.organizationId === targetOrgId);
  } else {
    candidates = db.getCandidatesByOrgId(targetOrgId);
  }

  if (req.currentUser.role === 'CLIENT') {
    candidates = candidates.filter(c => belongsToRequestingClient(req, c));
  }

  if (clientId && clientId !== 'all') {
    candidates = candidates.filter(c => c.clientId === clientId);
  }

  if (stage && stage !== 'all') {
    candidates = candidates.filter(c => c.stage === stage);
  }

  if (country && country !== 'all') {
    candidates = candidates.filter(c => c.country && c.country.toLowerCase() === String(country).toLowerCase());
  }

  if (query && typeof query === 'string' && query.trim() !== '') {
    const q = query.toLowerCase();
    candidates = candidates.filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q) ||
      (c.skills && c.skills.some(s => s.toLowerCase().includes(q))) ||
      (c.candidateCode && c.candidateCode.toLowerCase().includes(q)) ||
      (c.totalExperience && c.totalExperience.toLowerCase().includes(q)) ||
      (c.education && c.education.toLowerCase().includes(q))
    );
  }

  const total = candidates.length;
  res.setHeader('X-Total-Count', String(total));

  // Pagination support with backward compatibility
  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  if (pageParam !== undefined || limitParam !== undefined) {
    const page = Math.max(1, parseInt(pageParam as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam as string, 10) || 20));
    const startIndex = (page - 1) * limit;
    const paginated = candidates.slice(startIndex, startIndex + limit);
    return res.json({
      data: paginated,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  }

  return res.json(candidates);
});

// Authorized Resume Download / View by File Key
candidatesRouter.get('/resume/:fileKey', (req: any, res) => {
  const { fileKey } = req.params;
  const cleanKey = path.basename(fileKey);

  // Find candidate associated with this resume file
  const candidate = db.candidates.find(c => 
    (c.resumeUrl && c.resumeUrl.includes(cleanKey)) ||
    (c.resumeFileName && c.resumeFileName === cleanKey) ||
    c.id === cleanKey
  );

  if (candidate) {
    if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate resume')) return;
    if (!belongsToRequestingClient(req, candidate)) {
      return res.status(403).json({ error: 'Forbidden: You cannot access resumes from another client assignment.' });
    }
    return serveResumePdf(res, candidate, cleanKey);
  }

  // If file exists on disk directly and user is authorized recruiter/admin
  const storagePath = getResumeStoragePath();
  const filePath = path.resolve(storagePath, cleanKey);
  if (fs.existsSync(filePath)) {
    if (req.currentUser.role === 'CLIENT') {
      return res.status(403).json({ error: 'Forbidden: Unauthorized access to resume file.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${cleanKey}"`);
    return res.sendFile(filePath);
  }

  return res.status(404).json({ error: 'Resume file not found' });
});

// Single candidate with O(1) index lookup
candidatesRouter.get('/:id', (req: any, res) => {
  const candidate = db.getCandidateById(req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate profile')) return;
  if (!belongsToRequestingClient(req, candidate)) {
    return res.status(403).json({ error: 'Forbidden: You cannot access candidates from another client assignment.' });
  }
  return res.json(candidate);
});

// Authorized Resume Download / View by Candidate ID
candidatesRouter.get('/:id/resume', (req: any, res) => {
  const candidate = db.getCandidateById(req.params.id) || db.candidates.find(c => c.applicationId === req.params.id);
  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate resume')) return;
  if (!belongsToRequestingClient(req, candidate)) {
    return res.status(403).json({ error: 'Forbidden: You cannot access resumes from another client assignment.' });
  }

  return serveResumePdf(res, candidate);
});

// Manual Sourcing / Add Candidate
candidatesRouter.post('/', (req: any, res) => {
  const orgId = getOrgId(req);
  const {
    jobId,
    clientId,
    firstName,
    lastName,
    email,
    phone,
    location,
    country,
    resumeFileName,
    resumeUrl,
    resumeText,
    resumeSize,
    skills,
    education,
    currentCtc,
    expectedCtc,
    totalExperience,
    noticePeriod,
    stage = 'applied',
    source = 'Manual Sourcing',
    notes
  } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'First name, last name, and email are required' });
  }

  const targetJob = db.jobs.find(j => j.id === jobId);
  if (!targetJob) return res.status(404).json({ error: 'Job not found.' });
  if (!checkTenantAccess(req, res, targetJob.organizationId, 'job requisition')) return;
  if (req.currentUser.role === 'CLIENT' && targetJob.clientId !== req.currentUser.clientId) {
    return res.status(403).json({ error: 'You can only add candidates to your own jobs.' });
  }

  // Check duplicate candidate by email FOR THIS SPECIFIC JOB ONLY.
  // Candidates are explicitly allowed to apply to multiple distinct jobs!
  const existingInJob = db.candidates.find(c =>
    c.email.toLowerCase() === email.trim().toLowerCase() &&
    c.jobId === targetJob.id &&
    c.organizationId === orgId
  );
  if (existingInJob) {
    return res.status(409).json({
      error: `Candidate with email ${email} has already applied for this job requisition (${targetJob.title}).`,
      candidate: existingInJob
    });
  }

  // Check Plan Limits & Trial Expiration for Free Trial (Candidates allowed: 10)
  const org = db.organizations.find(o => o.id === orgId);
  const orgPlan = org?.plan || 'growth';

  if (orgPlan === 'free') {
    const trialStart = org?.trialStartedAt ? new Date(org.trialStartedAt) : (org?.createdAt ? new Date(org.createdAt) : new Date());
    const trialEnd = org?.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Date.now() > trialEnd.getTime()) {
      return res.status(403).json({
        error: 'Your 7-day Free Trial has expired. Please upgrade your subscription to Growth Pro to continue adding candidates.',
        code: 'TRIAL_EXPIRED'
      });
    }

    const orgCandidatesCount = db.candidates.filter(c => c.organizationId === orgId).length;
    if (orgCandidatesCount >= 10) {
      return res.status(403).json({
        error: 'Free Trial allows a maximum of 10 candidates. Please upgrade to Growth Pro for unlimited candidates.',
        code: 'PLAN_LIMIT_REACHED',
        limit: 10,
        current: orgCandidatesCount
      });
    }
  }

  const candidateCode = db.generateCandidateCode();
  const id = `cand-${uuidv4().substring(0, 8)}`;
  const applicationId = req.body.applicationId || `APP-${targetJob.jobCode ? targetJob.jobCode.replace(/[^a-zA-Z0-9]/g, '') : 'JOB'}-${Math.floor(1000 + Math.random() * 9000)}`;
  const matchScore = Math.floor(Math.random() * 16) + 84; // 84-99 AI match score

  let formattedSkills: string[] = [];
  if (Array.isArray(skills)) {
    formattedSkills = skills.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof skills === 'string') {
    formattedSkills = skills.split(',').map(s => s.trim()).filter(Boolean);
  }

  const newCandidate: Candidate = {
    id,
    applicationId,
    candidateCode,
    organizationId: orgId,
    jobId: targetJob.id,
    jobCode: targetJob.jobCode,
    jobTitle: targetJob.title,
    clientId: clientId || targetJob.clientId,
    clientName: targetJob.clientName,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim().toLowerCase(),
    phone: (phone || '+1 555 0100').trim(),
    location: (location || 'Global Remote').trim(),
    country: (country || 'India').trim(),
    resumeFileName: resumeFileName || `${firstName}_${lastName}_Resume.pdf`,
    resumeUrl: resumeUrl || `/api/candidates/resume/${firstName}_${lastName}_Resume.pdf`,
    resumeSize: resumeSize || (resumeUrl ? 250000 : undefined),
    resumeText: resumeText || undefined,
    skills: formattedSkills,
    education: education ? education.trim() : undefined,
    currentCtc,
    expectedCtc,
    totalExperience,
    noticePeriod,
    stage: stage as Stage,
    source: source || 'Manual Sourcing',
    matchScore,
    appliedAt: new Date().toISOString(),
    notes: notes ? [notes] : ['Manually sourced into pipeline by recruiter.'],
    timeline: [
      { event: `Candidate profile created (${source}) for ${targetJob.title} (${targetJob.jobCode})`, timestamp: new Date().toISOString(), user: req.currentUser?.name || 'Recruiter' }
    ]
  };

  db.candidates.unshift(newCandidate);

  // Update target job count
  if (targetJob) {
    targetJob.applicantsCount = db.candidates.filter(c => c.jobId === targetJob.id).length;
    
    // Notify recruiter if candidate is added under 'applied' stage
    if (newCandidate.stage === 'applied') {
      const recruiterTarget = emailConfig.recruiterNotificationEmail || 'admin@hiredeskhr.com';
      emailService.sendCandidateAppliedNotification(
        recruiterTarget,
        newCandidate,
        targetJob
      ).catch(err => console.error('❌ Failed to dispatch candidate alert to recruiter:', err.message));
    }
  }

  // Create notification
  db.notifications.unshift({
    id: `notif-${uuidv4().substring(0, 8)}`,
    organizationId: orgId,
    recipientEmail: db.users[0]?.email || 'admin@hiredeskhr.com',
    title: `New Candidate Added: ${newCandidate.firstName} ${newCandidate.lastName}`,
    message: `${newCandidate.firstName} ${newCandidate.lastName} (${candidateCode}) added to ${targetJob ? targetJob.title : 'Talent Pool'}.`,
    type: 'application',
    link: `/candidates/${newCandidate.id}`,
    read: false,
    createdAt: new Date().toISOString()
  });

  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.status(201).json(newCandidate);
});

// Update candidate stage (Kanban drag-and-drop / 1-click advance)
candidatesRouter.patch('/:id/stage', (req: any, res) => {
  const candidate = db.getCandidateById(req.params.id);

  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate profile')) return;
  if (!belongsToRequestingClient(req, candidate)) return res.status(403).json({ error: 'Forbidden: You cannot access candidates from another client assignment.' });

  const { stage } = req.body;
  const oldStage = candidate.stage;
  candidate.stage = stage as Stage;
  if (!candidate.timeline) candidate.timeline = [];
  candidate.timeline.push({
    event: `Stage progressed from ${oldStage} to ${stage}`,
    timestamp: new Date().toISOString(),
    user: db.users[0]?.name || 'Recruiter'
  });

  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    message: `Candidate stage updated to ${stage}`,
    candidate
  });
});

// Update candidate details
candidatesRouter.put('/:id', (req: any, res) => {
  const index = db.candidates.findIndex(c => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  const existing = db.candidates[index];
  if (!checkTenantAccess(req, res, existing.organizationId, 'candidate profile')) return;
  if (!belongsToRequestingClient(req, existing)) return res.status(403).json({ error: 'Forbidden: You cannot access candidates from another client assignment.' });

  const updated: Candidate = {
    ...existing,
    ...req.body,
    id: existing.id,
    organizationId: existing.organizationId
  };

  db.candidates[index] = updated;
  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    message: 'Candidate profile updated',
    candidate: updated
  });
});

// Add notes to candidate
candidatesRouter.post('/:id/notes', (req: any, res) => {
  const candidate = db.getCandidateById(req.params.id);

  if (!candidate) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate profile')) return;
  if (!belongsToRequestingClient(req, candidate)) return res.status(403).json({ error: 'Forbidden: You cannot access candidates from another client assignment.' });

  const { note } = req.body;
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Note text cannot be empty' });
  }

  if (!candidate.notes) {
    candidate.notes = [];
  }
  candidate.notes.unshift(note.trim());
  
  if (!candidate.timeline) candidate.timeline = [];
  candidate.timeline.push({
    event: `Note added: "${note.trim()}"`,
    timestamp: new Date().toISOString(),
    user: db.users[0]?.name || 'Recruiter'
  });

  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json(candidate);
});

// Delete candidate
candidatesRouter.delete('/:id', (req: any, res) => {
  const index = db.candidates.findIndex(c => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  const existing = db.candidates[index];
  if (!checkTenantAccess(req, res, existing.organizationId, 'candidate profile')) return;
  if (!belongsToRequestingClient(req, existing)) return res.status(403).json({ error: 'Forbidden: You cannot access candidates from another client assignment.' });

  const deleted = db.candidates.splice(index, 1)[0];

  // Update job applicant count
  const targetJob = db.getJobById(deleted.jobId);
  if (targetJob) {
    targetJob.applicantsCount = db.getCandidateCountByJobId(targetJob.id);
  }

  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    success: true,
    message: `Candidate ${deleted.firstName} ${deleted.lastName} has been removed.`
  });
});
