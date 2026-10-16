import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { hostnameFromOrigin } from '../tenant/hostname';
import type { AppVariables } from '../types/context';
import type { TenantDirectory } from '../services/contracts';

function configuredOrigins(bindings: Bindings): Set<string> {
  return new Set(
    [bindings.APP_ORIGIN, bindings.PORTAL_ORIGIN]
      .filter((origin): origin is string => Boolean(origin))
      .map((origin) => new URL(origin).origin),
  );
}

async function isAllowedOrigin(
  bindings: Bindings,
  directory: TenantDirectory,
  origin: string,
  requestHostname: string,
): Promise<boolean> {
  if (configuredOrigins(bindings).has(new URL(origin).origin)) return true;
  const hostname = hostnameFromOrigin(origin);
  if (hostname !== requestHostname) return false;
  return (await directory.findActiveByHostname(bindings, hostname)) !== null;
}

export const corsMiddleware =
  (
    directory: TenantDirectory,
  ): MiddlewareHandler<{
    Bindings: Bindings;
    Variables: AppVariables;
  }> =>
  async (context, next) => {
    const origin = context.req.header('Origin');
    if (!origin) {
      await next();
      return;
    }

    if (!(await isAllowedOrigin(context.env, directory, origin, context.get('requestHostname')))) {
      throw new AppError({
        code: 'CORS_ORIGIN_DENIED',
        message: 'The request origin is not allowed.',
        status: 403,
      });
    }

    context.header('Access-Control-Allow-Origin', new URL(origin).origin);
    context.header('Access-Control-Allow-Credentials', 'true');
    context.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Support-Session');
    context.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    context.header('Access-Control-Max-Age', '600');
    context.header('Vary', 'Origin');

    if (context.req.method === 'OPTIONS') {
      return context.body(null, 204);
    }
    await next();
  };
