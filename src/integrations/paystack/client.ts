import { AppError } from '../../errors/app-error';

type PaystackEnvelope<T> = { status: boolean; message: string; data: T };

export type InitializedTransaction = Readonly<{
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}>;

export type VerifiedTransaction = Readonly<{
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  customerEmail: string;
  metadata: Record<string, unknown>;
}>;

function secret(value: string | undefined) {
  if (!value?.startsWith('sk_test_') && !value?.startsWith('sk_live_'))
    throw new AppError({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      message: 'Online payment is not configured.',
      status: 503,
    });
  return value;
}

async function request<T>(key: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body: PaystackEnvelope<T> = await response.json();
  if (!response.ok || !body.status)
    throw new AppError({
      code: 'PAYMENT_PROVIDER_ERROR',
      message: 'The payment provider could not complete the request.',
      status: 502,
    });
  return body.data;
}

export async function initializePaystack(
  keyValue: string | undefined,
  input: {
    email: string;
    amountMinor: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
  },
): Promise<InitializedTransaction> {
  const data = await request<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>(secret(keyValue), '/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email,
      amount: String(input.amountMinor),
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

export async function verifyPaystack(
  keyValue: string | undefined,
  reference: string,
): Promise<VerifiedTransaction> {
  const data = await request<{
    reference: string;
    status: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    customer: { email: string };
    metadata?: Record<string, unknown>;
  }>(secret(keyValue), `/transaction/verify/${encodeURIComponent(reference)}`);
  return {
    reference: data.reference,
    status: data.status,
    amountMinor: data.amount,
    currency: data.currency,
    paidAt: data.paid_at,
    customerEmail: data.customer.email,
    metadata: data.metadata ?? {},
  };
}

export async function verifyPaystackSignature(
  keyValue: string | undefined,
  rawBody: string,
  signature: string | undefined,
) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret(keyValue)),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}
