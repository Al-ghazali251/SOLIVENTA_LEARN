import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import type { TokenVerifier } from '../services/contracts';
import type { AppVariables } from '../types/context';

export function authenticationMiddleware(
  verifier: TokenVerifier,
): MiddlewareHandler<{ Bindings: Bindings; Variables: AppVariables }> {
  return async (context, next) => {
    const authorization = context.req.header('Authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match?.[1]) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        message: 'A valid bearer token is required.',
        status: 401,
      });
    }
    const verified = await verifier.verify(context.env, match[1]);
    context.set('principal', Object.freeze({ userId: verified.userId, token: match[1] }));
    await next();
  };
}
