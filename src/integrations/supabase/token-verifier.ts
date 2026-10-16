import { z } from 'zod';
import type { Bindings } from '../../config/bindings';
import { AppError } from '../../errors/app-error';
import type { TokenVerifier } from '../../services/contracts';

// Supabase/Postgres accepts UUID-shaped fixture identifiers regardless of RFC
// version bits. Keep validation strict without rejecting deterministic local IDs.
const SubjectSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);

const decodeBase64Url = (value: string): ArrayBuffer => {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
};

const joseEcdsaSignatureToDer = (signature: ArrayBuffer): ArrayBuffer => {
  const bytes = new Uint8Array(signature);
  const integer = (part: Uint8Array): number[] => {
    let first = 0;
    while (first < part.length - 1 && part[first] === 0) first += 1;
    const value = Array.from(part.slice(first));
    if ((value[0] ?? 0) >= 0x80) value.unshift(0);
    return [0x02, value.length, ...value];
  };
  const r = integer(bytes.slice(0, 32));
  const s = integer(bytes.slice(32, 64));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]).buffer;
};

async function verifyLocalToken(
  token: string,
  secret: string | undefined,
  serializedJwk: string | undefined,
): Promise<string | undefined> {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as {
    alg?: unknown;
  };
  const algorithm =
    header.alg === 'ES256'
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'HMAC', hash: 'SHA-256' };
  if (header.alg !== 'ES256' && header.alg !== 'HS256') return undefined;
  if (header.alg === 'ES256' && !serializedJwk) return undefined;
  if (header.alg === 'HS256' && !secret) return undefined;
  const key =
    header.alg === 'ES256'
      ? await crypto.subtle.importKey(
          'jwk',
          JSON.parse(serializedJwk as string) as JsonWebKey,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        )
      : await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(secret as string),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['verify'],
        );
  const signature = decodeBase64Url(encodedSignature);
  let valid = await crypto.subtle.verify(
    algorithm,
    key,
    signature,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid && header.alg === 'ES256') {
    valid = await crypto.subtle.verify(
      algorithm,
      key,
      joseEcdsaSignatureToDer(signature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  }
  if (!valid) return undefined;
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as {
    exp?: unknown;
    sub?: unknown;
  };
  if (typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) return undefined;
  return SubjectSchema.safeParse(claims.sub).data;
}

export const supabaseTokenVerifier: TokenVerifier = {
  async verify(bindings: Bindings, token: string) {
    if (!bindings.SUPABASE_URL || !bindings.SUPABASE_PUBLISHABLE_KEY) {
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'A required service is unavailable.',
        status: 503,
      });
    }

    if (
      bindings.APP_ENV === 'development' &&
      (bindings.SUPABASE_JWT_SECRET || bindings.SUPABASE_JWT_JWK)
    ) {
      const userId = await verifyLocalToken(
        token,
        bindings.SUPABASE_JWT_SECRET,
        bindings.SUPABASE_JWT_JWK,
      );
      if (userId) return { userId };
      throw new AppError({
        code: 'UNAUTHORIZED',
        message: 'The access token is invalid or expired.',
        status: 401,
      });
    }

    // Validate with Auth itself instead of performing runtime-dependent local
    // JWT verification. This supports both local HS256 and hosted signing keys.
    const response = await fetch(`${bindings.SUPABASE_URL.replace(/\/$/u, '')}/auth/v1/user`, {
      headers: {
        apikey: bindings.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
      },
    });
    const payload: unknown = response.ok ? await response.json() : undefined;
    const parsed = SubjectSchema.safeParse(
      typeof payload === 'object' && payload !== null && 'id' in payload ? payload.id : undefined,
    );
    if (!response.ok || !parsed.success) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        message: 'The access token is invalid or expired.',
        status: 401,
      });
    }
    return { userId: parsed.data };
  },
};
