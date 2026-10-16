import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { initializePaystack, verifyPaystack } from '../integrations/paystack/client';
import { assertPermission } from '../permissions/authorize';
import type { AuthContext } from '../types/context';

export type PaymentTransaction = Readonly<{
  id: string;
  schoolId: string;
  invoiceId: string;
  studentId: string;
  reference: string;
  email: string;
  amountMinor: number;
  currency: string;
  status: string;
}>;

export interface PaymentGateway {
  verifyReceipt(
    bindings: Bindings,
    input: { schoolId: string; receiptId: string },
  ): Promise<null | {
    receiptNumber: string;
    schoolName: string;
    studentName: string;
    feeName: string;
    amountMinor: number;
    currency: string;
    issuedAt: string;
    provider: string;
    reference: string;
    installmentNumber: number;
    maximumInstallments: number;
    balanceAfterMinor: number;
    totalPaidMinor: number;
  }>;
  canInitiate(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      invoiceId: string;
      scope: AuthContext['scope']['kind'];
    },
  ): Promise<boolean>;
  prepare(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      invoiceId: string;
      email: string;
      amountMinor?: number | undefined;
    },
  ): Promise<PaymentTransaction>;
  attachAuthorization(
    bindings: Bindings,
    transactionId: string,
    authorizationUrl: string,
  ): Promise<void>;
  findByReference(bindings: Bindings, reference: string): Promise<PaymentTransaction | null>;
  settle(
    bindings: Bindings,
    input: { transaction: PaymentTransaction; paidAt: string },
  ): Promise<void>;
  fail(bindings: Bindings, transactionId: string, status: 'failed' | 'abandoned'): Promise<void>;
  submitManual(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      invoiceId: string;
      amountMinor: number;
      bankName: string;
      accountName: string;
      transferReference: string;
      transferredAt: string;
      evidencePath?: string | undefined;
    },
  ): Promise<Record<string, unknown>>;
  reviewManual(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      submissionId: string;
      decision: 'verified' | 'rejected';
      note?: string | undefined;
    },
  ): Promise<Record<string, unknown>>;
}

export class PaymentService {
  constructor(private readonly gateway: PaymentGateway) {}

  verifyReceipt(bindings: Bindings, schoolId: string, receiptId: string) {
    return this.gateway.verifyReceipt(bindings, { schoolId, receiptId });
  }

  async initialize(
    bindings: Bindings,
    auth: AuthContext,
    input: {
      invoiceId: string;
      email: string;
      callbackUrl: string;
      amountMinor?: number | undefined;
    },
  ) {
    assertPermission(auth, 'fees.read');
    if (
      !(await this.gateway.canInitiate(bindings, {
        schoolId: auth.schoolId,
        actorId: auth.userId,
        invoiceId: input.invoiceId,
        scope: auth.scope.kind,
      }))
    )
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You cannot pay this invoice.',
        status: 403,
      });
    const transaction = await this.gateway.prepare(bindings, {
      schoolId: auth.schoolId,
      actorId: auth.userId,
      invoiceId: input.invoiceId,
      email: input.email,
      ...(input.amountMinor ? { amountMinor: input.amountMinor } : {}),
    });
    const initialized = await initializePaystack(bindings.PAYSTACK_SECRET_KEY, {
      email: transaction.email,
      amountMinor: transaction.amountMinor,
      reference: transaction.reference,
      callbackUrl: input.callbackUrl,
      metadata: { transactionId: transaction.id },
    });
    await this.gateway.attachAuthorization(bindings, transaction.id, initialized.authorizationUrl);
    return initialized;
  }

  async verify(
    bindings: Bindings,
    reference: string,
    auth?: AuthContext,
  ): Promise<{ reference: string; status: 'initialized' | 'successful' | 'failed' | 'abandoned' }> {
    const transaction = await this.gateway.findByReference(bindings, reference);
    if (!transaction)
      throw new AppError({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.', status: 404 });
    if (
      auth &&
      (auth.schoolId !== transaction.schoolId ||
        !(await this.gateway.canInitiate(bindings, {
          schoolId: auth.schoolId,
          actorId: auth.userId,
          invoiceId: transaction.invoiceId,
          scope: auth.scope.kind,
        })))
    )
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You cannot verify this payment.',
        status: 403,
      });
    if (transaction.status === 'successful') return { reference, status: 'successful' as const };
    if (transaction.status === 'failed' || transaction.status === 'abandoned')
      return { reference, status: transaction.status };
    const provider = await verifyPaystack(bindings.PAYSTACK_SECRET_KEY, reference);
    if (provider.status !== 'success') {
      if (provider.status === 'abandoned' || provider.status === 'failed') {
        await this.gateway.fail(bindings, transaction.id, provider.status);
        return { reference, status: provider.status };
      }
      return { reference, status: 'initialized' };
    }
    if (
      provider.amountMinor !== transaction.amountMinor ||
      provider.currency !== transaction.currency
    )
      throw new AppError({
        code: 'PAYMENT_MISMATCH',
        message: 'Payment details did not match the invoice.',
        status: 409,
      });
    await this.gateway.settle(bindings, {
      transaction,
      paidAt: provider.paidAt ?? new Date().toISOString(),
    });
    return { reference, status: 'successful' as const };
  }

  async submitManual(
    bindings: Bindings,
    auth: AuthContext,
    input: {
      invoiceId: string;
      amountMinor: number;
      bankName: string;
      accountName: string;
      transferReference: string;
      transferredAt: string;
      evidencePath?: string | undefined;
    },
  ) {
    assertPermission(auth, 'fees.read');
    if (
      !(await this.gateway.canInitiate(bindings, {
        schoolId: auth.schoolId,
        actorId: auth.userId,
        invoiceId: input.invoiceId,
        scope: auth.scope.kind,
      }))
    )
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You cannot pay this invoice.',
        status: 403,
      });
    return this.gateway.submitManual(bindings, {
      schoolId: auth.schoolId,
      actorId: auth.userId,
      ...input,
    });
  }

  async reviewManual(
    bindings: Bindings,
    auth: AuthContext,
    input: { submissionId: string; decision: 'verified' | 'rejected'; note?: string | undefined },
  ) {
    assertPermission(auth, 'payments.verify');
    return this.gateway.reviewManual(bindings, {
      schoolId: auth.schoolId,
      actorId: auth.userId,
      ...input,
    });
  }
}
