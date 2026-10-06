import { loadEnv } from './config/loadEnv';
const loadedEnvFiles = loadEnv();

import path from 'path';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { jobsRouter } from './routes/jobs';
import { candidatesRouter } from './routes/candidates';
import { interviewsRouter } from './routes/interviews';
import { emailsRouter } from './routes/emails';
import { analyticsRouter } from './routes/analytics';
import { publicCareerRouter } from './routes/publicCareer';
import { settingsRouter } from './routes/settings';
import { emailAutomationRouter } from './routes/emailAutomation';
import { clientsRouter } from './routes/clients';
import { aiInterviewRouter } from './routes/aiInterview';
import { calendarRouter } from './routes/calendar';
import { gmailRouter } from './routes/gmail';
import { notificationsRouter } from './routes/notifications';
import { uploadRouter } from './routes/upload';
import { adminRouter } from './routes/admin';
import { campaignsRouter } from './routes/campaigns';
import { feedbackRouter } from './routes/feedback';

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-user-role', 'x-client-id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Concurrency & Rate Limiting Middleware
import { generalRateLimiter } from './middleware/rateLimiter';
app.use(generalRateLimiter);

// Secure Resumes: Block unauthenticated direct access to /uploads/resumes
import { getAuthenticatedUser } from './routes/auth';
import { db } from './data/db';

app.use('/uploads/resumes', (req, res, next) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required to access candidate resumes.' });
  }

  const fileName = path.basename(req.path);
  const candidate = db.candidates.find(c => 
    (c.resumeUrl && c.resumeUrl.includes(fileName)) || 
    (c.resumeFileName && c.resumeFileName === fileName)
  );

  if (candidate && user.role === 'CLIENT') {
    const job = db.getJobById(candidate.jobId);
    const belongs = candidate.clientId === user.clientId || job?.clientId === user.clientId;
    if (!belongs) {
      return res.status(403).json({ error: 'Forbidden: You cannot access resumes belonging to another client.' });
    }
  }

  next();
});

// Static directory for uploaded/simulated assets
const uploadsDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    platform: 'HiredeskHR API Engine',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Mount Routes
app.use('/api/auth', authRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/candidates', candidatesRouter);
app.use('/api/interviews', interviewsRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/career', publicCareerRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/automation', emailAutomationRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/ai-interview', aiInterviewRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/admin', adminRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/feedback', feedbackRouter);

// Serve frontend production build if available
import fs from 'fs';
const frontendDistCandidates = [
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(__dirname, '../frontend/dist'),
  path.resolve(process.cwd(), 'frontend/dist')
];
const distDir = frontendDistCandidates.find(d => fs.existsSync(d));
if (distDir) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[API Error]', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred'
  });
});

app.listen(PORT, () => {
  const { resolveEmailCreds } = require('./services/emailService');
  const { resolveWaCreds } = require('./services/whatsappService');
  const mail = resolveEmailCreds();
  const wa = resolveWaCreds();

  console.log(`\n======================================================`);
  console.log(`🚀 HiredeskHR Backend Running on http://localhost:${PORT}`);
  console.log(`🗂  Env files loaded: ${loadedEnvFiles.length ? loadedEnvFiles.join(', ') : 'NONE (no .env found!)'}`);
  console.log(`📧 Email OTP: ${mail.anyConfigured ? `READY via ${mail.smtpConfigured ? `SMTP (${mail.smtpUser})` : 'Elastic Email'}` : 'NOT CONFIGURED -> run "npm run setup:otp"'}`);
  console.log(`📱 WhatsApp OTP: ${wa.anyConfigured ? `READY via ${wa.metaConfigured ? 'Meta Cloud API' : 'UltraMsg'}${wa.metaConfigured && !wa.otpTemplate ? ' (no template set - only works inside a 24h session)' : ''}` : 'NOT CONFIGURED -> run "npm run setup:otp"'}`);
  console.log(`🔎 Delivery diagnostics: http://localhost:${PORT}/api/auth/delivery-status?verify=true`);
  console.log(`📌 Public Career Pages API: http://localhost:${PORT}/api/career/:orgSlug`);
  console.log(`💼 Recruiter Dashboard API: http://localhost:${PORT}/api/analytics`);
  console.log(`🏢 Client Portal API: http://localhost:${PORT}/api/clients/portal/me`);
  console.log(`🤖 AI Interview API: http://localhost:${PORT}/api/ai-interview`);
  console.log(`📅 Calendar & iCal API: http://localhost:${PORT}/api/calendar`);
  console.log(`📬 Inbound Email Webhook: http://localhost:${PORT}/api/automation/inbound-email`);
  console.log(`======================================================\n`);
});
