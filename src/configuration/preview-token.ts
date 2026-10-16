import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const fromBase64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

export async function issuePreviewToken(
  bindings: Bindings,
  input: { schoolId: string; versionId: string; actorId: string; ttlSeconds?: number },
) {
  if (!bindings.PREVIEW_TOKEN_SECRET || bindings.PREVIEW_TOKEN_SECRET.length < 32)
    throw new AppError({
      code: 'SERVICE_NOT_READY',
      message: 'Preview is unavailable.',
      status: 503,
    });
  const expiresAt = Math.floor(Date.now() / 1000) + Math.min(input.ttlSeconds ?? 600, 900);
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        schoolId: input.schoolId,
        versionId: input.versionId,
        actorId: input.actorId,
        expiresAt,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(bindings.PREVIEW_TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = base64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))),
  );
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function verifyPreviewToken(
  bindings: Bindings,
  token: string,
  expected: { schoolId: string; versionId: string },
) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !bindings.PREVIEW_TOKEN_SECRET)
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'Preview link is invalid or expired.',
      status: 401,
    });
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(bindings.PREVIEW_TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromBase64url(signature),
    encoder.encode(payload),
  );
  if (!valid)
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'Preview link is invalid or expired.',
      status: 401,
    });
  const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
    schoolId?: string;
    versionId?: string;
    expiresAt?: number;
  };
  if (
    data.schoolId !== expected.schoolId ||
    data.versionId !== expected.versionId ||
    !data.expiresAt ||
    data.expiresAt < Math.floor(Date.now() / 1000)
  )
    throw new AppError({
      code: 'UNAUTHORIZED',
      message: 'Preview link is invalid or expired.',
      status: 401,
    });
  return data;
}
