import { z } from '@hono/zod-openapi';

export const ResponseMetaSchema = z.object({ requestId: z.string().min(1) });

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type SuccessResponse<T> = {
  data: T;
  meta: { requestId: string };
};

export type ErrorResponse = z.infer<typeof ApiErrorSchema>;
