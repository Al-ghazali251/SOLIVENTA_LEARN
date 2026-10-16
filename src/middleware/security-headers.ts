import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import type { AppVariables } from '../types/context';

export const securityHeadersMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (context, next) => {
  await next();
  context.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  context.header('Referrer-Policy', 'no-referrer');
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('X-Frame-Options', 'DENY');
  context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  context.header('Cross-Origin-Resource-Policy', 'same-site');
  context.header('Cache-Control', 'no-store');
};
