import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../data/db';
import { Interview, CandidateScorecard } from '../types';
import { googleService } from '../services/googleService';
import { EmailService, emailConfig } from '../services/emailService';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, isPlatformAdmin, resolveTargetOrgId } from '../middleware/tenantMiddleware';

export const interviewsRouter = Router();
interviewsRouter.use(requireAuthenticated);
const emailService = new EmailService();

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

// List interviews
interviewsRouter.get('/', (req: any, res) => {
  const targetOrgId = resolveTargetOrgId(req, res, 'interviews');
  if (!targetOrgId) return;
  const interviews = db.interviews.filter(i => i.organizationId === targetOrgId);
  return res.json(interviews);
});

// Get single interview
interviewsRouter.get('/:id', (req: any, res) => {
  const interview = db.interviews.find(i => i.id === req.params.id);
  if (!interview) {
    return res.status(404).json({ error: 'Interview not found' });
  }
  if (!checkTenantAccess(req, res, interview.organizationId, 'interview session')) return;
  return res.json(interview);
});

// Schedule new interview
interviewsRouter.post('/', async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      candidateId,
      jobId,
      roundName,
      scheduledAt,
      durationMinutes = 45,
      timezone = 'UTC',
      interviewerName,
      interviewerEmail,
      meetingUrl,
      description
    } = req.body;

    const candidate = db.candidates.find(c => c.id === candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate for interview')) return;

    const job = db.jobs.find(j => j.id === (jobId || candidate.jobId));
    if (job && !checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;
    const jobTitle = job ? job.title : 'Software Role';

    const authenticatedUser = req.currentUser;
    const loggedInRecruiterEmail = authenticatedUser?.email;
    const effectiveRecruiterEmail = (req.body.recruiterEmail || loggedInRecruiterEmail || req.body.interviewerEmail || '').trim();
    const effectiveInterviewerName = (interviewerName || req.body.recruiterName || authenticatedUser?.name || 'Recruiter').trim();
    const effectiveInterviewerEmail = effectiveRecruiterEmail || db.users[0]?.email || emailConfig.fromEmail;
    const effectiveMeetingUrl = meetingUrl || googleService.generateGoogleMeetLink();
    const effectiveScheduledAt = scheduledAt || new Date(Date.now() + 2 * 86400000).toISOString();

    const newInterview: Interview = {
      id: `int-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      jobId: candidate.jobId,
      jobTitle,
      candidateId: candidate.id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      candidateEmail: candidate.email,
      roundName: roundName || 'Technical Round 1',
      interviewerName: effectiveInterviewerName,
      interviewerEmail: effectiveInterviewerEmail,
      recruiterEmail: effectiveRecruiterEmail,
      scheduledAt: effectiveScheduledAt,
      durationMinutes: Number(durationMinutes) || 45,
      timezone,
      description: description || `Technical interview discussion for ${jobTitle}`,
      meetingUrl: effectiveMeetingUrl,
      status: 'scheduled'
    };

    db.interviews.unshift(newInterview);

    // Advance candidate to 'interview' stage
    candidate.stage = 'interview';
    if (!candidate.notes) candidate.notes = [];
    candidate.notes.push(
      `Interview scheduled: ${newInterview.roundName} with ${newInterview.interviewerName} on ${new Date(newInterview.scheduledAt).toLocaleString()} (${timezone})`
    );

    if (!candidate.timeline) candidate.timeline = [];
    candidate.timeline.push({
      event: `Interview scheduled: ${newInterview.roundName} with ${newInterview.interviewerName}`,
      timestamp: new Date().toISOString(),
      user: effectiveInterviewerName
    });

    // Create / update email thread with interview invitation
    let thread = db.emailThreads.find(t => t.candidateId === candidate.id);
    const inviteHtml = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0d9488;">Interview Confirmation: ${newInterview.roundName}</h2>
        <p>Dear ${candidate.firstName},</p>
        <p>We are pleased to invite you to an interview for the <strong>${jobTitle}</strong> position.</p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="margin: 4px 0;">📅 <strong>Date & Time:</strong> ${new Date(newInterview.scheduledAt).toUTCString()} (${timezone})</p>
          <p style="margin: 4px 0;">⏱️ <strong>Duration:</strong> ${newInterview.durationMinutes} Minutes</p>
          <p style="margin: 4px 0;">👤 <strong>Interviewer:</strong> ${newInterview.interviewerName} (${newInterview.interviewerEmail})</p>
          <p style="margin: 4px 0;">🔗 <strong>Video Meeting Link:</strong> <a href="${newInterview.meetingUrl}" style="color: #0d9488;">${newInterview.meetingUrl}</a></p>
        </div>
        <p>An iCalendar (.ics) invite has also been linked. Please confirm your attendance by replying to this email.</p>
        <p>Best regards,<br/>Talent Acquisition Team</p>
      </div>
    `;

    const inviteText = `Hi ${candidate.firstName},\n\nWe have scheduled your ${newInterview.roundName} for ${jobTitle}.\n\n📅 Date & Time: ${new Date(newInterview.scheduledAt).toLocaleString()} (${timezone})\n🔗 Meeting Link: ${newInterview.meetingUrl}\n👤 Interviewer: ${newInterview.interviewerName}\n\nPlease confirm your availability.\n\nBest regards,\nTalent Acquisition`;

    if (thread) {
      thread.messages.push({
        id: `msg-${uuidv4().substring(0, 6)}`,
        sender: 'recruiter',
        senderName: newInterview.interviewerName,
        content: inviteText,
        timestamp: new Date().toISOString(),
        status: 'sent'
      });
      thread.lastMessageAt = new Date().toISOString();
    } else {
      db.emailThreads.unshift({
        id: `thread-${candidate.id}`,
        organizationId: orgId,
        candidateId: candidate.id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        candidateEmail: candidate.email,
        jobTitle,
        subject: `Interview Invitation: ${newInterview.roundName} for ${jobTitle}`,
        lastMessageAt: new Date().toISOString(),
        unread: false,
        messages: [
          {
            id: `msg-${uuidv4().substring(0, 6)}`,
            sender: 'recruiter',
            senderName: newInterview.interviewerName,
            content: inviteText,
            timestamp: new Date().toISOString(),
            status: 'sent'
          }
        ]
      });
    }

    // In-app notification
    db.notifications.unshift({
      id: `notif-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      recipientEmail: effectiveInterviewerEmail,
      title: `Interview Scheduled: ${candidate.firstName} ${candidate.lastName}`,
      message: `${newInterview.roundName} scheduled for ${new Date(newInterview.scheduledAt).toLocaleString()}`,
      type: 'interview',
      link: `/interviews`,
      read: false,
      createdAt: new Date().toISOString()
    });

    // Audit log
    db.auditLogs.unshift({
      id: `aud-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      userEmail: effectiveInterviewerEmail,
      action: 'INTERVIEW_SCHEDULED',
      resource: 'Interview',
      resourceId: newInterview.id,
      details: `Scheduled ${newInterview.roundName} with ${candidate.firstName} ${candidate.lastName} on ${newInterview.scheduledAt}`,
      timestamp: new Date().toISOString()
    });

    // Dispatch real email invite to Candidate (with Recruiter CC)
    emailService.sendEmail({
      to: candidate.email,
      cc: effectiveRecruiterEmail ? [effectiveRecruiterEmail] : undefined,
      subject: `Interview Invitation: ${newInterview.roundName} for ${jobTitle}`,
      html: inviteHtml,
      text: inviteText
    }).catch(err => console.error('[Interview Route] Failed to send candidate email invite:', err.message));

    // Also dispatch direct confirmation copy to Recruiter email from authenticated account
    if (effectiveRecruiterEmail && effectiveRecruiterEmail.toLowerCase() !== candidate.email.toLowerCase()) {
      const recruiterHtml = `
        <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">
          <h2 style="color: #0d9488;">Interview Scheduled: ${newInterview.roundName}</h2>
          <p>Hello <strong>${newInterview.interviewerName}</strong>,</p>
          <p>You have scheduled an interview for candidate <strong>${candidate.firstName} ${candidate.lastName}</strong> for the <strong>${jobTitle}</strong> position.</p>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="margin: 4px 0;">👤 <strong>Candidate:</strong> ${candidate.firstName} ${candidate.lastName} (${candidate.email})</p>
            <p style="margin: 4px 0;">💼 <strong>Job Position:</strong> ${jobTitle}</p>
            <p style="margin: 4px 0;">📅 <strong>Date & Time:</strong> ${new Date(newInterview.scheduledAt).toUTCString()} (${timezone})</p>
            <p style="margin: 4px 0;">⏱️ <strong>Duration:</strong> ${newInterview.durationMinutes} Minutes</p>
            <p style="margin: 4px 0;">🔗 <strong>Video Meeting Link:</strong> <a href="${newInterview.meetingUrl}" style="color: #0d9488;">${newInterview.meetingUrl}</a></p>
          </div>
          <p>The candidate has also received their interview invitation.</p>
          <p>Best regards,<br/>HireDeskHR Interview System</p>
        </div>
      `;
      const recruiterText = `Hello ${newInterview.interviewerName},\n\nInterview scheduled for ${candidate.firstName} ${candidate.lastName} (${jobTitle}).\n\n📅 Date & Time: ${new Date(newInterview.scheduledAt).toLocaleString()} (${timezone})\n🔗 Meeting Link: ${newInterview.meetingUrl}\n👤 Candidate Email: ${candidate.email}\n\nHireDeskHR System`;

      emailService.sendEmail({
        to: effectiveRecruiterEmail,
        subject: `[Recruiter Copy] Interview Scheduled: ${candidate.firstName} ${candidate.lastName} - ${newInterview.roundName} (${jobTitle})`,
        html: recruiterHtml,
        text: recruiterText
      }).catch(err => console.error('[Interview Route] Failed to send recruiter email copy:', err.message));
    }

    db.save();

    return res.status(201).json({
      success: true,
      message: 'Interview successfully scheduled and calendar invite sent',
      interview: newInterview,
      calendarInviteUrl: `/api/calendar/invite/${newInterview.id}.ics`
    });
  } catch (err: any) {
    console.error('[Interviews Route] Error scheduling interview:', err);
    return res.status(500).json({ error: 'Failed to schedule interview', details: err.message });
  }
});

// Submit Scorecard
interviewsRouter.post('/:id/scorecard', (req: any, res) => {
  const interview = db.interviews.find(i => i.id === req.params.id);
  if (!interview) {
    return res.status(404).json({ error: 'Interview not found' });
  }
  if (!checkTenantAccess(req, res, interview.organizationId, 'interview scorecard')) return;

  const {
    technicalRating,
    communicationRating,
    problemSolvingRating,
    cultureFitRating,
    recommendation,
    notes,
    interviewerName
  } = req.body;

  const scorecard: CandidateScorecard = {
    id: `sc-${uuidv4().substring(0, 8)}`,
    interviewerName: interviewerName || interview.interviewerName,
    technicalRating: Number(technicalRating) || 4,
    communicationRating: Number(communicationRating) || 4,
    problemSolvingRating: Number(problemSolvingRating) || 4,
    cultureFitRating: Number(cultureFitRating) || 5,
    recommendation: recommendation || 'HIRE',
    notes: notes || 'Candidate showed strong technical depth and clarity.',
    submittedAt: new Date().toISOString()
  };

  interview.scorecard = scorecard;
  interview.status = 'completed';

  // Also associate with candidate profile
  const candidate = db.candidates.find(c => c.id === interview.candidateId);
  if (candidate) {
    if (!candidate.scorecards) candidate.scorecards = [];
    candidate.scorecards.push(scorecard);
    if (!candidate.timeline) candidate.timeline = [];
    candidate.timeline.push({
      event: `Scorecard submitted by ${scorecard.interviewerName}: Recommendation ${scorecard.recommendation}`,
      timestamp: new Date().toISOString(),
      user: scorecard.interviewerName
    });

    if (scorecard.recommendation === 'STRONG_HIRE' || scorecard.recommendation === 'HIRE') {
      candidate.stage = 'selected';
    }
  }

  db.save();

  return res.json({
    success: true,
    message: 'Scorecard recorded successfully',
    interview
  });
});

// Cancel Interview
interviewsRouter.delete('/:id', (req: any, res) => {
  const interview = db.interviews.find(i => i.id === req.params.id);
  if (!interview) {
    return res.status(404).json({ error: 'Interview not found' });
  }
  if (!checkTenantAccess(req, res, interview.organizationId, 'interview session')) return;

  interview.status = 'cancelled';
  db.save();
  return res.json({ success: true, message: 'Interview cancelled', interview });
});
