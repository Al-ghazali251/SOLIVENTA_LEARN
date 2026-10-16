export type ErrorCode =
  | 'BAD_REQUEST'
  | 'CORS_ORIGIN_DENIED'
  | 'FORBIDDEN'
  | 'FEATURE_NOT_ENTITLED'
  | 'INTERNAL_ERROR'
  | 'INVALID_HOSTNAME'
  | 'NOT_FOUND'
  | 'INVOICE_ALREADY_PAID'
  | 'INVALID_WEBHOOK_SIGNATURE'
  | 'PAYMENT_MISMATCH'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'SERVICE_NOT_READY'
  | 'SUPPORT_SESSION_INVALID'
  | 'TENANT_NOT_FOUND'
  | 'UNAUTHORIZED';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: {
    code: ErrorCode;
    message: string;
    status: AppError['status'];
    cause?: unknown;
    details?: Readonly<Record<string, unknown>>;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status;
    if (options.details) this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
