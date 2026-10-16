import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { permissionsForRoles, type Role } from '../permissions/roles';
import type { MembershipDirectory } from '../services/contracts';
import type { AppVariables, AuthorizationScope } from '../types/context';

export function scopeForRoles(roles: readonly Role[]): AuthorizationScope {
  if (roles.includes('super_admin') || roles.includes('school_admin')) {
    return Object.freeze({ kind: 'school-wide' });
  }
  if (roles.includes('teacher')) {
    return Object.freeze({ kind: 'assigned-resources' });
  }
  if (roles.includes('parent')) return Object.freeze({ kind: 'linked-children' });
  if (roles.includes('student') || roles.includes('applicant')) {
    return Object.freeze({ kind: 'self' });
  }
  if (roles.includes('moderator')) return Object.freeze({ kind: 'platform' });
  return Object.freeze({ kind: 'school-wide' });
}

export function schoolMembershipMiddleware(
  directory: MembershipDirectory,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  return async (context, next) => {
    const tenant = context.get('tenant');
    const principal = context.get('principal');
    let membership = await directory.findForUser(context.env, tenant.schoolId, principal.userId);
    const supportToken=context.req.header('x-support-session');
    let support:Awaited<ReturnType<NonNullable<typeof directory.resolveSupportSession>>>|null=null;
    if(supportToken){
      if(!membership.isModerator||!directory.resolveSupportSession)throw new AppError({code:'FORBIDDEN',message:'Support access is unavailable.',status:403});
      support=await directory.resolveSupportSession(context.env,{schoolId:tenant.schoolId,operatorId:principal.userId,token:supportToken});
      if(!support)throw new AppError({code:'SUPPORT_SESSION_INVALID',message:'Support session is invalid or expired.',status:403});
      membership=support.membership;
    }
    const effectiveRoles: Role[] = [...membership.roles];
    if (membership.isModerator) effectiveRoles.push('moderator');
    const uniqueRoles = [...new Set(effectiveRoles)];
    if (uniqueRoles.length === 0) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'You are not an active member of this school.',
        status: 403,
      });
    }

    context.set(
      'auth',
      Object.freeze({
        userId: support?.targetAccountId??principal.userId,
        schoolId: tenant.schoolId,
        roles: Object.freeze(uniqueRoles),
        roleCodes: Object.freeze(membership.roleCodes ?? uniqueRoles),
        permissions:
          (membership.permissions?.length ?? 0) > 0
            ? new Set(membership.permissions)
            : permissionsForRoles(uniqueRoles),
        scope: scopeForRoles(uniqueRoles),
        membershipId: membership.membershipId ?? null,
        membershipKind: membership.membershipKind ?? null,
        lifecycleState: membership.lifecycleState ?? null,
        resourceScopes: membership.resourceScopes ?? {},
        ...(support?{supportSession:{id:support.session.id,operatorId:principal.userId,targetAccountId:support.targetAccountId,reason:support.session.reason,expiresAt:support.session.expiresAt}}:{}),
      }),
    );
    let supportRequestStatus=500;try{await next();supportRequestStatus=context.res.status;}finally{
      if(support&&directory.auditSupportRequest)await directory.auditSupportRequest(context.env,{schoolId:tenant.schoolId,operatorId:principal.userId,targetAccountId:support.targetAccountId,sessionId:support.session.id,method:context.req.method,route:context.req.path,status:supportRequestStatus});
    }
  };
}
