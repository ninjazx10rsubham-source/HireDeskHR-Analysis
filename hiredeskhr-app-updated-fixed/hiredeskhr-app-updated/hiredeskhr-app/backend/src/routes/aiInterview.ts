import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../data/db';
import { store } from '../data/store';
import { aiInterviewService } from '../services/aiService';
import { AiInterviewSession, AiInterviewQuestion } from '../types';
import { requireAuthenticated } from './auth';
import { checkTenantAccess, resolveTargetOrgId } from '../middleware/tenantMiddleware';

export const aiInterviewRouter = Router();

const getOrgId = (req: any): string => {
  return req.currentUser?.organizationId;
};

/**
 * Generate customized AI interview questions for a job requisition
 */
aiInterviewRouter.post('/generate-questions', async (req, res) => {
  try {
    const {
      jobTitle = 'Software Engineer',
      skills = [],
      experienceLevel = 'mid',
      interviewType = 'mixed',
      questionCount = 5
    } = req.body;

    const questions = await aiInterviewService.generateQuestions({
      jobTitle,
      skills: Array.isArray(skills) ? skills : [skills],
      experienceLevel,
      interviewType,
      questionCount: Number(questionCount) || 5
    });

    return res.json({
      success: true,
      jobTitle,
      skills,
      questions
    });
  } catch (err: any) {
    console.error('[AI Interview] Error generating questions:', err);
    return res.status(500).json({ error: 'Failed to generate interview questions', details: err.message });
  }
});

/**
 * List all AI interview sessions
 */
aiInterviewRouter.get('/sessions', requireAuthenticated, (req: any, res) => {
  const orgId = resolveTargetOrgId(req, res, 'ai-sessions');
  if (!orgId) return;
  const sessions = db.aiInterviews.filter(s => s.organizationId === orgId);
  return res.json(sessions);
});

/**
 * Get AI interview session by ID
 */
aiInterviewRouter.get('/sessions/:id', (req, res) => {
  const session = db.aiInterviews.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'AI Interview session not found' });
  }
  return res.json(session);
});

/**
 * Create a new AI Interview session for a candidate
 */
aiInterviewRouter.post('/sessions', requireAuthenticated, async (req: any, res) => {
  try {
    const orgId = getOrgId(req);
    const {
      candidateId,
      jobId,
      interviewType = 'technical',
      difficulty = 'mid',
      durationMinutes = 30,
      customQuestions
    } = req.body;

    const candidate = db.candidates.find(c => c.id === candidateId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    if (!checkTenantAccess(req, res, candidate.organizationId, 'candidate for AI interview')) return;

    const job = db.jobs.find(j => j.id === (jobId || candidate.jobId));
    if (job && !checkTenantAccess(req, res, job.organizationId, 'job requisition')) return;
    const jobTitle = job ? job.title : 'Software Role';
    const skillsToEvaluate = job?.skills?.length ? job.skills : ['Problem Solving', 'Engineering Fundamentals'];

    let questions: AiInterviewQuestion[] = [];
    if (Array.isArray(customQuestions) && customQuestions.length > 0) {
      questions = customQuestions;
    } else {
      questions = await aiInterviewService.generateQuestions({
        jobTitle,
        skills: skillsToEvaluate,
        experienceLevel: difficulty,
        interviewType,
        questionCount: 5
      });
    }

    const newSession: AiInterviewSession = {
      id: `ais-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      jobId: candidate.jobId,
      jobTitle,
      candidateId: candidate.id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      candidateEmail: candidate.email,
      interviewType,
      difficulty,
      durationMinutes: Number(durationMinutes) || 30,
      skillsToEvaluate,
      questions,
      status: 'created',
      createdAt: new Date().toISOString()
    };

    db.aiInterviews.unshift(newSession);

    // Update candidate stage if not already in ai_interview
    if (candidate.stage !== 'ai_interview') {
      candidate.stage = 'ai_interview';
      if (!candidate.notes) candidate.notes = [];
      candidate.notes.push(`AI Interview session scheduled: ${newSession.id} (${newSession.interviewType})`);
      if (!candidate.timeline) candidate.timeline = [];
      candidate.timeline.push({
        event: `Scheduled for AI Interview (${newSession.interviewType})`,
        timestamp: new Date().toISOString(),
        user: 'AI Talent Engine'
      });
    }

    // Add Audit Log
    db.auditLogs.unshift({
      id: `aud-${uuidv4().substring(0, 8)}`,
      organizationId: orgId,
      userEmail: 'system@hiredeskhr.com',
      action: 'AI_INTERVIEW_SCHEDULED',
      resource: 'AiInterviewSession',
      resourceId: newSession.id,
      details: `Scheduled AI Interview for candidate ${candidate.firstName} ${candidate.lastName} (${jobTitle})`,
      timestamp: new Date().toISOString()
    });

    db.save();

    return res.status(201).json({
      success: true,
      message: 'AI Interview session created successfully',
      session: newSession
    });
  } catch (err: any) {
    console.error('[AI Interview] Error creating session:', err);
    return res.status(500).json({ error: 'Failed to create AI interview session', details: err.message });
  }
});

/**
 * Record candidate video consent
 */
aiInterviewRouter.post('/sessions/:id/consent', (req, res) => {
  const session = db.aiInterviews.find(s => s.id === req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { videoConsentGranted = true } = req.body;
  session.videoConsentGranted = Boolean(videoConsentGranted);
  session.status = 'in_progress';
  db.save();

  return res.json({
    success: true,
    message: 'Candidate consent recorded',
    videoConsentGranted: session.videoConsentGranted
  });
});

/**
 * Submit answers for an AI Interview session, evaluate with AI service, and compute final metrics
 */
aiInterviewRouter.post('/sessions/:id/submit', async (req, res) => {
  try {
    const session = db.aiInterviews.find(s => s.id === req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { answers = [], videoRecordingUrl } = req.body;
    // answers format: Array<{ questionId: number, candidateAnswer: string, timeTakenSeconds?: number }>

    if (Array.isArray(answers)) {
      answers.forEach(ans => {
        const targetQ = session.questions.find(q => q.id === ans.questionId);
        if (targetQ) {
          targetQ.candidateAnswer = ans.candidateAnswer || '';
          targetQ.timeTakenSeconds = ans.timeTakenSeconds || 45;

          // Evaluate individual answer
          const evaluation = aiInterviewService.evaluateAnswer({
            question: targetQ,
            candidateAnswer: targetQ.candidateAnswer,
            timeTakenSeconds: targetQ.timeTakenSeconds
          });

          targetQ.score = evaluation.score;
          targetQ.feedback = `${evaluation.feedback} Strengths: ${evaluation.strengths.join(' ')} Improvement: ${evaluation.areasOfImprovement.join(' ')}`;
        }
      });
    }

    if (videoRecordingUrl) {
      session.videoRecordingUrl = videoRecordingUrl;
    }

    // Evaluate overall session
    const overall = aiInterviewService.evaluateSession(session);
    session.totalScore = overall.totalScore;
    session.skillScores = overall.skillScores;
    session.overallRecommendation = overall.overallRecommendation;
    session.aiSummary = overall.aiSummary;
    session.status = 'completed';
    session.completedAt = new Date().toISOString();

    // Update candidate profile match score & scorecard
    const candidate = db.candidates.find(c => c.id === session.candidateId);
    if (candidate) {
      candidate.matchScore = session.totalScore;
      if (!candidate.scorecards) candidate.scorecards = [];
      candidate.scorecards.push({
        id: `sc-ai-${uuidv4().substring(0, 8)}`,
        interviewerName: 'HiredeskHR AI Evaluator',
        technicalRating: Math.min(5, Math.max(1, Math.round(session.totalScore / 20))),
        communicationRating: 4,
        problemSolvingRating: Math.min(5, Math.max(1, Math.round(session.totalScore / 20))),
        cultureFitRating: 4,
        recommendation: session.overallRecommendation === 'STRONG_HIRE' ? 'STRONG_HIRE' :
                        session.overallRecommendation === 'HIRE' ? 'HIRE' :
                        session.overallRecommendation === 'CONSIDER' ? 'MAYBE' : 'NO_HIRE',
        notes: session.aiSummary,
        submittedAt: session.completedAt
      });

      // Advance stage to client_review or shortlisted if score is good
      if (session.totalScore >= 70) {
        candidate.stage = 'client_review';
        if (!candidate.timeline) candidate.timeline = [];
        candidate.timeline.push({
          event: `Passed AI Interview with ${session.totalScore}% -> Advanced to Client Review`,
          timestamp: new Date().toISOString(),
          user: 'HiredeskHR AI'
        });
      }

      // Add in-app notification
      db.notifications.unshift({
        id: `notif-${uuidv4().substring(0, 8)}`,
        organizationId: session.organizationId,
        recipientEmail: 'recruiter@hiredeskhr.com',
        title: `AI Interview Completed: ${candidate.firstName} ${candidate.lastName}`,
        message: `Candidate scored ${session.totalScore}% on ${session.jobTitle} evaluation. Recommendation: ${session.overallRecommendation}.`,
        type: 'ai_interview',
        link: `/candidates/${candidate.id}`,
        read: false,
        createdAt: new Date().toISOString()
      });
    }

    db.save();

    return res.json({
      success: true,
      message: 'AI Interview answers evaluated and scorecard updated successfully',
      session,
      candidateSummary: candidate ? {
        id: candidate.id,
        name: `${candidate.firstName} ${candidate.lastName}`,
        stage: candidate.stage,
        score: candidate.matchScore
      } : null
    });
  } catch (err: any) {
    console.error('[AI Interview] Error evaluating session answers:', err);
    return res.status(500).json({ error: 'Failed to evaluate interview answers', details: err.message });
  }
});
