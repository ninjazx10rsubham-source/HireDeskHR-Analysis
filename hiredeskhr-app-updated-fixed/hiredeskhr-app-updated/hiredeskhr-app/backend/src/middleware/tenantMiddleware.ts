import { Request, Response, NextFunction } from 'express';
import { User } from '../types';

export interface AuthenticatedTenantRequest extends Request {
  currentUser: User;
  currentTenant: string;
}

export function isPlatformAdmin(user?: User): boolean {
  if (!user) return false;
  return user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
}

/**
 * Validates that a requested resource belongs strictly to the calling user's tenant.
 * Platform administrators (ADMIN, SUPER_ADMIN) have global bypass.
 * Unauthorized cross-tenant attempts immediately return 403 Forbidden.
 */
export function checkTenantAccess(
  req: any,
  res: Response,
  targetOrgId?: string,
  resourceName: string = 'resource'
): boolean {
  if (!targetOrgId) return true;
  if (isPlatformAdmin(req.currentUser)) return true;

  if (targetOrgId !== req.currentUser?.organizationId) {
    res.status(403).json({
      error: `Forbidden: You do not have permission to access ${resourceName} belonging to another company.`,
      code: 'TENANT_ISOLATION_VIOLATION'
    });
    return false;
  }

  return true;
}

/**
 * Resolves the target tenant ID for list/query endpoints.
 * If a non-platform admin tries to query another tenant via query param or header,
 * this function immediately responds with 403 Forbidden and returns null.
 */
export function resolveTargetOrgId(
  req: any,
  res: Response,
  resourceName: string = 'resources'
): string | null {
  const isAdmin = isPlatformAdmin(req.currentUser);
  const requestedOrgId = (req.query?.orgId as string) || (req.query?.organizationId as string) || (isAdmin ? (req.headers['x-organization-id'] as string) : null);

  if (requestedOrgId) {
    if (!checkTenantAccess(req, res, requestedOrgId, resourceName)) {
      return null;
    }
    return requestedOrgId;
  }

  return req.currentUser?.organizationId || '';
}
