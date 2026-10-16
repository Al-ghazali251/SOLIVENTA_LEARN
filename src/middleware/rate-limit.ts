import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import type { AppVariables } from '../types/context';

export const rateLimitMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: AppVariables;
}> = async (context, next) => {
  if (context.req.path.startsWith('/health/')) {
    await next();
    return;
  }

  const limiter = context.env.RATE_LIMITER;
  if (!limiter) {
    if (context.env.APP_ENV === 'production') {
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'A required service is unavailable.',
        status: 503,
      });
    }
    await next();
    return;
  }

  // CF-Connecting-IP is supplied by Cloudflare at the edge. Forwarded-for is ignored.
  const clientAddress = context.req.header('CF-Connecting-IP') ?? 'development-client';
  const result = await limiter.limit({
    key: `${context.get('requestHostname')}:${clientAddress}:${context.req.path}`,
  });
  if (!result.success) {
    context.header('Retry-After', '60');
    throw new AppError({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again later.',
      status: 429,
    });
  }
  await next();
};
