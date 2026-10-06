import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../data/db';
import { EmailService } from '../services/emailService';
import { requireAuthenticated } from './auth';

export const campaignsRouter = Router();
campaignsRouter.use(requireAuthenticated);

const emailService = new EmailService();

campaignsRouter.get('/recipients', (req: any, res) => {
  const recipients = db.candidates
    .filter(candidate => candidate.organizationId === req.currentUser.organizationId && candidate.email)
    .map(candidate => ({
      id: candidate.id,
      name: `${candidate.firstName} ${candidate.lastName}`,
      email: candidate.email,
      source: 'candidate'
    }));
  return res.json({ recipients });
});

campaignsRouter.get('/', (req: any, res) => {
  return res.json(db.emailCampaigns.filter(campaign => campaign.organizationId === req.currentUser.organizationId));
});

campaignsRouter.post('/', (req: any, res) => {
  const { name, subject, content } = req.body;
  if (!String(name || '').trim() || !String(subject || '').trim() || !String(content || '').trim()) {
    return res.status(400).json({ error: 'Campaign name, subject, and content are required.' });
  }

  const recipientCount = db.candidates.filter(candidate =>
    candidate.organizationId === req.currentUser.organizationId && Boolean(candidate.email)
  ).length;
  const campaign = {
    id: `campaign-${uuidv4().substring(0, 8)}`,
    organizationId: req.currentUser.organizationId,
    name: String(name).trim(),
    subject: String(subject).trim(),
    content: String(content).trim(),
    recipientCount,
    sentCount: 0,
    status: 'draft' as const,
    createdAt: new Date().toISOString()
  };
  db.emailCampaigns.unshift(campaign);
  db.save();
  return res.status(201).json(campaign);
});

campaignsRouter.post('/:id/send', async (req: any, res) => {
  const campaign = db.emailCampaigns.find(item =>
    item.id === req.params.id && item.organizationId === req.currentUser.organizationId
  );
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (campaign.status === 'sending') return res.status(409).json({ error: 'Campaign is already sending.' });

  const recipients = db.candidates.filter(candidate =>
    candidate.organizationId === req.currentUser.organizationId && Boolean(candidate.email)
  );
  campaign.status = 'sending';
  db.save();

  let sentCount = 0;
  for (const recipient of recipients) {
    const result = await emailService.sendEmail({
      to: recipient.email,
      subject: campaign.subject,
      text: campaign.content,
      html: `<p>${campaign.content.replace(/\n/g, '<br />')}</p>`
    });
    if (result.success) sentCount++;
  }

  campaign.sentCount = sentCount;
  campaign.status = sentCount === recipients.length ? 'sent' : 'failed';
  campaign.sentAt = new Date().toISOString();
  db.save();
  return res.json(campaign);
});