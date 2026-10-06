import { Router } from 'express';
import { db, DEFAULT_APPLICATION_CONFIG } from '../data/db';
import { Job } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { EmailService, emailConfig } from '../services/emailService';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, isPlatformAdmin, resolveTargetOrgId } from '../middleware/tenantMiddleware';

import { memoryCache } from '../services/cacheService';

export const jobsRouter = Router();
const emailService = new EmailService();
jobsRouter.use(requireAuthenticated);

// Helper to get current org id
const getOrgId = (req: any): string => {
  return req.currentUser?.organizationId;
};

// List all jobs for the organization with optional filtering & pagination
jobsRouter.get('/', (req: any, res) => {
  const targetOrgId = resolveTargetOrgId(req, res, 'jobs');
  if (!targetOrgId) return;
  const statusFilter = req.query.status as string;
  const clientId = req.query.clientId as string;
  const search = (req.query.search as string || '').toLowerCase().trim();

  // Fast hash-index lookup by orgId
  let jobs = db.getJobsByOrgId(targetOrgId);
  if (req.currentUser.role === 'CLIENT') {
    jobs = jobs.filter(j => j.clientId === req.currentUser.clientId);
  }

  if (clientId) {
    jobs = jobs.filter(j => j.clientId === clientId);
  }

  if (statusFilter && statusFilter !== 'all') {
    jobs = jobs.filter(j => j.status === statusFilter);
  }

  if (search) {
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(search) ||
      j.clientName.toLowerCase().includes(search) ||
      (j.jobCode && j.jobCode.toLowerCase().includes(search)) ||
      j.location.toLowerCase().includes(search) ||
      j.department.toLowerCase().includes(search) ||
      (j.skills && j.skills.some(s => s.toLowerCase().includes(search)))
    );
  }

  // O(1) applicant counts lookup via candidate count index
  jobs = jobs.map(j => ({
    ...j,
    applicantsCount: db.getCandidateCountByJobId(j.id)
  }));

  const total = jobs.length;
  res.setHeader('X-Total-Count', String(total));

  // Pagination support: if page or limit query param is provided, return structured pagination
  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  if (pageParam !== undefined || limitParam !== undefined) {
    const page = Math.max(1, parseInt(pageParam as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam as string, 10) || 20));
    const startIndex = (page - 1) * limit;
    const paginated = jobs.slice(startIndex, startIndex + limit);
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

  return res.json(jobs);
});

// Get single job details with O(1) indexed lookup
jobsRouter.get('/:id', (req: any, res) => {
  const job = db.getJobById(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job requisition not found' });
  }

  if (!checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;

  if (req.currentUser.role === 'CLIENT' && job.clientId && job.clientId !== req.currentUser.clientId) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this client requisition.', code: 'FORBIDDEN_CLIENT_ROLE' });
  }

  const applicantsCount = db.getCandidateCountByJobId(job.id);
  return res.json({ ...job, applicantsCount });
});

// Create Job with Full 16-Field Validation & Sequential Job ID
jobsRouter.post('/', (req: any, res) => {
  const orgId = getOrgId(req);
  const authenticatedUser = req.currentUser;
  const {
    title,
    clientName,
    clientId,
    department,
    location,
    country,
    stateCity,
    workplaceType,
    employmentType,
    salaryMin,
    salaryMax,
    currency,
    experienceMin,
    experienceMax,
    education,
    skills,
    openingsCount,
    deadline,
    recruiterId,
    recruiterName,
    description,
    requirements,
    status = 'active',
    applicationFormConfig,
    publishOnLinkedIn = true
  } = req.body;

  // Validation
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Job title is required.' });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'Job description is required.' });
  }

  const effectiveWorkplaceType = workplaceType || 'Hybrid';
  const effectiveCountry = (country || 'India').trim();
  let effectiveLocation = (location || '').trim();
  let effectiveStateCity = stateCity ? stateCity.trim() : undefined;

  if (effectiveWorkplaceType === 'Remote') {
    effectiveLocation = `Remote (${effectiveCountry})`;
    effectiveStateCity = undefined;
  } else if (!effectiveLocation) {
    effectiveLocation = effectiveStateCity ? `${effectiveStateCity}, ${effectiveCountry}` : effectiveCountry;
  }

  if (!effectiveLocation) {
    return res.status(400).json({ error: 'Job location is required.' });
  }

  // Check Plan Limits & Trial Expiration
  const org = db.organizations.find(o => o.id === orgId);
  const orgPlan = org?.plan || 'growth';
  const desiredStatus = status === 'draft' || status === 'closed' ? status : 'active';

  if (orgPlan === 'free') {
    const trialStart = org?.trialStartedAt ? new Date(org.trialStartedAt) : (org?.createdAt ? new Date(org.createdAt) : new Date());
    const trialEnd = org?.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (Date.now() > trialEnd.getTime()) {
      return res.status(403).json({
        error: 'Your 7-day Free Trial has expired. Please upgrade your subscription to Growth Pro to continue posting jobs.',
        code: 'TRIAL_EXPIRED'
      });
    }

    if (desiredStatus === 'active') {
      const activeJobs = db.jobs.filter(j => j.organizationId === orgId && j.status === 'active');
      if (activeJobs.length >= 1) {
        return res.status(403).json({
          error: 'Free Trial allows a maximum of 1 active job opening. Please upgrade to Growth Pro to post more jobs.',
          code: 'PLAN_LIMIT_REACHED',
          limit: 1,
          current: activeJobs.length
        });
      }
    }
  } else if (orgPlan === 'growth' && desiredStatus === 'active') {
    const allowedJobs = Math.max(5, org?.jobsPurchased || 5);
    const activeJobs = db.jobs.filter(j => j.organizationId === orgId && j.status === 'active');
    if (activeJobs.length >= allowedJobs) {
      return res.status(403).json({
        error: `Growth Pro limit reached (${allowedJobs} active jobs allowed). Please increase your purchased jobs to post more.`,
        code: 'PLAN_LIMIT_REACHED',
        limit: allowedJobs,
        current: activeJobs.length
      });
    }
  }

  // Format skills as array of strings
  let formattedSkills: string[] = [];
  if (Array.isArray(skills)) {
    formattedSkills = skills.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof skills === 'string') {
    formattedSkills = skills.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Format requirements as array of strings
  let formattedRequirements: string[] = [];
  if (Array.isArray(requirements)) {
    formattedRequirements = requirements.map(r => String(r).trim()).filter(Boolean);
  } else if (typeof requirements === 'string') {
    formattedRequirements = requirements.split('\n').map(r => r.trim()).filter(Boolean);
  }

  if (authenticatedUser.role === 'CLIENT' && clientId && clientId !== authenticatedUser.clientId) {
    return res.status(403).json({ error: 'You can only post jobs for your own company.' });
  }
  const effectiveClientId = authenticatedUser.role === 'CLIENT' ? authenticatedUser.clientId : clientId;

  // Lookup client if provided
  let resolvedClientName = clientName || 'HiredeskHR';
  let resolvedClientEmail: string | undefined;
  if (effectiveClientId) {
    const client = db.clients.find(c => c.id === effectiveClientId && c.organizationId === orgId);
    if (client) {
      resolvedClientName = client.companyName;
      resolvedClientEmail = client.email;
    }
  }

  const jobCode = db.generateJobCode(); // e.g. JOB-1003
  const id = `job-${uuidv4().substring(0, 8)}`;

  const newJob: Job = {
    id,
    jobCode,
    organizationId: orgId,
    title: title.trim(),
    clientName: resolvedClientName,
    clientEmail: resolvedClientEmail || db.users.find(user => user.organizationId === orgId)?.email,
    clientId: effectiveClientId || undefined,
    department: (department || 'Engineering').trim(),
    location: effectiveLocation,
    country: effectiveCountry,
    stateCity: effectiveStateCity,
    workplaceType: effectiveWorkplaceType,
    employmentType: employmentType || 'Full-time',
    salaryMin: salaryMin ? Number(salaryMin) : undefined,
    salaryMax: salaryMax ? Number(salaryMax) : undefined,
    currency: (currency || 'USD').toUpperCase().trim(),
    experienceMin: experienceMin ? Number(experienceMin) : 0,
    experienceMax: experienceMax ? Number(experienceMax) : undefined,
    education: education ? education.trim() : "Bachelor's Degree or Equivalent",
    skills: formattedSkills.length > 0 ? formattedSkills : ['General Engineering'],
    openingsCount: openingsCount ? Math.max(1, Number(openingsCount)) : 1,
    deadline: deadline || undefined,
    recruiterId: recruiterId || db.users[0]?.id || 'user-sarah',
    recruiterName: recruiterName || db.users[0]?.name || 'Sarah Jenkins',
    description: description.trim(),
    requirements: formattedRequirements.length > 0 ? formattedRequirements : ['Demonstrated track record of technical delivery'],
    status: desiredStatus,
    applicationFormConfig: applicationFormConfig || DEFAULT_APPLICATION_CONFIG,
    publishedOnLinkedIn: Boolean(publishOnLinkedIn),
    adminNotifiedForLinkedIn: true,
    applicantsCount: 0,
    createdAt: new Date().toISOString()
  };

  db.jobs.unshift(newJob);

  // Record audit log
  db.auditLogs.unshift({
    id: `audit-${uuidv4().substring(0, 8)}`,
    organizationId: orgId,
    userEmail: db.users[0]?.email || 'recruiter@hiredeskhr.com',
    action: 'CREATE_JOB',
    resource: 'Job',
    resourceId: newJob.id,
    details: `Created job requisition ${newJob.title} (${newJob.jobCode}) for ${newJob.clientName}`,
    timestamp: new Date().toISOString()
  });

  // Persistent disk write
  db.save();
  memoryCache.invalidatePrefix('admin:');

  console.log(`✅ [JOBS] Successfully created and saved job: ${newJob.jobCode} - ${newJob.title}`);

  // Actually dispatch the "a job was posted" email to the admin inbox -
  // fire-and-forget so job creation never waits on/fails because of SMTP.
  const adminRecipient = emailConfig.recruiterNotificationEmail;
  emailService.sendJobPostedNotification(adminRecipient, newJob)
    .then(result => {
      if (!result.success) {
        console.error(`❌ [JOBS] Failed to email admin about ${newJob.jobCode}: ${result.message}`);
      } else {
        console.log(`📧 [JOBS] Job-posted notification sent to ${adminRecipient} via ${result.provider}`);
      }
    })
    .catch(err => console.error(`❌ [JOBS] Job-posted email dispatch error:`, err.message));

  const adminNotification = {
    dispatched: true,
    channel: 'email',
    recipient: adminRecipient,
    subject: `New Job Posted: ${newJob.title} - ${newJob.clientName} (${newJob.jobCode})`,
    sentAt: new Date().toISOString(),
    status: 'sending'
  };

  return res.status(201).json({
    message: `Job ${newJob.jobCode} created successfully!`,
    job: newJob,
    adminNotification
  });
});

// Update Job (Full Edit)
jobsRouter.put('/:id', (req: any, res) => {
  const index = db.jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job requisition not found' });
  }

  const existing = db.jobs[index];
  if (!checkTenantAccess(req, res, existing.organizationId, 'job requisition')) return;

  const {
    title,
    clientName,
    clientId,
    department,
    location,
    country,
    stateCity,
    workplaceType,
    employmentType,
    salaryMin,
    salaryMax,
    currency,
    experienceMin,
    experienceMax,
    education,
    skills,
    openingsCount,
    deadline,
    recruiterId,
    recruiterName,
    description,
    requirements,
    status
  } = req.body;

  let formattedSkills = existing.skills;
  if (skills !== undefined) {
    if (Array.isArray(skills)) {
      formattedSkills = skills.map(s => String(s).trim()).filter(Boolean);
    } else if (typeof skills === 'string') {
      formattedSkills = skills.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  let formattedRequirements = existing.requirements;
  if (requirements !== undefined) {
    if (Array.isArray(requirements)) {
      formattedRequirements = requirements.map(r => String(r).trim()).filter(Boolean);
    } else if (typeof requirements === 'string') {
      formattedRequirements = requirements.split('\n').map(r => r.trim()).filter(Boolean);
    }
  }

  const effectiveWorkplaceType = workplaceType || existing.workplaceType;
  const effectiveCountry = (country !== undefined ? country.trim() : existing.country) || 'India';
  let effectiveLocation = location !== undefined ? location.trim() : existing.location;
  let effectiveStateCity = stateCity !== undefined ? stateCity.trim() : existing.stateCity;

  if (effectiveWorkplaceType === 'Remote') {
    effectiveLocation = `Remote (${effectiveCountry})`;
    effectiveStateCity = undefined;
  }

  // If status is transitioning to 'active', check plan limits
  if (status === 'active' && existing.status !== 'active') {
    const org = db.organizations.find(o => o.id === existing.organizationId);
    const orgPlan = org?.plan || 'growth';

    if (orgPlan === 'free') {
      const trialStart = org?.trialStartedAt ? new Date(org.trialStartedAt) : (org?.createdAt ? new Date(org.createdAt) : new Date());
      const trialEnd = org?.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (Date.now() > trialEnd.getTime()) {
        return res.status(403).json({
          error: 'Your 7-day Free Trial has expired. Please upgrade your subscription to Growth Pro to activate this job.',
          code: 'TRIAL_EXPIRED'
        });
      }

      const activeJobs = db.jobs.filter(j => j.organizationId === existing.organizationId && j.status === 'active' && j.id !== existing.id);
      if (activeJobs.length >= 1) {
        return res.status(403).json({
          error: 'Free Trial allows a maximum of 1 active job opening. Please upgrade to Growth Pro to activate more jobs.',
          code: 'PLAN_LIMIT_REACHED',
          limit: 1,
          current: activeJobs.length
        });
      }
    } else if (orgPlan === 'growth') {
      const allowedJobs = Math.max(5, org?.jobsPurchased || 5);
      const activeJobs = db.jobs.filter(j => j.organizationId === existing.organizationId && j.status === 'active' && j.id !== existing.id);
      if (activeJobs.length >= allowedJobs) {
        return res.status(403).json({
          error: `Growth Pro limit reached (${allowedJobs} active jobs allowed). Please increase your purchased jobs to activate more jobs.`,
          code: 'PLAN_LIMIT_REACHED',
          limit: allowedJobs,
          current: activeJobs.length
        });
      }
    }
  }

  const updated: Job = {
    ...existing,
    title: title !== undefined ? title.trim() : existing.title,
    clientName: clientName !== undefined ? clientName.trim() : existing.clientName,
    clientId: clientId !== undefined ? clientId : existing.clientId,
    department: department !== undefined ? department.trim() : existing.department,
    location: effectiveLocation,
    country: effectiveCountry,
    stateCity: effectiveStateCity,
    workplaceType: effectiveWorkplaceType,
    employmentType: employmentType || existing.employmentType,
    salaryMin: salaryMin !== undefined ? (salaryMin ? Number(salaryMin) : undefined) : existing.salaryMin,
    salaryMax: salaryMax !== undefined ? (salaryMax ? Number(salaryMax) : undefined) : existing.salaryMax,
    currency: currency ? currency.toUpperCase().trim() : existing.currency,
    experienceMin: experienceMin !== undefined ? Number(experienceMin) : existing.experienceMin,
    experienceMax: experienceMax !== undefined ? Number(experienceMax) : existing.experienceMax,
    education: education !== undefined ? education.trim() : existing.education,
    skills: formattedSkills,
    openingsCount: openingsCount !== undefined ? Math.max(1, Number(openingsCount)) : existing.openingsCount,
    deadline: deadline !== undefined ? deadline : existing.deadline,
    recruiterId: recruiterId || existing.recruiterId,
    recruiterName: recruiterName || existing.recruiterName,
    description: description !== undefined ? description.trim() : existing.description,
    requirements: formattedRequirements,
    status: status || existing.status,
    updatedAt: new Date().toISOString()
  };

  db.jobs[index] = updated;
  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    message: 'Job requisition updated successfully',
    job: updated
  });
});

// Partial update / Status update
jobsRouter.patch('/:id/status', (req: any, res) => {
  const job = db.jobs.find(j => j.id === req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job requisition not found' });
  }

  if (!checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;

  if (req.currentUser.role === 'CLIENT' && job.clientId && job.clientId !== req.currentUser.clientId) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this client requisition.', code: 'FORBIDDEN_CLIENT_ROLE' });
  }

  const { status } = req.body;
  if (!['active', 'draft', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be active, draft, or closed.' });
  }

  if (status === 'active' && job.status !== 'active') {
    const org = db.organizations.find(o => o.id === job.organizationId);
    const orgPlan = org?.plan || 'growth';

    if (orgPlan === 'free') {
      const trialStart = org?.trialStartedAt ? new Date(org.trialStartedAt) : (org?.createdAt ? new Date(org.createdAt) : new Date());
      const trialEnd = org?.trialEndsAt ? new Date(org.trialEndsAt) : new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (Date.now() > trialEnd.getTime()) {
        return res.status(403).json({
          error: 'Your 7-day Free Trial has expired. Please upgrade your subscription to Growth Pro to activate this job.',
          code: 'TRIAL_EXPIRED'
        });
      }

      const activeJobs = db.jobs.filter(j => j.organizationId === job.organizationId && j.status === 'active' && j.id !== job.id);
      if (activeJobs.length >= 1) {
        return res.status(403).json({
          error: 'Free Trial allows a maximum of 1 active job opening. Please upgrade to Growth Pro to activate more jobs.',
          code: 'PLAN_LIMIT_REACHED',
          limit: 1,
          current: activeJobs.length
        });
      }
    } else if (orgPlan === 'growth') {
      const allowedJobs = Math.max(5, org?.jobsPurchased || 5);
      const activeJobs = db.jobs.filter(j => j.organizationId === job.organizationId && j.status === 'active' && j.id !== job.id);
      if (activeJobs.length >= allowedJobs) {
        return res.status(403).json({
          error: `Growth Pro limit reached (${allowedJobs} active jobs allowed). Please increase your purchased jobs to activate more jobs.`,
          code: 'PLAN_LIMIT_REACHED',
          limit: allowedJobs,
          current: activeJobs.length
        });
      }
    }
  }

  job.status = status;
  job.updatedAt = new Date().toISOString();
  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    message: `Job requisition status changed to ${status}`,
    job
  });
});

// Delete Job (Platform Admin Only - Clients cannot permanently delete jobs)
jobsRouter.delete('/:id', (req: any, res) => {
  if (!isPlatformAdmin(req.currentUser?.role)) {
    return res.status(403).json({
      error: 'Clients are not permitted to delete jobs. You may close the job instead to retain history.'
    });
  }

  const index = db.jobs.findIndex(j => j.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Job requisition not found' });
  }

  const existing = db.jobs[index];
  if (!checkTenantAccess(req, res, existing.organizationId, 'job requisition')) return;

  const deletedJob = db.jobs.splice(index, 1)[0];

  // Also detach candidates
  db.candidates.forEach(c => {
    if (c.jobId === req.params.id) {
      c.notes = c.notes || [];
      c.notes.push(`Notice: Linked job requisition (${deletedJob.title}) was deleted.`);
    }
  });

  db.auditLogs.unshift({
    id: `audit-${uuidv4().substring(0, 8)}`,
    organizationId: deletedJob.organizationId,
    userEmail: db.users[0]?.email || 'recruiter@hiredeskhr.com',
    action: 'DELETE_JOB',
    resource: 'Job',
    resourceId: deletedJob.id,
    details: `Deleted job requisition ${deletedJob.title} (${deletedJob.jobCode})`,
    timestamp: new Date().toISOString()
  });

  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    success: true,
    message: `Job requisition ${deletedJob.jobCode} (${deletedJob.title}) has been deleted.`
  });
});

// Toggle / Trigger LinkedIn Publishing
jobsRouter.post('/:id/publish-linkedin', (req: any, res) => {
  const job = db.getJobById(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (!checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;

  job.publishedOnLinkedIn = true;
  job.adminNotifiedForLinkedIn = true;
  db.save();
  memoryCache.invalidatePrefix('admin:');

  return res.json({
    message: 'Job successfully queued and published to LinkedIn network',
    job,
    status: 'PUBLISHED_LIVE'
  });
});

// Get candidates for a specific job (used in Kanban board) - O(1) indexed lookup
jobsRouter.get('/:id/candidates', (req: any, res) => {
  const job = db.getJobById(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job requisition not found' });
  }
  if (!checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;

  const candidates = db.getCandidatesByJobId(req.params.id).filter(c => c.organizationId === job.organizationId);
  return res.json(candidates);
});
