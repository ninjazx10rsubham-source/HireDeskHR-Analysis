import { Router } from 'express';
import { db } from '../data/db';
import { googleService } from '../services/googleService';
import { requireAuthenticated } from './auth';
import { checkTenantAccess } from '../middleware/tenantMiddleware';

export const calendarRouter = Router();
calendarRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

/**
 * List all scheduled interviews formatted as calendar events
 */
calendarRouter.get('/events', (req, res) => {
  const orgId = getOrgId(req);
  const interviews = db.interviews.filter(i => i.organizationId === orgId);

  const events = interviews.map(i => {
    const start = new Date(i.scheduledAt);
    const end = new Date(start.getTime() + (i.durationMinutes || 45) * 60000);

    return {
      id: i.id,
      title: `${i.roundName} - ${i.candidateName}`,
      jobTitle: i.jobTitle,
      candidateId: i.candidateId,
      candidateName: i.candidateName,
      candidateEmail: i.candidateEmail,
      interviewerName: i.interviewerName,
      interviewerEmail: i.interviewerEmail,
      start: start.toISOString(),
      end: end.toISOString(),
      durationMinutes: i.durationMinutes,
      meetingUrl: i.meetingUrl,
      status: i.status,
      timezone: i.timezone || 'UTC'
    };
  });

  return res.json({
    success: true,
    count: events.length,
    events
  });
});

/**
 * Download standard RFC 5545 .ics calendar invite for an interview
 */
calendarRouter.get('/invite/:interviewId.ics', (req, res) => {
  const interview = db.interviews.find(i => i.id === req.params.interviewId);
  if (!interview) {
    return res.status(404).send('Interview not found');
  }
  if (!checkTenantAccess(req, res, interview.organizationId, 'interview invite')) return;

  const ics = googleService.generateIcsContent({
    id: interview.id,
    title: `Interview: ${interview.roundName} - ${interview.candidateName} (${interview.jobTitle})`,
    description: `Interview for ${interview.jobTitle} position with ${interview.candidateName}.\nMeeting Link: ${interview.meetingUrl}\nInterviewer: ${interview.interviewerName} (${interview.interviewerEmail})`,
    startTime: interview.scheduledAt,
    durationMinutes: interview.durationMinutes || 45,
    location: interview.meetingUrl,
    organizerName: interview.interviewerName,
    organizerEmail: interview.interviewerEmail,
    attendeeName: interview.candidateName,
    attendeeEmail: interview.candidateEmail,
    timezone: interview.timezone || 'UTC'
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="interview-${interview.id}.ics"`);
  return res.send(ics);
});

/**
 * Get direct Google Calendar Web add URL
 */
calendarRouter.get('/google-url/:interviewId', (req, res) => {
  const interview = db.interviews.find(i => i.id === req.params.interviewId);
  if (!interview) {
    return res.status(404).json({ error: 'Interview not found' });
  }

  const url = googleService.generateGoogleCalendarWebUrl({
    id: interview.id,
    title: `Interview: ${interview.roundName} - ${interview.candidateName} (${interview.jobTitle})`,
    description: `Interview for ${interview.jobTitle} position with ${interview.candidateName}.\nMeeting Link: ${interview.meetingUrl}`,
    startTime: interview.scheduledAt,
    durationMinutes: interview.durationMinutes || 45,
    location: interview.meetingUrl,
    organizerName: interview.interviewerName,
    organizerEmail: interview.interviewerEmail,
    attendeeName: interview.candidateName,
    attendeeEmail: interview.candidateEmail
  });

  return res.json({
    success: true,
    interviewId: interview.id,
    googleCalendarUrl: url
  });
});

/**
 * Calendar status / integration settings
 */
calendarRouter.get('/status', (req, res) => {
  return res.json({
    enabled: true,
    provider: 'Google Calendar & RFC 5545 iCal Engine',
    syncStatus: 'connected',
    timezonesSupported: [
      'UTC',
      'Asia/Kolkata',
      'America/New_York',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Paris',
      'Asia/Dubai',
      'Asia/Singapore',
      'Australia/Sydney'
    ],
    features: [
      'Automatic Google Meet link generation',
      'One-click RFC 5545 .ics invite downloads',
      'Direct Add to Google Calendar URLs',
      'Cross-timezone interview scheduling'
    ]
  });
});
