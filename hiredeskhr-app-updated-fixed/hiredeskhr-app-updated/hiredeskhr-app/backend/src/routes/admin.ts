import { Router } from 'express';
import { db } from '../data/db';
import { Candidate, User } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getAuthenticatedUser } from './auth';
import { memoryCache } from '../services/cacheService';

export const adminRouter = Router();

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

/** Resolves the calling user from the bearer token, same convention as /api/auth/me. */
function getRequestUser(req: any): User | undefined {
  return getAuthenticatedUser(req);
}

/** Only platform-level admin roles may access the Admin Portal. Client users are strictly forbidden. */
function requireAdmin(req: any, res: any, next: any) {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  if (!ADMIN_ROLES.has(user.role)) {
    return res.status(403).json({
      error: 'Forbidden: Client accounts are not authorized to access the Platform Admin Portal.',
      code: 'FORBIDDEN_CLIENT_PORTAL'
    });
  }
  (req as any).currentUser = user;
  next();
}

adminRouter.use(requireAdmin);

// Cross-client overview: for every client in the platform, how many jobs they've
// posted and how many applications each has received, plus platform-wide totals.
// Memoized with high-performance in-memory cache (5s TTL)
adminRouter.get('/overview', async (req, res) => {
  const result = await memoryCache.getOrSet('admin:overview', 5000, async () => {
    const allClients = db.clients;
    const allJobs = db.jobs;
    const allCandidates = db.candidates;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const clientBreakdown = allClients.map(client => {
      const clientJobs = allJobs.filter(
        j => j.clientId === client.id || (client.organizationId && j.organizationId === client.organizationId) || j.clientName.toLowerCase() === client.companyName.toLowerCase()
      );
      const jobIds = clientJobs.map(j => j.id);
      const clientCandidates = allCandidates.filter(
        c => c.clientId === client.id || (client.organizationId && c.organizationId === client.organizationId) || jobIds.includes(c.jobId)
      );

      const shortlisted = clientCandidates.filter(c =>
        ['shortlisted', 'interview', 'ai_interview', 'client_review', 'selected'].includes(c.stage)
      ).length;
      const hired = clientCandidates.filter(c => c.stage === 'hired').length;
      const rejected = clientCandidates.filter(c => c.stage === 'rejected').length;

      const lastJobAt = clientJobs.reduce<string | null>((latest, j) => {
        const t = j.updatedAt || j.createdAt;
        return !latest || t > latest ? t : latest;
      }, null);
      const lastApplicationAt = clientCandidates.reduce<string | null>((latest, c) => {
        const applied = c.appliedAt || c.createdAt;
        return !latest || applied > latest ? applied : latest;
      }, null);
      const lastActivityAt = [lastJobAt, lastApplicationAt].filter(Boolean).sort().reverse()[0] || client.createdAt;

      const org = db.organizations.find(o => o.id === client.organizationId);
      const plan = org?.plan || 'growth';
      const subscriptionStatus = plan === 'free' ? 'Free' : 'Paid';

      const status = (clientJobs.some(j => j.status === 'active') || clientCandidates.length > 0) ? 'Active' : 'Inactive';

      return {
        id: client.id,
        companyName: client.companyName,
        contactPerson: client.contactPerson,
        email: client.email,
        industry: client.industry || 'Technology & Services',
        plan,
        subscriptionStatus: subscriptionStatus as 'Paid' | 'Free',
        status: status as 'Active' | 'Inactive',
        totalJobsPosted: clientJobs.length,
        activeJobs: clientJobs.filter(j => j.status === 'active').length,
        draftJobs: clientJobs.filter(j => j.status === 'draft').length,
        closedJobs: clientJobs.filter(j => j.status === 'closed').length,
        totalApplications: clientCandidates.length,
        shortlisted,
        hired,
        rejected,
        applicationsThisMonth: clientCandidates.filter(c => new Date(c.appliedAt || c.createdAt) >= startOfMonth).length,
        lastActivityAt
      };
    }).sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));

    return {
      summary: {
        totalClients: allClients.length,
        totalJobsPosted: allJobs.length,
        activeJobs: allJobs.filter(j => j.status === 'active').length,
        totalApplications: allCandidates.length,
        applicationsThisMonth: allCandidates.filter(c => new Date(c.appliedAt || c.createdAt) >= startOfMonth).length,
        jobsPostedThisMonth: allJobs.filter(j => new Date(j.createdAt) >= startOfMonth).length,
        hiredTotal: allCandidates.filter(c => c.stage === 'hired').length
      },
      clients: clientBreakdown
    };
  });

  return res.json(result);
});

// Single client drill-down: every job and every applicant for that client.
adminRouter.get('/clients/:id', (req, res) => {
  const client = db.clients.find(c => c.id === req.params.id);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const clientJobs = db.jobs.filter(
    j => j.clientId === client.id || (client.organizationId && j.organizationId === client.organizationId) || j.clientName.toLowerCase() === client.companyName.toLowerCase()
  );
  const jobIds = clientJobs.map(j => j.id);
  const clientCandidates = db.candidates.filter(
    c => c.clientId === client.id || (client.organizationId && c.organizationId === client.organizationId) || jobIds.includes(c.jobId)
  );

  const jobsWithCounts = clientJobs.map(j => ({
    ...j,
    applicantsCount: clientCandidates.filter(c => c.jobId === j.id).length
  }));

  const org = db.organizations.find(o => o.id === client.organizationId);

  return res.json({
    client: {
      ...client,
      plan: org?.plan || 'growth',
      subscriptionStatus: org?.plan === 'free' ? 'Free' : 'Paid'
    },
    jobs: jobsWithCounts,
    candidates: clientCandidates
  });
});

// Recent activity feed for the admin dashboard: job postings, applications,
// and audit-log entries, merged and sorted, most recent first.
adminRouter.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  type ActivityItem = {
    id: string;
    type: 'job_posted' | 'application_received' | 'audit';
    title: string;
    details: string;
    clientName?: string;
    timestamp: string;
  };

  const jobItems: ActivityItem[] = db.jobs
    .map(j => ({
      id: `job-${j.id}`,
      type: 'job_posted',
      title: `Job posted: ${j.title}`,
      details: `${j.clientName} · ${j.jobCode} · ${j.department}`,
      clientName: j.clientName,
      timestamp: j.createdAt
    }));

  const applicationItems: ActivityItem[] = db.candidates
    .map(c => {
      const job = db.jobs.find(j => j.id === c.jobId);
      return {
        id: `cand-${c.id}`,
        type: 'application_received',
        title: `Application received: ${c.firstName} ${c.lastName}`,
        details: job ? `Applied for ${job.title} (${job.clientName})` : `Source: ${c.source}`,
        clientName: job?.clientName,
        timestamp: c.appliedAt || c.createdAt
      };
    });

  const auditItems: ActivityItem[] = db.auditLogs
    .map(a => ({
      id: `audit-${a.id}`,
      type: 'audit',
      title: a.action.replace(/_/g, ' '),
      details: a.details,
      timestamp: a.timestamp
    }));

  const merged = [...jobItems, ...applicationItems, ...auditItems]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, limit);

  return res.json({ activity: merged });
});

// Platform-wide Jobs Overview with indexed applicant counts & optional pagination
adminRouter.get('/jobs', (req, res) => {
  const allJobs = db.jobs.map(j => {
    const client = j.clientId ? db.getClientById(j.clientId) : (j.organizationId ? db.getClientsByOrgId(j.organizationId)[0] : undefined);
    const candidateCount = db.getCandidateCountByJobId(j.id);
    return {
      ...j,
      clientName: j.clientName || client?.companyName || 'HireDeskHR Direct',
      applicantsCount: candidateCount
    };
  });

  const total = allJobs.length;
  res.setHeader('X-Total-Count', String(total));

  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  if (pageParam !== undefined || limitParam !== undefined) {
    const page = Math.max(1, parseInt(pageParam as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam as string, 10) || 20));
    const startIndex = (page - 1) * limit;
    const paginated = allJobs.slice(startIndex, startIndex + limit);
    return res.json({
      jobs: paginated,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  }

  return res.json({ jobs: allJobs });
});

// Platform-wide Applications Overview with indexed lookups & optional pagination
adminRouter.get('/applications', (req, res) => {
  const allCandidates = db.candidates.map(c => {
    const job = db.getJobById(c.jobId);
    const client = c.clientId ? db.getClientById(c.clientId) : (job?.clientId ? db.getClientById(job.clientId) : undefined);
    return {
      ...c,
      jobTitle: job?.title || 'General Pool',
      jobCode: job?.jobCode || '',
      clientName: job?.clientName || client?.companyName || 'HireDeskHR Direct',
      clientId: client?.id || job?.clientId || ''
    };
  });

  const total = allCandidates.length;
  res.setHeader('X-Total-Count', String(total));

  const pageParam = req.query.page;
  const limitParam = req.query.limit;
  if (pageParam !== undefined || limitParam !== undefined) {
    const page = Math.max(1, parseInt(pageParam as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam as string, 10) || 20));
    const startIndex = (page - 1) * limit;
    const paginated = allCandidates.slice(startIndex, startIndex + limit);
    return res.json({
      applications: paginated,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  }

  return res.json({ applications: allCandidates });
});

// Platform-wide Subscriptions Overview (memoized 5s TTL)
adminRouter.get('/subscriptions', async (req, res) => {
  const result = await memoryCache.getOrSet('admin:subscriptions', 5000, async () => {
    const allClients = db.clients;
    const allOrgs = db.organizations;

    const clientSubs = allClients.map(c => {
      const org = allOrgs.find(o => o.id === c.organizationId);
      const plan = org?.plan || 'growth';
      const isPaid = plan !== 'free';
      const price = plan === 'enterprise' ? 14999 : plan === 'growth' ? 4999 : 0;
      return {
        clientId: c.id,
        companyName: c.companyName,
        contactPerson: c.contactPerson,
        email: c.email,
        plan,
        subscriptionStatus: isPaid ? 'Paid' : 'Free',
        status: 'Active',
        monthlyPrice: price,
        memberSince: c.createdAt
      };
    });

    const paidCount = clientSubs.filter(s => s.subscriptionStatus === 'Paid').length;
    const freeCount = clientSubs.filter(s => s.subscriptionStatus === 'Free').length;
    const totalMrr = clientSubs.reduce((acc, s) => acc + s.monthlyPrice, 0);

    return {
      summary: {
        totalClients: clientSubs.length,
        paidSubscriptions: paidCount,
        freeSubscriptions: freeCount,
        totalMrr,
        plans: {
          enterprise: clientSubs.filter(s => s.plan === 'enterprise').length,
          growth: clientSubs.filter(s => s.plan === 'growth').length,
          free: freeCount
        }
      },
      subscriptions: clientSubs
    };
  });

  return res.json(result);
});

// Platform-wide Client Statistics & Analytics (memoized 5s TTL)
adminRouter.get('/statistics', async (req, res) => {
  const result = await memoryCache.getOrSet('admin:statistics', 5000, async () => {
    const allClients = db.clients;
    const allJobs = db.jobs;
    const allCandidates = db.candidates;

    const hiredCount = allCandidates.filter(c => c.stage === 'hired').length;
    const conversionRate = allCandidates.length > 0 ? ((hiredCount / allCandidates.length) * 100).toFixed(1) : '0.0';

    const industryMap: Record<string, number> = {};
    allClients.forEach(c => {
      const ind = c.industry || 'Technology & Services';
      industryMap[ind] = (industryMap[ind] || 0) + 1;
    });

    const clientLeaderboard = allClients.map(c => {
      const jobs = allJobs.filter(j => j.clientId === c.id || j.clientName.toLowerCase() === c.companyName.toLowerCase());
      const jobIds = jobs.map(j => j.id);
      const cands = allCandidates.filter(cand => cand.clientId === c.id || jobIds.includes(cand.jobId));
      return {
        id: c.id,
        companyName: c.companyName,
        jobsCount: jobs.length,
        candidatesCount: cands.length,
        hiredCount: cands.filter(cand => cand.stage === 'hired').length
      };
    }).sort((a, b) => b.candidatesCount - a.candidatesCount);

    return {
      totalClients: allClients.length,
      totalJobs: allJobs.length,
      totalApplications: allCandidates.length,
      totalHired: hiredCount,
      hiringConversionRate: `${conversionRate}%`,
      avgJobsPerClient: (allJobs.length / (allClients.length || 1)).toFixed(1),
      avgApplicationsPerJob: (allCandidates.length / (allJobs.length || 1)).toFixed(1),
      industryBreakdown: industryMap,
      clientLeaderboard
    };
  });

  return res.json(result);
});

// Admin manual candidate & resume assignment to a client's dashboard
adminRouter.post('/candidates', async (req: any, res) => {
  const {
    clientId,
    jobId,
    firstName,
    lastName,
    email,
    phone,
    location,
    country,
    resumeFileName,
    resumeUrl,
    resumeText,
    skills,
    education,
    totalExperience,
    currentCtc,
    expectedCtc,
    noticePeriod,
    stage = 'applied',
    source = 'Admin Received (Email/Direct)',
    notes
  } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: 'Target Client is required.' });
  }
  if (!jobId) {
    return res.status(400).json({ error: 'Target Job requisition is required.' });
  }
  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'Candidate first name, last name, and email are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const targetClient = db.clients.find(c => c.id === clientId);
  if (!targetClient) {
    return res.status(404).json({ error: 'Selected client not found.' });
  }

  const targetJob = db.jobs.find(j => j.id === jobId);
  if (!targetJob) {
    return res.status(404).json({ error: 'Selected job requisition not found.' });
  }

  // Ensure candidate organizationId matches the client's organizationId
  const candidateOrgId = targetClient.organizationId || targetJob.organizationId;

  // Check if candidate with this email already exists under this client
  const existing = db.candidates.find(
    c => c.email.toLowerCase() === cleanEmail && (c.clientId === targetClient.id || c.organizationId === candidateOrgId)
  );
  if (existing) {
    return res.status(409).json({
      error: `Candidate with email ${email} already exists under client ${targetClient.companyName} (${existing.firstName} ${existing.lastName}, Stage: ${existing.stage}).`,
      candidate: existing
    });
  }

  let formattedSkills: string[] = [];
  if (Array.isArray(skills)) {
    formattedSkills = skills.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof skills === 'string') {
    formattedSkills = skills.split(',').map(s => s.trim()).filter(Boolean);
  }

  const candidateCode = db.generateCandidateCode();
  const id = `cand-${uuidv4().substring(0, 8)}`;
  const matchScore = Math.floor(Math.random() * 14) + 85; // 85-98% match

  const newCandidate: Candidate = {
    id,
    candidateCode,
    organizationId: candidateOrgId,
    clientId: targetClient.id,
    jobId: targetJob.id,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: cleanEmail,
    phone: (phone || '+1 555 0100').trim(),
    location: (location || 'Global Remote').trim(),
    country: (country || 'India').trim(),
    resumeFileName: resumeFileName || `${firstName.trim()}_${lastName.trim()}_Resume.pdf`,
    resumeUrl: resumeUrl || `/resumes/${firstName.trim()}_Resume.pdf`,
    resumeText: resumeText || undefined,
    skills: formattedSkills,
    education: education ? education.trim() : undefined,
    currentCtc,
    expectedCtc,
    totalExperience,
    noticePeriod,
    stage: stage as any,
    source: source || 'Admin Received (Email/Direct)',
    matchScore,
    appliedAt: new Date().toISOString(),
    notes: notes ? [notes] : [`Received by Platform Admin and assigned to ${targetClient.companyName} for ${targetJob.title}.`],
    timeline: [
      {
        event: `Candidate profile created and assigned to ${targetClient.companyName} by Platform Admin`,
        timestamp: new Date().toISOString(),
        user: req.currentUser.name || 'Platform Admin'
      }
    ]
  };

  db.candidates.unshift(newCandidate);

  // Update target job count
  targetJob.applicantsCount = db.candidates.filter(c => c.jobId === targetJob.id).length;

  // Record audit log
  db.auditLogs.unshift({
    id: `audit-${uuidv4().substring(0, 8)}`,
    organizationId: candidateOrgId,
    userEmail: req.currentUser.email || 'admin@hiredeskhr.com',
    action: 'ADMIN_ASSIGN_CANDIDATE',
    resource: 'Candidate',
    resourceId: newCandidate.id,
    details: `Admin assigned candidate ${newCandidate.firstName} ${newCandidate.lastName} to client ${targetClient.companyName} for job ${targetJob.title} (${targetJob.jobCode})`,
    timestamp: new Date().toISOString()
  });

  db.save();
  memoryCache.invalidatePrefix('admin:');

  console.log(`✅ [ADMIN] Assigned candidate ${newCandidate.candidateCode} to client ${targetClient.companyName} for job ${targetJob.jobCode}`);

  return res.status(201).json({
    message: `Candidate ${newCandidate.firstName} ${newCandidate.lastName} successfully assigned to ${targetClient.companyName}!`,
    candidate: newCandidate
  });
});


