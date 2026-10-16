import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import type { AuthContext } from '../types/context';
import {
  JobEnvelopeSchema,
  type JobEnvelope,
  type JobOperation,
  type JobSummary,
} from '../jobs/model';

export interface JobGateway {
  create(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string | null;
      traceId: string;
      operation: JobOperation;
      idempotencyKey: string;
      resourceType: string;
      resourceId: string;
      payloadDigest: string;
    },
  ): Promise<{ job: JobSummary; created: boolean }>;
  get(bindings: Bindings, schoolId: string, jobId: string): Promise<JobSummary | null>;
  start(
    bindings: Bindings,
    envelope: JobEnvelope,
    attempt: number,
  ): Promise<'run' | 'already-complete'>;
  succeed(bindings: Bindings, envelope: JobEnvelope, attempt: number): Promise<void>;
  fail(
    bindings: Bindings,
    envelope: JobEnvelope,
    attempt: number,
    error: { code: string; message: string; retry: boolean },
  ): Promise<void>;
  deadLetter(
    bindings: Bindings,
    envelope: JobEnvelope,
    attempt: number,
    error: { code: string; message: string },
  ): Promise<void>;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export class BackgroundJobService {
  constructor(private readonly gateway: JobGateway) {}
  async enqueue(
    bindings: Bindings,
    context: AuthContext,
    input: {
      traceId: string;
      operation: JobOperation;
      idempotencyKey: string;
      resource: {
        type: 'tenant_domain' | 'tenant_configuration' | 'lesson_generation';
        id: string;
      };
    },
  ) {
    if (!bindings.JOB_QUEUE)
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'Background processing is unavailable.',
        status: 503,
      });
    const payloadDigest = await sha256(
      JSON.stringify({ operation: input.operation, resource: input.resource }),
    );
    const result = await this.gateway.create(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      traceId: input.traceId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      resourceType: input.resource.type,
      resourceId: input.resource.id,
      payloadDigest,
    });
    if (result.created) {
      const envelope = JobEnvelopeSchema.parse({
        jobId: result.job.id,
        tenantId: context.schoolId,
        actorId: context.userId,
        traceId: input.traceId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        attemptCount: 0,
        createdAt: result.job.createdAt,
        resource: input.resource,
      });
      try {
        await bindings.JOB_QUEUE.send(envelope);
      } catch (cause) {
        await this.gateway.fail(bindings, envelope, 1, {
          code: 'QUEUE_SEND_FAILED',
          message: 'The job could not be queued.',
          retry: false,
        });
        throw new AppError({
          code: 'SERVICE_NOT_READY',
          message: 'Background processing is unavailable.',
          status: 503,
          cause,
        });
      }
    }
    return result.job;
  }
  async get(bindings: Bindings, context: AuthContext, jobId: string) {
    const job = await this.gateway.get(bindings, context.schoolId, jobId);
    if (!job) throw new AppError({ code: 'NOT_FOUND', message: 'Job not found.', status: 404 });
    if (
      job.actorId !== context.userId &&
      !context.permissions.has('domains.manage') &&
      !context.permissions.has('school.configure')
    )
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You do not have permission to view this job.',
        status: 403,
      });
    return job;
  }
}
