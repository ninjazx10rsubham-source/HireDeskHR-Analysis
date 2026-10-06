export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'CLIENT_ADMIN' | 'ORG_ADMIN' | 'RECRUITER' | 'HIRING_MANAGER' | 'INTERVIEWER' | 'CLIENT' | 'CANDIDATE';

export type Stage =
  | 'applied'
  | 'screening'
  | 'shortlisted'
  | 'interview'
  | 'ai_interview'
  | 'client_review'
  | 'selected'
  | 'rejected'
  | 'hired'
  | 'sourcing'
  | 'contacted'
  | 'offered';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string;
  clientId?: string;
  companyName?: string;
  avatar?: string;
  clientNumber?: string;
  phone?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  passwordHash?: string;
  createdAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  logo?: string;
  banner?: string;
  tagline?: string;
  cultureText?: string;
  plan: 'free' | 'growth' | 'enterprise';
  jobsPurchased?: number;
  trialStartedAt?: string;
  trialEndsAt?: string;
  createdAt: string;
}

export interface Client {
  id: string;
  organizationId: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  address: string;
  website: string;
  industry: string;
  notes?: string;
  createdAt: string;
}

export interface FormFieldConfig {
  id: string;
  label: string;
  key: string;
  enabled: boolean;
  required: boolean;
  isSystemLocked?: boolean;
}

export interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'text' | 'yesno' | 'number';
  required: boolean;
}

export interface ApplicationFormConfig {
  fields: FormFieldConfig[];
  screeningQuestions: ScreeningQuestion[];
}

export interface Job {
  id: string;
  jobCode: string; // e.g. JOB-1024
  organizationId: string;
  title: string;
  clientName: string;
  clientEmail?: string;
  clientId?: string;
  department: string;
  location: string;
  country: string;
  stateCity?: string;
  workplaceType: 'Remote' | 'Hybrid' | 'On-site';
  employmentType: 'Full-time' | 'Part-time' | 'Contract' | 'Internship';
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  experienceMin?: number;
  experienceMax?: number;
  education?: string;
  skills: string[];
  openingsCount: number;
  deadline?: string;
  recruiterId?: string;
  recruiterName?: string;
  description: string;
  requirements: string[];
  status: 'active' | 'draft' | 'closed';
  applicationFormConfig: ApplicationFormConfig;
  publishedOnLinkedIn: boolean;
  adminNotifiedForLinkedIn: boolean;
  applicantsCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface CandidateScorecard {
  id: string;
  interviewerName: string;
  technicalRating: number; // 1-5
  communicationRating: number; // 1-5
  problemSolvingRating: number; // 1-5
  cultureFitRating: number; // 1-5
  recommendation: 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE';
  notes: string;
  submittedAt: string;
}

export interface Application {
  id: string; // e.g. APP-1025-01
  applicationId: string;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  clientId: string;
  clientName: string;
  organizationId: string;
  candidateId?: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string;
  resumeUrl?: string;
  resumeFileName?: string;
  resumePath?: string;
  resumeSize?: number;
  appliedAt: string;
  status: Stage | string;
}

export interface Candidate {
  id: string;
  candidateCode?: string;
  applicationId?: string;
  organizationId: string;
  jobId: string;
  jobCode?: string;
  jobTitle?: string;
  clientId?: string;
  clientName?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  country?: string;
  resumeFileName?: string;
  resumeUrl?: string;
  resumePath?: string;
  resumeSize?: number;
  resumeText?: string;
  skills?: string[];
  education?: string;
  currentCtc?: string;
  expectedCtc?: string;
  totalExperience?: string;
  noticePeriod?: string;
  screeningAnswers?: Record<string, string>;
  stage: Stage;
  source: string;
  matchScore: number;
  appliedAt: string;
  createdAt?: string;
  notes?: string[];
  scorecards?: CandidateScorecard[];
  timeline?: { event: string; timestamp: string; user?: string }[];
}

export interface Interview {
  id: string;
  organizationId: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  roundName: string;
  interviewerName: string;
  interviewerEmail: string;
  recruiterEmail?: string;
  scheduledAt: string;
  durationMinutes: number;
  timezone?: string;
  description?: string;
  meetingUrl: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  scorecard?: CandidateScorecard;
  googleEventId?: string;
}

export interface AiInterviewQuestion {
  id: number;
  category: string;
  question: string;
  expectedKeywords: string[];
  maxScore: number;
  candidateAnswer?: string;
  candidateAudioVideoUrl?: string;
  timeTakenSeconds?: number;
  score?: number;
  feedback?: string;
}

export interface AiInterviewSession {
  id: string;
  organizationId: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  interviewType: 'technical' | 'behavioral' | 'leadership' | 'system_design' | 'mixed';
  difficulty: 'junior' | 'mid' | 'senior' | 'lead';
  durationMinutes: number;
  skillsToEvaluate: string[];
  questions: AiInterviewQuestion[];
  status: 'created' | 'in_progress' | 'completed' | 'reviewed';
  totalScore?: number;
  skillScores?: Record<string, number>;
  overallRecommendation?: 'STRONG_HIRE' | 'HIRE' | 'CONSIDER' | 'DO_NOT_HIRE';
  aiSummary?: string;
  videoConsentGranted?: boolean;
  videoRecordingUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export interface EmailMessage {
  id: string;
  sender: 'recruiter' | 'candidate';
  senderName: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
}

export interface EmailThread {
  id: string;
  organizationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  subject: string;
  lastMessageAt: string;
  unread: boolean;
  messages: EmailMessage[];
}

export interface EmailCampaign {
  id: string;
  organizationId: string;
  name: string;
  subject: string;
  content: string;
  recipientCount: number;
  sentCount: number;
  status: 'draft' | 'sending' | 'sent' | 'failed';
  createdAt: string;
  sentAt?: string;
}

export interface Notification {
  id: string;
  organizationId: string;
  recipientEmail: string;
  title: string;
  message: string;
  type: 'application' | 'resume' | 'interview' | 'ai_interview' | 'client_review' | 'system';
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface AutomationLog {
  id: string;
  organizationId: string;
  eventType: string;
  status: 'success' | 'warning' | 'error';
  title: string;
  details: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface InboundApplication {
  id: string;
  organizationId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  attachmentName: string;
  attachmentUrl?: string;
  resumeText?: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  status: 'unmatched' | 'confirmed';
  possibleJobIds: string[];
  receivedAt: string;
  confirmedJobId?: string;
  candidateId?: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  userId?: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
}

export interface RecruiterMetrics {
  totalJobs: number;
  activeJobs: number;
  totalCandidates: number;
  activeCandidates: number;
  interviewsScheduled: number;
  totalHirings: number;
  stageFunnel: Record<string, number>;
  departmentBreakdown: { department: string; count: number }[];
}

export type FeedbackType = 'Report an Issue' | 'Request a Feature' | 'Other Feedback';
export type FeedbackStatus = 'New' | 'In Review' | 'In Progress' | 'Resolved' | 'Closed';

export interface FeedbackSubmission {
  id: string; // e.g. "fb-1a2b3c4d"
  name: string;
  email: string;
  type: FeedbackType;
  subject: string;
  description: string;
  attachmentUrl?: string;
  attachmentName?: string;
  submittedAt: string; // ISO 8601
  status: FeedbackStatus; // default: "New"
  adminNotes?: string;
  ipAddress?: string;
}

