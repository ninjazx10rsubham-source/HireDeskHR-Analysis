import { Router } from 'express';
import { db } from '../data/db';
import { EmailService, emailConfig } from '../services/emailService';

export const gmailRouter = Router();
const emailService = new EmailService();

/**
 * Get Gmail / Business Mail integration status
 */
gmailRouter.get('/status', (req, res) => {
  return res.json({
    connected: true,
    provider: emailConfig.elasticEmailApiKey ? 'Elastic Email API' : 'Hostinger / SMTP Gateway',
    account: emailConfig.fromEmail,
    recruiterNotificationEmail: emailConfig.recruiterNotificationEmail,
    smtpHost: emailConfig.smtpHost,
    features: [
      'Automated Inbound Resume Ingestion',
      'One-Click Candidate Email Replies',
      'Real-time OTP Dispatch',
      'Interview Calendar Invite Deliveries'
    ]
  });
});

/**
 * Send custom candidate communication via configured email service
 */
gmailRouter.post('/send', async (req, res) => {
  try {
    const { to, subject, html, candidateId, jobId } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, and html are required.' });
    }

    const result = await emailService.sendEmail({
      to,
      subject,
      html
    });

    // Record in email threads if candidate exists
    if (candidateId) {
      const candidate = db.candidates.find(c => c.id === candidateId);
      let thread = db.emailThreads.find(t => t.candidateId === candidateId);
      if (!thread && candidate) {
        thread = {
          id: `thread-${candidateId}`,
          organizationId: candidate.organizationId,
          candidateId: candidate.id,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          candidateEmail: candidate.email,
          jobTitle: 'Candidate Communication',
          subject,
          lastMessageAt: new Date().toISOString(),
          unread: false,
          messages: []
        };
        db.emailThreads.unshift(thread);
      }

      if (thread) {
        thread.messages.push({
          id: `msg-${Date.now()}`,
          sender: 'recruiter',
          senderName: emailConfig.fromName,
          content: html.replace(/<[^>]*>/g, ''),
          timestamp: new Date().toISOString(),
          status: result.success ? 'delivered' : 'sent'
        });
        thread.lastMessageAt = new Date().toISOString();
      }
      db.save();
    }

    return res.json({
      success: result.success,
      provider: result.provider,
      message: result.message
    });
  } catch (err: any) {
    console.error('[Gmail Route] Error sending email:', err);
    return res.status(500).json({ error: 'Failed to dispatch email', details: err.message });
  }
});
