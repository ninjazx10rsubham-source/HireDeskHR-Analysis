import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../data/db';
import { FeedbackSubmission, FeedbackType, FeedbackStatus, User } from '../types';
import { getAuthenticatedUser } from './auth';

export const feedbackRouter = Router();

const VALID_TYPES: FeedbackType[] = ['Report an Issue', 'Request a Feature', 'Other Feedback'];
const VALID_STATUSES: FeedbackStatus[] = ['New', 'In Review', 'In Progress', 'Resolved', 'Closed'];

/**
 * Middleware: Verify that the caller is a Platform Admin (ADMIN or SUPER_ADMIN).
 * Clients, candidates, or unauthenticated users will be denied.
 */
function requirePlatformAdmin(req: any, res: any, next: any) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      error: 'Forbidden: Platform Admin access required.',
      code: 'FORBIDDEN_NOT_ADMIN'
    });
  }
  req.currentUser = user;
  next();
}

/**
 * POST /api/feedback
 * Public submission endpoint for users, visitors, or clients to report an issue or request a feature.
 * Protected against spam / rapid duplicate submissions.
 */
feedbackRouter.post('/', (req, res) => {
  const { name, email, type, subject, description, attachmentUrl, attachmentName } = req.body || {};

  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const rawType = String(type || '').trim();
  const cleanSubject = String(subject || '').trim();
  const cleanDescription = String(description || '').trim();

  // Basic validation
  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Please enter your name.', field: 'name' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
  }

  const feedbackType: FeedbackType = VALID_TYPES.includes(rawType as FeedbackType)
    ? (rawType as FeedbackType)
    : 'Report an Issue';

  if (!cleanSubject || cleanSubject.length < 2) {
    return res.status(400).json({ error: 'Please enter a subject.', field: 'subject' });
  }

  if (!cleanDescription || cleanDescription.length < 5) {
    return res.status(400).json({ error: 'Please provide a detailed description (at least 5 characters).', field: 'description' });
  }

  // Prevent rapid duplicate submissions within 60 seconds
  const now = Date.now();
  const isDuplicate = db.feedback.some(item => {
    if (item.email.toLowerCase() === cleanEmail && item.subject.toLowerCase() === cleanSubject.toLowerCase()) {
      const itemTime = new Date(item.submittedAt).getTime();
      return (now - itemTime) < 60_000;
    }
    return false;
  });

  if (isDuplicate) {
    return res.status(429).json({
      error: 'A duplicate request was recently submitted from this email. Please wait a moment before submitting again.',
      code: 'DUPLICATE_SUBMISSION'
    });
  }

  const submissionId = `fb-${uuidv4().substring(0, 8)}`;
  const submission: FeedbackSubmission = {
    id: submissionId,
    name: cleanName,
    email: cleanEmail,
    type: feedbackType,
    subject: cleanSubject,
    description: cleanDescription,
    attachmentUrl: attachmentUrl ? String(attachmentUrl).trim() : undefined,
    attachmentName: attachmentName ? String(attachmentName).trim() : undefined,
    submittedAt: new Date().toISOString(),
    status: 'New',
    ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || undefined
  };

  db.feedback.unshift(submission);
  db.save(true);

  console.log(`[FEEDBACK SUBMITTED] ID: ${submission.id} | Type: ${submission.type} | By: ${submission.email}`);

  return res.status(201).json({
    success: true,
    message: 'Thank you! Your request has been submitted successfully. Our team will review it.',
    id: submission.id,
    submission
  });
});

/**
 * GET /api/feedback
 * Admin-only: Retrieve all feedback & feature requests.
 */
feedbackRouter.get('/', requirePlatformAdmin, (req, res) => {
  const { type, status, search } = req.query as Record<string, string>;

  let list = [...db.feedback];

  if (type && type !== 'all') {
    list = list.filter(item => item.type.toLowerCase() === type.toLowerCase());
  }

  if (status && status !== 'all') {
    list = list.filter(item => item.status.toLowerCase() === status.toLowerCase());
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(item =>
      item.id.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.email.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  }

  return res.json({
    success: true,
    count: list.length,
    feedback: list
  });
});

/**
 * PATCH /api/feedback/:id/status
 * Admin-only: Update status and/or admin notes for a feedback submission.
 */
feedbackRouter.patch('/:id/status', requirePlatformAdmin, (req, res) => {
  const { id } = req.params;
  const { status, adminNotes } = req.body || {};

  const submission = db.getFeedbackById(id) || db.feedback.find(item => item.id === id);
  if (!submission) {
    return res.status(404).json({ error: 'Feedback submission not found.' });
  }

  if (status) {
    if (!VALID_STATUSES.includes(status as FeedbackStatus)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
        field: 'status'
      });
    }
    submission.status = status as FeedbackStatus;
  }

  if (adminNotes !== undefined) {
    submission.adminNotes = String(adminNotes).trim();
  }

  db.save(true);

  console.log(`[FEEDBACK STATUS UPDATED] ID: ${submission.id} | Status: ${submission.status}`);

  return res.json({
    success: true,
    message: 'Feedback status updated successfully.',
    submission
  });
});
