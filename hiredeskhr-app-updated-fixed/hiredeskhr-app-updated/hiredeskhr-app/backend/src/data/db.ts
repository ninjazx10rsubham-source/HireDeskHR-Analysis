import fs from 'fs';
import path from 'path';
import { saveSupabaseState } from './supabaseStore';
import {
  User,
  Organization,
  Client,
  Job,
  Candidate,
  Interview,
  AiInterviewSession,
  EmailThread,
  EmailCampaign,
  Notification,
  AutomationLog,
  AuditLog,
  ApplicationFormConfig,
  InboundApplication,
  FeedbackSubmission
} from '../types';

export const DEFAULT_APPLICATION_CONFIG: ApplicationFormConfig = {
  fields: [
    { id: 'f1', label: 'First Name', key: 'firstName', enabled: true, required: true, isSystemLocked: true },
    { id: 'f2', label: 'Last Name', key: 'lastName', enabled: true, required: true, isSystemLocked: true },
    { id: 'f3', label: 'Email Address', key: 'email', enabled: true, required: true, isSystemLocked: true },
    { id: 'f4', label: 'Phone Number', key: 'phone', enabled: true, required: true, isSystemLocked: true },
    { id: 'f5', label: 'Current Location', key: 'location', enabled: true, required: true, isSystemLocked: true },
    { id: 'f6', label: 'Resume / CV', key: 'resume', enabled: true, required: true, isSystemLocked: true },
    { id: 'f7', label: 'Current CTC / Salary', key: 'currentCtc', enabled: true, required: false, isSystemLocked: false },
    { id: 'f8', label: 'Expected CTC / Salary', key: 'expectedCtc', enabled: true, required: false, isSystemLocked: false },
    { id: 'f9', label: 'Total Work Experience', key: 'totalExperience', enabled: true, required: false, isSystemLocked: false },
    { id: 'f10', label: 'Notice Period', key: 'noticePeriod', enabled: true, required: false, isSystemLocked: false }
  ],
  screeningQuestions: [
    { id: 'q1', question: 'How many years of relevant experience do you have in this domain?', type: 'text', required: true },
    { id: 'q2', question: 'Are you comfortable working in a hybrid / remote model?', type: 'yesno', required: true }
  ]
};

interface DatabaseSchema {
  organizations: Organization[];
  users: User[];
  clients: Client[];
  jobs: Job[];
  candidates: Candidate[];
  interviews: Interview[];
  aiInterviews: AiInterviewSession[];
  emailThreads: EmailThread[];
  emailCampaigns: EmailCampaign[];
  notifications: Notification[];
  automationLogs: AutomationLog[];
  auditLogs: AuditLog[];
  inboundApplications: InboundApplication[];
  feedback: FeedbackSubmission[];
}

const DB_FILE_PATH = path.resolve(__dirname, 'database.json');

export class DatabaseEngine {
  public organizations: Organization[] = [];
  public users: User[] = [];
  public clients: Client[] = [];
  public jobs: Job[] = [];
  public candidates: Candidate[] = [];
  public interviews: Interview[] = [];
  public aiInterviews: AiInterviewSession[] = [];
  public emailThreads: EmailThread[] = [];
  public emailCampaigns: EmailCampaign[] = [];
  public notifications: Notification[] = [];
  public automationLogs: AutomationLog[] = [];
  public auditLogs: AuditLog[] = [];
  public inboundApplications: InboundApplication[] = [];
  public feedback: FeedbackSubmission[] = [];


  // Secondary In-Memory Hash Indexes for O(1) Lookups under High Concurrency
  private indexUsersById = new Map<string, User>();
  private indexUsersByEmail = new Map<string, User>();
  private indexOrgsById = new Map<string, Organization>();
  private indexClientsById = new Map<string, Client>();
  private indexClientsByOrgId = new Map<string, Client[]>();
  private indexClientsByEmail = new Map<string, Client>();
  private indexJobsById = new Map<string, Job>();
  private indexJobsByOrgId = new Map<string, Job[]>();
  private indexJobsByClientId = new Map<string, Job[]>();
  private indexCandidatesById = new Map<string, Candidate>();
  private indexCandidatesByJobId = new Map<string, Candidate[]>();
  private indexCandidatesByOrgId = new Map<string, Candidate[]>();
  private indexCandidatesByClientId = new Map<string, Candidate[]>();
  private indexCandidateCountByJobId = new Map<string, number>();
  private indexInterviewsByCandidateId = new Map<string, Interview[]>();

  // Asynchronous Write Queue and Mutex
  private isSaving = false;
  private savePending = false;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(DB_FILE_PATH)) {
        const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
        const parsed: DatabaseSchema = JSON.parse(raw);
        this.organizations = parsed.organizations || [];
        this.users = parsed.users || [];
        this.clients = parsed.clients || [];
        this.jobs = parsed.jobs || [];
        this.candidates = parsed.candidates || [];
        this.interviews = parsed.interviews || [];
        this.aiInterviews = parsed.aiInterviews || [];
        this.emailThreads = parsed.emailThreads || [];
        this.emailCampaigns = parsed.emailCampaigns || [];
        this.notifications = parsed.notifications || [];
        this.automationLogs = parsed.automationLogs || [];
        this.auditLogs = parsed.auditLogs || [];
        this.inboundApplications = parsed.inboundApplications || [];
        this.feedback = parsed.feedback || [];
        this.backfillNormalizedDomains();
        this.rebuildIndexes();
      } else {
        this.seedInitialData();
        this.save(true);
      }
    } catch (err: any) {
      console.error('⚠️ [DATABASE] Failed to load database.json, initializing fresh store:', err.message);
      this.seedInitialData();
      this.save(true);
    }
  }

  public rebuildIndexes() {
    this.indexUsersById.clear();
    this.indexUsersByEmail.clear();
    for (const u of this.users) {
      this.indexUsersById.set(u.id, u);
      if (u.email) this.indexUsersByEmail.set(u.email.toLowerCase().trim(), u);
    }

    this.indexOrgsById.clear();
    for (const o of this.organizations) {
      this.indexOrgsById.set(o.id, o);
    }

    this.indexClientsById.clear();
    this.indexClientsByOrgId.clear();
    this.indexClientsByEmail.clear();
    for (const c of this.clients) {
      this.indexClientsById.set(c.id, c);
      if (c.email) this.indexClientsByEmail.set(c.email.toLowerCase().trim(), c);
      if (c.organizationId) {
        const list = this.indexClientsByOrgId.get(c.organizationId) || [];
        list.push(c);
        this.indexClientsByOrgId.set(c.organizationId, list);
      }
    }

    this.indexJobsById.clear();
    this.indexJobsByOrgId.clear();
    this.indexJobsByClientId.clear();
    for (const j of this.jobs) {
      this.indexJobsById.set(j.id, j);
      if (j.organizationId) {
        const list = this.indexJobsByOrgId.get(j.organizationId) || [];
        list.push(j);
        this.indexJobsByOrgId.set(j.organizationId, list);
      }
      if (j.clientId) {
        const list = this.indexJobsByClientId.get(j.clientId) || [];
        list.push(j);
        this.indexJobsByClientId.set(j.clientId, list);
      }
    }

    this.indexCandidatesById.clear();
    this.indexCandidatesByJobId.clear();
    this.indexCandidatesByOrgId.clear();
    this.indexCandidatesByClientId.clear();
    this.indexCandidateCountByJobId.clear();
    for (const c of this.candidates) {
      this.indexCandidatesById.set(c.id, c);
      if (c.jobId) {
        const list = this.indexCandidatesByJobId.get(c.jobId) || [];
        list.push(c);
        this.indexCandidatesByJobId.set(c.jobId, list);
        this.indexCandidateCountByJobId.set(c.jobId, (this.indexCandidateCountByJobId.get(c.jobId) || 0) + 1);
      }
      if (c.organizationId) {
        const list = this.indexCandidatesByOrgId.get(c.organizationId) || [];
        list.push(c);
        this.indexCandidatesByOrgId.set(c.organizationId, list);
      }
      if (c.clientId) {
        const list = this.indexCandidatesByClientId.get(c.clientId) || [];
        list.push(c);
        this.indexCandidatesByClientId.set(c.clientId, list);
      }
    }

    this.indexInterviewsByCandidateId.clear();
    for (const i of this.interviews) {
      if (i.candidateId) {
        const list = this.indexInterviewsByCandidateId.get(i.candidateId) || [];
        list.push(i);
        this.indexInterviewsByCandidateId.set(i.candidateId, list);
      }
    }
  }

  // Fast O(1) Lookups
  public getUserById(id: string): User | undefined { return this.indexUsersById.get(id); }
  public getUserByEmail(email: string): User | undefined { return this.indexUsersByEmail.get(email.toLowerCase().trim()); }
  public getOrgById(id: string): Organization | undefined { return this.indexOrgsById.get(id); }
  public getClientById(id: string): Client | undefined { return this.indexClientsById.get(id); }
  public getClientsByOrgId(orgId: string): Client[] { return this.indexClientsByOrgId.get(orgId) || []; }
  public getJobById(id: string): Job | undefined { return this.indexJobsById.get(id); }
  public getJobsByOrgId(orgId: string): Job[] { return this.indexJobsByOrgId.get(orgId) || []; }
  public getJobsByClientId(clientId: string): Job[] { return this.indexJobsByClientId.get(clientId) || []; }
  public getCandidateById(id: string): Candidate | undefined { return this.indexCandidatesById.get(id); }
  public getCandidatesByJobId(jobId: string): Candidate[] { return this.indexCandidatesByJobId.get(jobId) || []; }
  public getCandidateCountByJobId(jobId: string): number { return this.indexCandidateCountByJobId.get(jobId) || 0; }
  public getCandidatesByOrgId(orgId: string): Candidate[] { return this.indexCandidatesByOrgId.get(orgId) || []; }
  public getCandidatesByClientId(clientId: string): Candidate[] { return this.indexCandidatesByClientId.get(clientId) || []; }
  public getFeedbackById(id: string): FeedbackSubmission | undefined { return this.feedback.find(f => f.id === id); }

  private backfillNormalizedDomains() {
    this.organizations.forEach((organization) => {
      if (!organization.domain) {
        const owner = this.users.find((user) => user.organizationId === organization.id && user.email.includes('@'));
        organization.domain = owner?.email.split('@')[1]?.trim().toLowerCase();
      }
    });
    this.clients.forEach((client) => {
      const domain = client.email.split('@')[1]?.trim().toLowerCase();
      const organization = this.organizations.find((item) => item.id === client.organizationId);
      if (organization?.domain && domain === organization.domain) return;
    });
    this.jobs.forEach((job) => {
      if (!job.clientEmail && job.clientId) {
        job.clientEmail = this.clients.find((client) => client.id === job.clientId)?.email;
      }
    });
  }

  public save(immediate = false) {
    this.rebuildIndexes();
    if (immediate) {
      return this.flushSync();
    }
    if (this.saveDebounceTimer) {
      return;
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.flushAsync().catch((err) => {
        console.error('❌ [DATABASE] Async flush error:', err.message);
      });
    }, 50);
  }

  public async flushAsync() {
    if (this.isSaving) {
      this.savePending = true;
      return;
    }
    this.isSaving = true;
    try {
      const data: DatabaseSchema = this.exportSchema();
      const tmpPath = `${DB_FILE_PATH}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      try {
        await fs.promises.rename(tmpPath, DB_FILE_PATH);
      } catch {
        await fs.promises.copyFile(tmpPath, DB_FILE_PATH);
        await fs.promises.unlink(tmpPath).catch(() => {});
      }
    } catch (err: any) {
      console.error('❌ [DATABASE] Error asynchronous save to disk:', err.message);
    } finally {
      this.isSaving = false;
      if (this.savePending) {
        this.savePending = false;
        this.save();
      }
    }
  }

  public flushSync() {
    try {
      const data: DatabaseSchema = this.exportSchema();
      const tmpPath = `${DB_FILE_PATH}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      try {
        fs.renameSync(tmpPath, DB_FILE_PATH);
      } catch {
        fs.copyFileSync(tmpPath, DB_FILE_PATH);
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    } catch (err: any) {
      console.error('❌ [DATABASE] Error synchronous save to disk:', err.message);
    }
  }

  private exportSchema(): DatabaseSchema {
    return {
      organizations: this.organizations,
      users: this.users,
      clients: this.clients,
      jobs: this.jobs,
      candidates: this.candidates,
      interviews: this.interviews,
      aiInterviews: this.aiInterviews,
      emailThreads: this.emailThreads,
      emailCampaigns: this.emailCampaigns,
      notifications: this.notifications,
      automationLogs: this.automationLogs,
      auditLogs: this.auditLogs,
      inboundApplications: this.inboundApplications,
      feedback: this.feedback
    };
  }

  public generateJobCode(): string {
    let max = 1000;
    for (const j of this.jobs) {
      if (j.jobCode && j.jobCode.startsWith('JOB-')) {
        const num = parseInt(j.jobCode.replace('JOB-', ''), 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
    return `JOB-${max + 1}`;
  }

  public generateCandidateCode(): string {
    let max = 2000;
    for (const c of this.candidates) {
      if (c.candidateCode && c.candidateCode.startsWith('CAND-')) {
        const num = parseInt(c.candidateCode.replace('CAND-', ''), 10);
        if (!isNaN(num) && num > max) {
          max = num;
        }
      }
    }
    return `CAND-${max + 1}`;
  }

  private seedInitialData() {
    this.organizations = [
      {
        id: 'org-software',
        name: 'HiredeskHR',
        slug: 'software-workforce',
        logo: 'https://images.unsplash.com/photo-1571171637578-41bc2dd41cd2?w=120&h=120&fit=crop&crop=faces',
        banner: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1600&h=400&fit=crop',
        tagline: 'Leading Global Enterprise Software & Technical Staffing Innovation',
        cultureText: 'At HiredeskHR, we connect exceptional software engineers and technical leaders with high-impact product roles.',
        plan: 'growth',
        createdAt: '2026-01-15T09:00:00Z'
      }
    ];

    this.clients = [
      {
        id: 'client-sw',
        organizationId: 'org-software',
        companyName: 'HiredeskHR',
        contactPerson: 'Sarah Jenkins',
        email: 'recruiter@hiredeskhr.com',
        phone: '+91 82178 77923',
        country: 'India',
        address: 'MG Road, Bangalore, KA 560001',
        website: 'https://hiredeskhr.com',
        industry: 'Software & Technology Services',
        notes: 'Primary enterprise staffing client and internal recruitment division.',
        createdAt: '2026-01-15T09:00:00Z'
      },
      {
        id: 'client-cloudscale',
        organizationId: 'org-software',
        companyName: 'CloudScale Global Inc',
        contactPerson: 'Alex Rivera',
        email: 'alex.rivera@cloudscaleglobal.com',
        phone: '+1 415 555 0192',
        country: 'United States',
        address: '500 Howard St, San Francisco, CA 94105',
        website: 'https://cloudscale.io',
        industry: 'Cloud Infrastructure & AI Platform',
        notes: 'Global client actively hiring distributed senior backend and AI systems engineers.',
        createdAt: '2026-02-01T10:00:00Z'
      }
    ];

    this.users = [
      {
        id: 'user-sarah',
        email: 'recruiter@hiredeskhr.com',
        name: 'Sarah Jenkins',
        role: 'ADMIN',
        organizationId: 'org-software',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces',
        phone: '+91 82178 77923',
        emailVerified: true
      },
      {
        id: 'user-admin',
        email: 'admin@hiredeskhr.com',
        name: 'Aashutosh Ranjan',
        role: 'ADMIN',
        organizationId: 'org-software',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=faces',
        phone: '+91 82178 77923',
        emailVerified: true
      },
      {
        id: 'user-client-alex',
        email: 'alex.rivera@cloudscaleglobal.com',
        name: 'Alex Rivera',
        role: 'CLIENT',
        organizationId: 'org-software',
        clientId: 'client-cloudscale',
        phone: '+1 415 555 0192',
        emailVerified: true
      }
    ];

    this.jobs = [
      {
        id: 'job-swe-01',
        jobCode: 'JOB-1001',
        organizationId: 'org-software',
        clientId: 'client-sw',
        title: 'Senior Software Engineer',
        clientName: 'HiredeskHR',
        department: 'Engineering',
        location: 'Bangalore / Remote',
        country: 'India',
        stateCity: 'Bangalore, Karnataka',
        workplaceType: 'Hybrid',
        employmentType: 'Full-time',
        salaryMin: 2200000,
        salaryMax: 3500000,
        currency: 'INR',
        experienceMin: 4,
        experienceMax: 8,
        education: "Bachelor's or Master's in Computer Science or equivalent",
        skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'System Design', 'Microservices', 'AWS'],
        openingsCount: 3,
        deadline: '2026-10-31',
        recruiterId: 'user-sarah',
        recruiterName: 'Sarah Jenkins',
        description: 'We are seeking an exceptional Senior Software Engineer to design, architect, and deliver our next-generation software platforms, high-throughput microservices, and modern web applications.',
        requirements: [
          '4+ years architecting scalable full-stack TypeScript / Node / React systems',
          'Demonstrated expertise in distributed queues, PostgreSQL, and AWS',
          'Strong problem-solving and clean code fundamentals'
        ],
        status: 'active',
        applicationFormConfig: DEFAULT_APPLICATION_CONFIG,
        publishedOnLinkedIn: true,
        adminNotifiedForLinkedIn: true,
        applicantsCount: 3,
        createdAt: '2026-02-10T10:00:00Z'
      },
      {
        id: 'job-ai-02',
        jobCode: 'JOB-1002',
        organizationId: 'org-software',
        clientId: 'client-cloudscale',
        title: 'Staff AI Platform Engineer',
        clientName: 'CloudScale Global Inc',
        department: 'AI Systems',
        location: 'San Francisco / Remote',
        country: 'United States',
        stateCity: 'San Francisco, CA',
        workplaceType: 'Remote',
        employmentType: 'Full-time',
        salaryMin: 180000,
        salaryMax: 240000,
        currency: 'USD',
        experienceMin: 6,
        experienceMax: 12,
        education: "Master's or Ph.D. in Computer Science / AI / Math",
        skills: ['Python', 'PyTorch', 'LLMs', 'CUDA', 'Distributed Inference', 'Kubernetes', 'FastAPI'],
        openingsCount: 2,
        deadline: '2026-11-15',
        recruiterId: 'user-admin',
        recruiterName: 'Aashutosh Ranjan',
        description: 'Lead the architecture and deployment of large-scale generative AI pipelines and low-latency LLM inference clusters.',
        requirements: [
          'Deep expertise in model inference acceleration, vLLM/TensorRT-LLM, and distributed GPU clusters',
          'Strong systems engineering background in Python and C++',
          'Experience building mission-critical machine learning backends'
        ],
        status: 'active',
        applicationFormConfig: DEFAULT_APPLICATION_CONFIG,
        publishedOnLinkedIn: true,
        adminNotifiedForLinkedIn: true,
        applicantsCount: 2,
        createdAt: '2026-02-15T12:00:00Z'
      }
    ];

    this.candidates = [
      {
        id: 'cand-rohan',
        candidateCode: 'CAND-2001',
        organizationId: 'org-software',
        jobId: 'job-swe-01',
        clientId: 'client-sw',
        firstName: 'Rohan',
        lastName: 'Verma',
        email: 'rohan.verma@example.com',
        phone: '+91 98765 43210',
        location: 'Bangalore, India',
        country: 'India',
        resumeFileName: 'Rohan_Verma_Resume.pdf',
        resumeUrl: 'https://hiredeskhr.com/resumes/Rohan_Verma_Resume.pdf',
        resumeText: 'Senior Full Stack Engineer with 6 years experience in React, Node.js, TypeScript, PostgreSQL, and AWS.',
        skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'AWS'],
        education: 'B.Tech in Computer Science',
        currentCtc: '20,00,000 INR',
        expectedCtc: '28,00,000 INR',
        totalExperience: '6 Years',
        noticePeriod: '30 Days',
        stage: 'interview',
        source: 'Career Page',
        matchScore: 94,
        appliedAt: '2026-02-16T14:30:00Z',
        notes: ['Strong technical pedigree. Passed initial recruiter phone screen.'],
        timeline: [
          { event: 'Application received via Public Career Portal', timestamp: '2026-02-16T14:30:00Z' },
          { event: 'Advanced to Interview stage', timestamp: '2026-02-17T11:00:00Z', user: 'Sarah Jenkins' }
        ]
      },
      {
        id: 'cand-ananya',
        candidateCode: 'CAND-2002',
        organizationId: 'org-software',
        jobId: 'job-swe-01',
        clientId: 'client-sw',
        firstName: 'Ananya',
        lastName: 'Sharma',
        email: 'ananya.sharma@example.com',
        phone: '+91 98111 22334',
        location: 'Hyderabad, India',
        country: 'India',
        resumeFileName: 'Ananya_Sharma_Resume.pdf',
        resumeUrl: 'https://hiredeskhr.com/resumes/Ananya_Sharma_Resume.pdf',
        resumeText: 'Full Stack Engineer with 5 years experience in React, Node, microservices, and Docker.',
        skills: ['React', 'TypeScript', 'Node.js', 'Docker', 'Redis'],
        education: 'B.E. in Information Technology',
        currentCtc: '18,00,000 INR',
        expectedCtc: '25,00,000 INR',
        totalExperience: '5 Years',
        noticePeriod: 'Immediate',
        stage: 'applied',
        source: 'LinkedIn',
        matchScore: 89,
        appliedAt: '2026-02-18T09:15:00Z',
        notes: ['Applicant has immediate availability.'],
        timeline: [
          { event: 'Candidate applied via LinkedIn Syndication', timestamp: '2026-02-18T09:15:00Z' }
        ]
      }
    ];

    this.interviews = [
      {
        id: 'int-01',
        organizationId: 'org-software',
        jobId: 'job-swe-01',
        jobTitle: 'Senior Software Engineer',
        candidateId: 'cand-rohan',
        candidateName: 'Rohan Verma',
        candidateEmail: 'rohan.verma@example.com',
        roundName: 'Round 1: System Architecture & Live Coding',
        interviewerName: 'Sarah Jenkins',
        interviewerEmail: 'recruiter@hiredeskhr.com',
        scheduledAt: '2026-02-22T10:00:00Z',
        durationMinutes: 45,
        timezone: 'Asia/Kolkata',
        description: 'Comprehensive system architecture evaluation with practical coding walkthrough.',
        meetingUrl: 'https://meet.google.com/qwe-rtyu-iop',
        status: 'scheduled'
      }
    ];

    this.emailThreads = [
      {
        id: 'thread-cand-rohan',
        organizationId: 'org-software',
        candidateId: 'cand-rohan',
        candidateName: 'Rohan Verma',
        candidateEmail: 'rohan.verma@example.com',
        jobTitle: 'Senior Software Engineer',
        subject: 'HiredeskHR Application & Interview Schedule: Senior Software Engineer',
        lastMessageAt: '2026-02-17T11:05:00Z',
        unread: false,
        messages: [
          {
            id: 'msg-01',
            sender: 'recruiter',
            senderName: 'Sarah Jenkins',
            content: 'Hi Rohan,\n\nThank you for applying to the Senior Software Engineer requisition. We are delighted to invite you to Round 1.',
            timestamp: '2026-02-17T11:05:00Z',
            status: 'delivered'
          }
        ]
      }
    ];

    this.notifications = [
      {
        id: 'notif-01',
        organizationId: 'org-software',
        recipientEmail: 'admin@hiredeskhr.com',
        title: 'New Candidate Applied: Rohan Verma',
        message: 'Rohan Verma applied for Senior Software Engineer (HiredeskHR).',
        type: 'application',
        link: '/jobs/job-swe-01',
        read: false,
        createdAt: '2026-02-16T14:30:00Z'
      }
    ];

    this.automationLogs = [
      {
        id: 'log-01',
        organizationId: 'org-software',
        eventType: 'inbound_email_resume',
        status: 'success',
        title: 'Email Resume Processed',
        details: 'Email received from candidate -> Resume attachment parsed -> Linked to JOB-1001 -> Recruiter notified.',
        metadata: { jobId: 'job-swe-01', candidateId: 'cand-rohan' },
        createdAt: '2026-02-16T14:30:00Z'
      }
    ];

    this.auditLogs = [
      {
        id: 'audit-01',
        organizationId: 'org-software',
        userId: 'user-sarah',
        userEmail: 'recruiter@hiredeskhr.com',
        action: 'CREATE_JOB',
        resource: 'Job',
        resourceId: 'job-swe-01',
        details: 'Created job requisition Senior Software Engineer (JOB-1001)',
        timestamp: '2026-02-10T10:00:00Z'
      }
    ];
  }
}

export const db = new DatabaseEngine();
