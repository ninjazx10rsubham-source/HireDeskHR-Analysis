import { Router } from 'express';
import { store } from '../data/store';
import { requireAuthenticated } from './auth';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

// Recruiter Dashboard Reports
// "report. Report means how many job they posted, right? How many candidates, how many active candidates, how many interview scheduled, how many hirings. Okay. So all those things. This is the report of the client dashboard."
analyticsRouter.get('/', (req, res) => {
  const orgId = getOrgId(req);
  const metrics = store.getMetrics(orgId);
  return res.json(metrics);
});
