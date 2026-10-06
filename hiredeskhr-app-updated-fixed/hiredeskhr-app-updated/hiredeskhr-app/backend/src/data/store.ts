import { db, DEFAULT_APPLICATION_CONFIG } from './db';
import { RecruiterMetrics } from '../types';

export { DEFAULT_APPLICATION_CONFIG, db };

class StoreProxy {
  get organizations() { return db.organizations; }
  set organizations(val) { db.organizations = val; db.save(); }

  get users() { return db.users; }
  set users(val) { db.users = val; db.save(); }

  get clients() { return db.clients; }
  set clients(val) { db.clients = val; db.save(); }

  get jobs() { return db.jobs; }
  set jobs(val) { db.jobs = val; db.save(); }

  get candidates() { return db.candidates; }
  set candidates(val) { db.candidates = val; db.save(); }

  get interviews() { return db.interviews; }
  set interviews(val) { db.interviews = val; db.save(); }

  get aiInterviews() { return db.aiInterviews; }
  set aiInterviews(val) { db.aiInterviews = val; db.save(); }

  get emailThreads() { return db.emailThreads; }
  set emailThreads(val) { db.emailThreads = val; db.save(); }

  get notifications() { return db.notifications; }
  set notifications(val) { db.notifications = val; db.save(); }

  get automationLogs() { return db.automationLogs; }
  set automationLogs(val) { db.automationLogs = val; db.save(); }

  get auditLogs() { return db.auditLogs; }
  set auditLogs(val) { db.auditLogs = val; db.save(); }

  get feedback() { return db.feedback; }
  set feedback(val) { db.feedback = val; db.save(); }

  public save() {
    db.save();
  }

  public getMetrics(orgId: string): RecruiterMetrics {
    const orgJobs = db.jobs.filter(j => j.organizationId === orgId);
    const orgCandidates = db.candidates.filter(c => c.organizationId === orgId);
    const orgInterviews = db.interviews.filter(i => i.organizationId === orgId);

    const stageFunnel: Record<string, number> = {
      applied: 0,
      screening: 0,
      shortlisted: 0,
      interview: 0,
      ai_interview: 0,
      client_review: 0,
      selected: 0,
      rejected: 0,
      hired: 0,
      sourcing: 0,
      contacted: 0,
      offered: 0
    };

    orgCandidates.forEach(c => {
      const st = (c.stage || 'applied').toLowerCase();
      if (stageFunnel[st] !== undefined) {
        stageFunnel[st]++;
      } else {
        stageFunnel[st] = 1;
      }
    });

    const deptMap: Record<string, number> = {};
    orgJobs.forEach(j => {
      deptMap[j.department] = (deptMap[j.department] || 0) + (j.applicantsCount || 0);
    });

    const departmentBreakdown = Object.entries(deptMap).map(([department, count]) => ({
      department,
      count
    }));

    return {
      totalJobs: orgJobs.length,
      activeJobs: orgJobs.filter(j => j.status === 'active').length,
      totalCandidates: orgCandidates.length,
      activeCandidates: orgCandidates.filter(c => !['hired', 'rejected'].includes(c.stage)).length,
      interviewsScheduled: orgInterviews.filter(i => i.status === 'scheduled').length,
      totalHirings: orgCandidates.filter(c => c.stage === 'hired').length,
      stageFunnel,
      departmentBreakdown
    };
  }
}

export const store = new StoreProxy();
