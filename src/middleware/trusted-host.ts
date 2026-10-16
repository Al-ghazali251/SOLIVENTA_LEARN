import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { hostnameFromRequest, normalizeHostname } from '../tenant/hostname';
import type { AppVariables } from '../types/context';

const tenantHostHeader = 'x-soliventa-tenant-host';

export const trustedHostMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (context, next) => {
  const requestHostname = hostnameFromRequest(context.req.raw);
  const platformHostnames = new Set(
    (context.env.PLATFORM_HOSTNAMES ?? '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
  const tenantHostname = context.req.header(tenantHostHeader);
  context.set(
    'requestHostname',
    tenantHostname && platformHostnames.has(requestHostname)
      ? normalizeHostname(tenantHostname)
      : requestHostname,
  );
  await next();
};
