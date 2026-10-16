import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { assertPermission } from '../permissions/authorize';
import type { Permission } from '../permissions/permissions';
import type { AppVariables } from '../types/context';

export function requirePermission(
  permission: Permission,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  return async (context, next) => {
    context.set('requiredPermission', permission);
    assertPermission(context.get('auth'), permission);
    await next();
  };
}
