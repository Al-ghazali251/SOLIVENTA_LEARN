import { AppError } from '../errors/app-error';
import type { AuthContext } from '../types/context';
import type { Permission } from './permissions';

export function assertPermission(context: AuthContext, permission: Permission): void {
  if (!context.permissions.has(permission)) {
    throw new AppError({
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to perform this action.',
      status: 403,
    });
  }
}

export function assertSchoolScope(context: AuthContext, schoolId: string): void {
  if (context.scope.kind !== 'platform' && context.schoolId !== schoolId) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'The requested resource is outside your school.',
      status: 403,
    });
  }
}

export function requiresAssignedResourceCheck(context: AuthContext): boolean {
  return context.scope.kind === 'assigned-resources';
}
