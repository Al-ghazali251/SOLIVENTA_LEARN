import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import type { AppVariables } from '../types/context';

export const requestIdMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (context, next) => {
  const requestId = `req_${crypto.randomUUID().replaceAll('-', '')}`;
  context.set('requestId', requestId);
  await next();
  context.header('X-Request-Id', requestId);
};
