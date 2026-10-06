import { Router } from 'express';
import { db } from '../data/db';
import { Client } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, isPlatformAdmin, resolveTargetOrgId } from '../middleware/tenantMiddleware';

export const clientsRouter = Router();
clientsRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser?.organizationId;
};

// List all clients for the organization
clientsRouter.get('/', (req: any, res) => {
  const orgId = resolveTargetOrgId(req, res, 'clients');
  if (!orgId) return;
  const search = (req.query.search as string || '').toLowerCase().trim();

  let clients = db.clients.filter(c => c.organizationId === orgId);

  if (search) {
    clients = clients.filter(c =>
      c.companyName.toLowerCase().includes(search) ||
      c.contactPerson.toLowerCase().includes(search) ||
      c.email.toLowerCase().includes(search) ||
      c.industry.toLowerCase().includes(search) ||
      c.country.toLowerCase().includes(search)
    );
  }

  // Enrich with dynamic job & candidate counts
  const enriched = clients.map(c => {
    const clientJobs = db.jobs.filter(j => j.clientId === c.id || j.clientName.toLowerCase() === c.companyName.toLowerCase());
    const jobIds = clientJobs.map(j => j.id);
    const clientCandidates = db.candidates.filter(cand => cand.clientId === c.id || jobIds.includes(cand.jobId));

    return {
      ...c,
      totalJobs: clientJobs.length,
      activeJobs: clientJobs.filter(j => j.status === 'active').length,
      totalCandidates: clientCandidates.length,
      shortlistedCandidates: clientCandidates.filter(cand => ['shortlisted', 'interview', 'ai_interview', 'client_review', 'selected', 'hired'].includes(cand.stage)).length
    };
  });

  return res.json(enriched);
});

// Dedicated Client Portal API (Role: CLIENT data isolation)
// MUST BE REGISTERED BEFORE `/:id` so Express doesn't match 'portal' as an :id!
clientsRouter.get('/portal/me', (req: any, res) => {
  const orgId = getOrgId(req);
  const currentUser = req.currentUser;
  const clientId = currentUser.role === 'CLIENT' ? currentUser.clientId : req.headers['x-client-id'] as string;

  if (!clientId) {
    return res.status(403).json({ error: 'A client profile is required to view the client portal.' });
  }

  const client = db.clients.find(c => c.id === clientId && c.organizationId === orgId);
  if (!client) {
    return res.status(404).json({ error: 'Client profile not found' });
  }

  // ONLY return jobs and candidates belonging to THIS client
  const clientJobs = db.jobs.filter(j => j.clientId === client.id || j.clientName.toLowerCase() === client.companyName.toLowerCase());
  const jobIds = clientJobs.map(j => j.id);
  const clientCandidates = db.candidates.filter(cand => cand.clientId === client.id || jobIds.includes(cand.jobId));
  const clientInterviews = db.interviews.filter(i => jobIds.includes(i.jobId));
  const clientAiInterviews = db.aiInterviews.filter(ai => jobIds.includes(ai.jobId));

  return res.json({
    client,
    jobs: clientJobs,
    candidates: clientCandidates,
    interviews: clientInterviews,
    aiInterviews: clientAiInterviews,
    summary: {
      totalJobs: clientJobs.length,
      activeJobs: clientJobs.filter(j => j.status === 'active').length,
      totalCandidatesReviewed: clientCandidates.length,
      upcomingInterviews: clientInterviews.length
    },
    stats: {
      activeJobsCount: clientJobs.filter(j => j.status === 'active').length,
      totalApplicantsCount: clientCandidates.length,
      shortlistedCount: clientCandidates.filter(c => ['shortlisted', 'interview', 'ai_interview', 'client_review', 'selected', 'hired'].includes(c.stage)).length,
      interviewsCount: clientInterviews.length
    }
  });
});

// Get candidates for a specific job under the client's portal with strict isolation
clientsRouter.get('/portal/me/jobs/:jobId/candidates', (req: any, res) => {
  const orgId = getOrgId(req);
  const currentUser = req.currentUser;
  const clientId = currentUser.role === 'CLIENT' ? currentUser.clientId : req.headers['x-client-id'] as string;
  const { jobId } = req.params;

  if (!clientId) {
    return res.status(403).json({ error: 'A client profile is required.' });
  }

  const client = db.clients.find(c => c.id === clientId && c.organizationId === orgId);
  if (!client) {
    return res.status(404).json({ error: 'Client profile not found.' });
  }

  const job = db.jobs.find(j => (j.id === jobId || j.jobCode === jobId) && j.organizationId === orgId);
  if (!job) {
    return res.status(404).json({ error: 'Job opening not found.' });
  }

  // Ensure this job belongs to the requesting client
  const isOwner = job.clientId === client.id || job.clientName.toLowerCase() === client.companyName.toLowerCase();
  if (currentUser.role === 'CLIENT' && !isOwner) {
    return res.status(403).json({ error: 'Forbidden: You cannot access candidates from a job assigned to another client.' });
  }

  // ONLY return candidates for this exact job ID
  const jobCandidates = db.candidates.filter(c => c.jobId === job.id);
  return res.json({
    job,
    candidates: jobCandidates,
    total: jobCandidates.length
  });
});

// Get single client
clientsRouter.get('/:id', (req: any, res) => {
  const client = db.clients.find(c => c.id === req.params.id);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }
  if (!checkTenantAccess(req, res, client.organizationId, 'client company')) return;

  const clientJobs = db.jobs.filter(j => j.clientId === client.id || j.clientName.toLowerCase() === client.companyName.toLowerCase());
  const jobIds = clientJobs.map(j => j.id);
  const clientCandidates = db.candidates.filter(cand => cand.clientId === client.id || jobIds.includes(cand.jobId));
  const clientInterviews = db.interviews.filter(i => jobIds.includes(i.jobId));

  return res.json({
    ...client,
    jobs: clientJobs,
    candidates: clientCandidates,
    interviews: clientInterviews
  });
});

// Create new client
clientsRouter.post('/', (req, res) => {
  const orgId = getOrgId(req);
  const {
    companyName,
    contactPerson,
    email,
    phone,
    country,
    address,
    website,
    industry,
    notes
  } = req.body;

  if (!companyName || !companyName.trim()) {
    return res.status(400).json({ error: 'Company name is required.' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Contact email is required.' });
  }

  const id = `client-${uuidv4().substring(0, 8)}`;
  const newClient: Client = {
    id,
    organizationId: orgId,
    companyName: companyName.trim(),
    contactPerson: (contactPerson || 'Hiring Lead').trim(),
    email: email.trim().toLowerCase(),
    phone: (phone || '+1 555 0100').trim(),
    country: (country || 'United States').trim(),
    address: (address || 'Global Headquarters').trim(),
    website: (website || '').trim(),
    industry: (industry || 'Technology & Services').trim(),
    notes: (notes || '').trim(),
    createdAt: new Date().toISOString()
  };

  db.clients.unshift(newClient);

  // Add audit log
  db.auditLogs.unshift({
    id: `aud-${uuidv4().substring(0, 8)}`,
    organizationId: orgId,
    userEmail: db.users[0]?.email || 'admin@hiredeskhr.com',
    action: 'CLIENT_CREATED',
    resource: 'Client',
    resourceId: newClient.id,
    details: `Registered new client company: ${newClient.companyName} (${newClient.contactPerson})`,
    timestamp: new Date().toISOString()
  });

  db.save();

  return res.status(201).json({
    message: `Client ${newClient.companyName} registered successfully!`,
    client: newClient
  });
});

// Update client
clientsRouter.put('/:id', (req: any, res) => {
  const existing = db.clients.find(c => c.id === req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Client not found' });
  }
  if (!checkTenantAccess(req, res, existing.organizationId, 'client company')) return;
  const index = db.clients.indexOf(existing);

  const {
    companyName,
    contactPerson,
    email,
    phone,
    country,
    address,
    website,
    industry,
    notes
  } = req.body;

  const updated: Client = {
    ...existing,
    companyName: companyName !== undefined ? companyName.trim() : existing.companyName,
    contactPerson: contactPerson !== undefined ? contactPerson.trim() : existing.contactPerson,
    email: email !== undefined ? email.trim().toLowerCase() : existing.email,
    phone: phone !== undefined ? phone.trim() : existing.phone,
    country: country !== undefined ? country.trim() : existing.country,
    address: address !== undefined ? address.trim() : existing.address,
    website: website !== undefined ? website.trim() : existing.website,
    industry: industry !== undefined ? industry.trim() : existing.industry,
    notes: notes !== undefined ? notes.trim() : existing.notes
  };

  db.clients[index] = updated;
  db.save();

  return res.json({
    message: 'Client profile updated successfully',
    client: updated
  });
});

// Delete client
clientsRouter.delete('/:id', (req: any, res) => {
  const existing = db.clients.find(c => c.id === req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Client not found' });
  }
  if (!checkTenantAccess(req, res, existing.organizationId, 'client company')) return;
  const index = db.clients.indexOf(existing);

  const deleted = db.clients.splice(index, 1)[0];
  db.save();

  return res.json({
    success: true,
    message: `Client ${deleted.companyName} removed from database.`
  });
});
