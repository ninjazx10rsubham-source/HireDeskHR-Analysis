import { Router } from 'express';
import { db } from '../data/db';
import { requireAuthenticated } from './auth';
import { checkTenantAccess } from '../middleware/tenantMiddleware';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuthenticated);

const getOrgId = (req: any): string => {
  return req.currentUser.organizationId;
};

/**
 * List all notifications
 */
notificationsRouter.get('/', (req, res) => {
  const orgId = getOrgId(req);
  const notifs = db.notifications.filter(n => n.organizationId === orgId);
  return res.json(notifs);
});

/**
 * Mark a single notification as read
 */
notificationsRouter.patch('/:id/read', (req: any, res) => {
  const notif = db.notifications.find(n => n.id === req.params.id);
  if (!notif) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  if (!checkTenantAccess(req, res, notif.organizationId, 'notification')) return;

  notif.read = true;
  db.save();
  return res.json({ success: true, notification: notif });
});

/**
 * Mark all notifications as read
 */
notificationsRouter.post('/mark-all-read', (req, res) => {
  const orgId = getOrgId(req);
  db.notifications.forEach(n => {
    if (n.organizationId === orgId) {
      n.read = true;
    }
  });
  db.save();
  return res.json({ success: true, message: 'All notifications marked as read' });
});

/**
 * Delete a notification
 */
notificationsRouter.delete('/:id', (req: any, res) => {
  const notif = db.notifications.find(n => n.id === req.params.id);
  if (!notif) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  if (!checkTenantAccess(req, res, notif.organizationId, 'notification')) return;

  db.notifications = db.notifications.filter(n => n.id !== req.params.id);
  db.save();
  return res.json({ success: true, message: 'Notification deleted' });
});
