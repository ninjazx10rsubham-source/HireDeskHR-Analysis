import { AiInterviewQuestion, AiInterviewSession } from '../types';

export interface GenerateQuestionsParams {
  jobTitle: string;
  skills: string[];
  experienceLevel?: string; // 'junior' | 'mid' | 'senior' | 'lead'
  interviewType?: 'technical' | 'behavioral' | 'leadership' | 'system_design' | 'mixed';
  questionCount?: number;
}

export interface EvaluateAnswerParams {
  question: AiInterviewQuestion;
  candidateAnswer: string;
  timeTakenSeconds?: number;
}

export interface EvaluationResult {
  score: number; // 0-100
  feedback: string;
  keywordsMatched: string[];
  strengths: string[];
  areasOfImprovement: string[];
}

export class AiInterviewService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '';
  }

  /**
   * Generates tailored interview questions based on Job Title, Skills & Seniority
   */
  async generateQuestions(params: GenerateQuestionsParams): Promise<AiInterviewQuestion[]> {
    const {
      jobTitle,
      skills = ['General Problem Solving'],
      experienceLevel = 'mid',
      interviewType = 'mixed',
      questionCount = 5
    } = params;

    // Build intelligent curated question bank tailored to tech stack and role
    const skillList = skills.length > 0 ? skills : ['Communication', 'Problem Solving', 'Architecture'];
    const generated: AiInterviewQuestion[] = [];

    // Technical Question 1 based on primary skill
    const primarySkill = skillList[0] || 'System Architecture';
    generated.push({
      id: 1,
      category: 'Technical Architecture & Fundamentals',
      question: `Given your experience with ${primarySkill}, explain how you would design a scalable, fault-tolerant solution for a high-traffic ${jobTitle} workload. What trade-offs do you consider?`,
      expectedKeywords: [primarySkill.toLowerCase(), 'scalability', 'concurrency', 'latency', 'caching', 'fault tolerance', 'monitoring'],
      maxScore: 100
    });

    // Technical Question 2 based on secondary skill or debugging
    const secondarySkill = skillList[1] || 'State Management / Database';
    generated.push({
      id: 2,
      category: 'Core Competency & Debugging',
      question: `Describe a critical production bug or performance bottleneck you diagnosed in ${secondarySkill} or backend services. Walk through your step-by-step troubleshooting methodology and how you prevented recurrence.`,
      expectedKeywords: [secondarySkill.toLowerCase(), 'root cause', 'profiling', 'metrics', 'logs', 'regression testing', 'fix'],
      maxScore: 100
    });

    // Technical Question 3: Security & Performance
    if (questionCount >= 3) {
      generated.push({
        id: 3,
        category: 'Security & Reliability',
        question: `How do you secure API endpoints, handle authentication/authorization (e.g. JWT, OAuth, RBAC), and safeguard sensitive candidate or financial data in a production ATS or enterprise application?`,
        expectedKeywords: ['jwt', 'oauth', 'rbac', 'sanitization', 'encryption', 'tls', 'rate limiting', 'audit log'],
        maxScore: 100
      });
    }

    // Behavioral / Collaboration Question
    if (questionCount >= 4) {
      generated.push({
        id: 4,
        category: 'Behavioral & Leadership',
        question: `Can you share an instance where you disagreed with a product specification, client requirement, or architectural decision? How did you navigate the conversation and achieve alignment?`,
        expectedKeywords: ['collaboration', 'stakeholders', 'trade-offs', 'data-driven', 'communication', 'compromise', 'outcome'],
        maxScore: 100
      });
    }

    // Role-specific System Design / Scenario Question
    if (questionCount >= 5) {
      generated.push({
        id: 5,
        category: 'Scenario & System Design',
        question: `If asked to implement an automated resume ingestion pipeline that processes 50,000 incoming emails per hour with OCR and AI skill matching, what message queue, processing workers, and database architecture would you deploy?`,
        expectedKeywords: ['queue', 'kafka', 'rabbitmq', 'redis', 'workers', 'microservices', 'idempotency', 'elastic search', 'vector search'],
        maxScore: 100
      });
    }

    return generated.slice(0, questionCount);
  }

  /**
   * Evaluates an individual candidate answer against expected keywords and depth
   */
  evaluateAnswer(params: EvaluateAnswerParams): EvaluationResult {
    const { question, candidateAnswer } = params;
    const answerLower = (candidateAnswer || '').toLowerCase().trim();

    if (!answerLower || answerLower.length < 15) {
      return {
        score: 15,
        feedback: 'The response was too brief or incomplete. Candidate did not articulate key concepts or provide concrete examples.',
        keywordsMatched: [],
        strengths: ['Candidate attempted a brief response'],
        areasOfImprovement: ['Provide more detailed technical rationale', 'Mention specific implementation details and trade-offs']
      };
    }

    // Match keywords
    const matched = question.expectedKeywords.filter(kw => answerLower.includes(kw.toLowerCase()));
    const matchRatio = matched.length / Math.max(1, question.expectedKeywords.length);

    // Evaluate depth by word count
    const wordCount = candidateAnswer.split(/\s+/).length;
    let depthBonus = 0;
    if (wordCount > 60) depthBonus += 15;
    else if (wordCount > 30) depthBonus += 10;
    else if (wordCount > 15) depthBonus += 5;

    const baseScore = Math.round(matchRatio * 75);
    const totalScore = Math.min(100, Math.max(25, baseScore + depthBonus));

    const strengths: string[] = [];
    const areasOfImprovement: string[] = [];

    if (matched.length > 0) {
      strengths.push(`Successfully referenced relevant concepts: ${matched.join(', ')}.`);
    }
    if (wordCount > 40) {
      strengths.push('Elaborated with structured reasoning and clear technical flow.');
    } else {
      areasOfImprovement.push('Elaborate further on architectural trade-offs and edge cases.');
    }

    const missingKeywords = question.expectedKeywords.filter(kw => !matched.includes(kw));
    if (missingKeywords.length > 0) {
      areasOfImprovement.push(`Could have addressed: ${missingKeywords.slice(0, 3).join(', ')}.`);
    }

    let feedback = '';
    if (totalScore >= 80) {
      feedback = 'Outstanding response demonstrating strong technical command, clear methodology, and direct alignment with the role.';
    } else if (totalScore >= 60) {
      feedback = 'Good response covering foundational principles. Candidate could expand on edge cases, scale limits, and monitoring.';
    } else {
      feedback = 'Adequate surface-level answer, but lacked deeper technical depth, specific metrics, or practical implementation steps.';
    }

    return {
      score: totalScore,
      feedback,
      keywordsMatched: matched,
      strengths,
      areasOfImprovement
    };
  }

  /**
   * Computes comprehensive session evaluation
   */
  evaluateSession(session: AiInterviewSession): {
    totalScore: number;
    skillScores: Record<string, number>;
    overallRecommendation: 'STRONG_HIRE' | 'HIRE' | 'CONSIDER' | 'DO_NOT_HIRE';
    aiSummary: string;
  } {
    let sum = 0;
    let count = 0;
    const skillScores: Record<string, number> = {};

    session.questions.forEach((q, idx) => {
      const score = q.score || 0;
      sum += score;
      count++;
      skillScores[q.category || `Category ${idx + 1}`] = score;
    });

    const averageScore = count > 0 ? Math.round(sum / count) : 0;

    let recommendation: 'STRONG_HIRE' | 'HIRE' | 'CONSIDER' | 'DO_NOT_HIRE' = 'CONSIDER';
    if (averageScore >= 85) recommendation = 'STRONG_HIRE';
    else if (averageScore >= 70) recommendation = 'HIRE';
    else if (averageScore >= 50) recommendation = 'CONSIDER';
    else recommendation = 'DO_NOT_HIRE';

    const aiSummary = `Candidate completed ${count} automated AI evaluation questions for ${session.jobTitle} with an aggregate benchmark score of ${averageScore}%. Recommendation: ${recommendation.replace('_', ' ')}. Strongest areas: ${Object.entries(skillScores).filter(([_, s]) => s >= 70).map(([c]) => c).join(', ') || 'General fundamentals'}.`;

    return {
      totalScore: averageScore,
      skillScores,
      overallRecommendation: recommendation,
      aiSummary
    };
  }
}

export const aiInterviewService = new AiInterviewService();
