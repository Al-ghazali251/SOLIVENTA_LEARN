import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import type { AppVariables } from '../types/context';
import { normalizedRoute, recordMetric, structuredLog } from '../observability/telemetry';

export const loggingMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (context, next) => {
  const startedAt = Date.now();
  await next();
  const tenant = context.get('tenant') as AppVariables['tenant'] | undefined;
  const principal = context.get('principal') as AppVariables['principal'] | undefined;
  const fields = {
    type: 'http_request',
    requestId: context.get('requestId'),
    environment: context.env.APP_ENV,
    method: context.req.method,
    route: normalizedRoute(context.req.path),
    hostname: context.get('requestHostname'),
    schoolId: tenant?.schoolId,
    userId: principal?.userId,
    status: context.res.status,
    durationMs: Date.now() - startedAt,
    errorCode: context.get('errorCode'),
  };
  structuredLog(
    context.res.status >= 500 ? 'error' : context.res.status >= 400 ? 'warn' : 'info',
    fields,
  );
  recordMetric(context.env, {
    type: 'http_request',
    environment: context.env.APP_ENV,
    schoolId: tenant?.schoolId,
    hostname: context.get('requestHostname'),
    route: fields.route,
    method: context.req.method,
    status: context.res.status,
    durationMs: fields.durationMs,
    errorCode: fields.errorCode,
    outcome: context.res.status < 400 ? 'success' : 'failure',
  });
};
