import { z } from 'zod';

export const JobOperationSchema = z.enum(['domain.verify', 'cache.warm', 'lesson.generate']);
export const JobEnvelopeSchema = z.object({
  jobId: z.string().uuid(),
  tenantId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  traceId: z.string().startsWith('req_').max(132),
  operation: JobOperationSchema,
  idempotencyKey: z.string().min(16).max(128),
  attemptCount: z.number().int().min(0),
  // PostgREST serializes timestamptz values with an explicit `+00:00` offset,
  // while JavaScript commonly emits `Z`. Both are valid RFC 3339 timestamps.
  createdAt: z.string().datetime({ offset: true }),
  resource: z.object({
    type: z.enum(['tenant_domain', 'tenant_configuration', 'lesson_generation']),
    id: z.string().min(1).max(200),
  }),
});
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export type JobOperation = z.infer<typeof JobOperationSchema>;
export type JobSummary = Readonly<{
  id: string;
  schoolId: string;
  actorId: string | null;
  traceId: string;
  operation: JobOperation;
  status: 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'dead_lettered';
  attemptCount: number;
  resourceType: string | null;
  resourceId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}>;

export class PermanentJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PermanentJobError';
    this.code = code;
  }
}
