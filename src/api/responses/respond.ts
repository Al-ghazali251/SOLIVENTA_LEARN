import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Bindings } from '../../config/bindings';
import type { AppVariables } from '../../types/context';
import type { ErrorCode } from '../../errors/app-error';
import type { ErrorResponse, SuccessResponse } from './model';

type AppContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export function success<T, S extends ContentfulStatusCode = 200>(
  context: AppContext,
  data: T,
  status: S = 200 as S,
) {
  const body: SuccessResponse<T> = {
    data,
    meta: { requestId: context.get('requestId') },
  };
  return context.json(body, status);
}

export function failure<S extends ContentfulStatusCode>(
  context: AppContext,
  options: {
    code: ErrorCode;
    message: string;
    status: S;
    details?: Readonly<Record<string, unknown>>;
  },
) {
  const body: ErrorResponse = {
    error: {
      code: options.code,
      message: options.message,
      requestId: context.get('requestId'),
      ...(options.details ? { details: options.details } : {}),
    },
  };
  return context.json(body, options.status);
}
