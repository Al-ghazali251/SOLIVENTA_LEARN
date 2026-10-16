import { AppError } from '../errors/app-error';

const hostnamePattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, '');
  let hostname: string;
  try {
    hostname = new URL(`http://${trimmed}`).hostname;
  } catch (cause) {
    throw new AppError({
      code: 'INVALID_HOSTNAME',
      message: 'The request hostname is invalid.',
      status: 400,
      cause,
    });
  }

  if (!hostnamePattern.test(hostname) || hostname.includes('..')) {
    throw new AppError({
      code: 'INVALID_HOSTNAME',
      message: 'The request hostname is invalid.',
      status: 400,
    });
  }
  return hostname;
}

export function hostnameFromRequest(request: Request): string {
  // Cloudflare constructs request.url from the route that received the request. Forwarded-host
  // headers are intentionally ignored because clients can forge them.
  return normalizeHostname(new URL(request.url).hostname);
}

export function hostnameFromOrigin(origin: string): string {
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError({
      code: 'CORS_ORIGIN_DENIED',
      message: 'The request origin is not allowed.',
      status: 403,
      cause,
    });
  }
}
