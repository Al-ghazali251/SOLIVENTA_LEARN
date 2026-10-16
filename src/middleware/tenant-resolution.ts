import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import type { TenantDirectory } from '../services/contracts';
import type { AppVariables } from '../types/context';
import { readDomainCache, writeDomainCache } from '../tenant/cache';

export function tenantResolutionMiddleware(
  directory: TenantDirectory,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  return async (context, next) => {
    const hostname = context.get('requestHostname');
    let tenant = await readDomainCache(context.env, hostname);
    if (tenant === undefined) {
      tenant = await directory.findActiveByHostname(context.env, hostname);
      await writeDomainCache(context.env, hostname, tenant);
    }
    if (!tenant) {
      throw new AppError({
        code: 'TENANT_NOT_FOUND',
        message: 'No active school is configured for this hostname.',
        status: 404,
      });
    }
    context.set('tenant', Object.freeze({ ...tenant }));
    await next();
  };
}
