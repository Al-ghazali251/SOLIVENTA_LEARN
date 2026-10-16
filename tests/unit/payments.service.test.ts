import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PaymentService,
  type PaymentGateway,
  type PaymentTransaction,
} from '../../src/services/payments.service';
import { verifyPaystackSignature } from '../../src/integrations/paystack/client';
import { validateInstallmentAmount } from '../../src/integrations/supabase/admin-client';
import type { Bindings } from '../../src/config/bindings';
import type { AuthContext } from '../../src/types/context';

const transaction: PaymentTransaction = {
  id: '48d18c6e-43a8-49f2-83cc-dbbf391c11a8',
  schoolId: 'school-a',
  invoiceId: 'invoice-a',
  studentId: 'student-a',
  reference: 'slv_reference_123',
  email: 'payer@example.test',
  amountMinor: 125000,
  currency: 'NGN',
  status: 'initialized',
};
const bindings = { PAYSTACK_SECRET_KEY: 'sk_test_example' } as Bindings;
const auth = {
  userId: 'actor-a',
  schoolId: 'school-a',
  roles: new Set(['bursar']),
  permissions: new Set(['fees.read', 'fees.manage', 'payments.verify']),
  scope: { kind: 'school-wide' },
} as unknown as AuthContext;

function gateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    verifyReceipt: vi.fn().mockResolvedValue(null),
    canInitiate: vi.fn().mockResolvedValue(true),
    prepare: vi.fn().mockResolvedValue(transaction),
    attachAuthorization: vi.fn().mockResolvedValue(undefined),
    findByReference: vi.fn().mockResolvedValue(transaction),
    settle: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    submitManual: vi.fn().mockResolvedValue({ id: 'transfer-a' }),
    reviewManual: vi.fn().mockResolvedValue({ id: 'transfer-a' }),
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Paystack payments', () => {
  it('enforces minimum and final installment amounts', () => {
    const policy = {
      netMinor: 100_000,
      outstandingMinor: 75_000,
      paymentCount: 1,
      installmentsAllowed: true,
      minimumPercent: 25,
      maximumInstallments: 3,
    };
    expect(() => validateInstallmentAmount({ ...policy, amountMinor: 20_000 })).toThrow(
      'minimum installment',
    );
    expect(() => validateInstallmentAmount({ ...policy, amountMinor: 25_000 })).not.toThrow();
    expect(() =>
      validateInstallmentAmount({ ...policy, paymentCount: 2, amountMinor: 25_000 }),
    ).toThrow('final installment');
    expect(() =>
      validateInstallmentAmount({ ...policy, paymentCount: 2, amountMinor: 75_000 }),
    ).not.toThrow();
  });

  it('initializes only the server-calculated outstanding amount', async () => {
    let sentBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? init.body : '';
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: true,
              message: 'ok',
              data: {
                authorization_url: 'https://checkout.paystack.com/code',
                access_code: 'code',
                reference: transaction.reference,
              },
            }),
            { status: 200 },
          ),
        );
      }),
    );
    const store = gateway();
    const result = await new PaymentService(store).initialize(bindings, auth, {
      invoiceId: transaction.invoiceId,
      email: transaction.email,
      callbackUrl: 'https://portal.example.test/payments/callback',
    });
    expect(result.reference).toBe(transaction.reference);
    const body = JSON.parse(sentBody) as { amount: string; metadata: Record<string, string> };
    expect(body.amount).toBe('125000');
    expect(body.metadata).toEqual({ transactionId: transaction.id });
  });

  it('rejects a provider amount mismatch without settling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: true,
            message: 'ok',
            data: {
              reference: transaction.reference,
              status: 'success',
              amount: 1,
              currency: 'NGN',
              paid_at: new Date().toISOString(),
              customer: { email: transaction.email },
              metadata: {},
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const settle = vi.fn().mockResolvedValue(undefined);
    const store = gateway({ settle });
    await expect(
      new PaymentService(store).verify(bindings, transaction.reference),
    ).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    expect(settle).not.toHaveBeenCalled();
  });

  it('is idempotent once the local transaction is successful', async () => {
    const settle = vi.fn().mockResolvedValue(undefined);
    const store = gateway({
      findByReference: vi.fn().mockResolvedValue({ ...transaction, status: 'successful' }),
      settle,
    });
    const result = await new PaymentService(store).verify(bindings, transaction.reference);
    expect(result.status).toBe('successful');
    expect(settle).not.toHaveBeenCalled();
  });

  it('validates Paystack webhook HMAC signatures', async () => {
    const body = '{"event":"charge.success"}';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('sk_test_example'),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    const signature = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    await expect(verifyPaystackSignature('sk_test_example', body, signature)).resolves.toBe(true);
    await expect(verifyPaystackSignature('sk_test_example', `${body}x`, signature)).resolves.toBe(
      false,
    );
  });
});
