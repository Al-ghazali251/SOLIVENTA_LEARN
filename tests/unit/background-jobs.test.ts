import { describe, expect, it, vi } from 'vitest';
import { BackgroundJobService, type JobGateway } from '../../src/services/background-jobs.service';
import type { Bindings } from '../../src/config/bindings';
import type { AuthContext } from '../../src/types/context';
import type { JobEnvelope, JobSummary } from '../../src/jobs/model';
import { JobProcessor } from '../../src/jobs/processor';
import type {
  DomainDirectoryGateway,
  CustomHostnameProvider,
} from '../../src/services/domain-provisioning.service';

const schoolId = '11111111-1111-4111-8111-111111111111',
  userId = '22222222-2222-4222-8222-222222222222',
  jobId = '33333333-3333-4333-8333-333333333333';
const auth: AuthContext = {
  userId,
  schoolId,
  roles: ['school_admin'],
  permissions: new Set(['domains.manage']),
  scope: { kind: 'school-wide' },
};
const summary: JobSummary = {
  id: jobId,
  schoolId,
  actorId: userId,
  traceId: 'req_test_trace_123',
  operation: 'domain.verify',
  status: 'queued',
  attemptCount: 0,
  resourceType: 'tenant_domain',
  resourceId: 'domain-id',
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: '2026-08-24T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
};
const noopGateway = (): JobGateway => ({
  create: vi.fn(),
  get: vi.fn(),
  start: vi.fn(),
  succeed: vi.fn(),
  fail: vi.fn(),
  deadLetter: vi.fn(),
});
const envelope = {
  jobId,
  tenantId: schoolId,
  actorId: userId,
  traceId: 'req_test_trace_123',
  operation: 'domain.verify',
  idempotencyKey: 'verify-domain-unique-1',
  attemptCount: 0,
  createdAt: '2026-08-24T00:00:00.000Z',
  resource: { type: 'tenant_domain', id: 'domain-id' },
} as const;

describe('background jobs', () => {
  it('dispatches lesson jobs and skips already completed deliveries', async () => {
    const jobs = noopGateway();
    const succeed = vi.fn().mockResolvedValue(undefined);
    jobs.succeed = succeed;
    jobs.start = vi.fn().mockResolvedValueOnce('run').mockResolvedValueOnce('already-complete');
    const generate = vi.fn().mockResolvedValue(undefined);
    const processor = new JobProcessor(
      jobs,
      {} as DomainDirectoryGateway,
      {} as CustomHostnameProvider,
      generate,
    );
    const lessonEnvelope = {
      ...envelope,
      operation: 'lesson.generate',
      resource: { type: 'lesson_generation', id: jobId },
    };
    await expect(processor.process({} as Bindings, lessonEnvelope, 1)).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(processor.process({} as Bindings, lessonEnvelope, 2)).resolves.toMatchObject({
      status: 'duplicate',
    });
    expect(generate).toHaveBeenCalledOnce();
    expect(succeed).toHaveBeenCalledOnce();
  });
  it('queues jobs whose PostgreSQL timestamp contains an explicit UTC offset', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const gateway = noopGateway();
    gateway.create = vi.fn().mockResolvedValue({
      job: { ...summary, createdAt: '2026-08-25T22:11:26.419404+00:00' },
      created: true,
    });
    await expect(
      new BackgroundJobService(gateway).enqueue(
        { JOB_QUEUE: { send } as unknown as Queue<JobEnvelope> } as Bindings,
        auth,
        {
          traceId: 'req_publish_regression_123',
          operation: 'cache.warm',
          idempotencyKey: 'cache-warm:publish:regression',
          resource: { type: 'tenant_configuration', id: jobId },
        },
      ),
    ).resolves.toMatchObject({ id: jobId });
    expect(send).toHaveBeenCalledOnce();
  });

  it('publishes only a newly-created idempotent job', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const gateway = noopGateway();
    gateway.create = vi.fn().mockResolvedValue({ job: summary, created: true });
    await new BackgroundJobService(gateway).enqueue(
      { JOB_QUEUE: { send } as unknown as Queue<JobEnvelope> } as Bindings,
      auth,
      {
        traceId: 'req_test_trace_123',
        operation: 'domain.verify',
        idempotencyKey: 'verify-domain-unique-1',
        resource: { type: 'tenant_domain', id: 'domain-id' },
      },
    );
    expect(send).toHaveBeenCalledOnce();
    gateway.create = vi.fn().mockResolvedValue({ job: summary, created: false });
    await new BackgroundJobService(gateway).enqueue(
      { JOB_QUEUE: { send } as unknown as Queue<JobEnvelope> } as Bindings,
      auth,
      {
        traceId: 'req_test_trace_123',
        operation: 'domain.verify',
        idempotencyKey: 'verify-domain-unique-1',
        resource: { type: 'tenant_domain', id: 'domain-id' },
      },
    );
    expect(send).toHaveBeenCalledOnce();
  });
  it('acknowledges an already completed duplicate without executing it', async () => {
    const gateway = noopGateway();
    const succeed = vi.fn();
    gateway.succeed = succeed;
    gateway.start = vi.fn().mockResolvedValue('already-complete');
    const result = await new JobProcessor(
      gateway,
      {} as DomainDirectoryGateway,
      {} as CustomHostnameProvider,
    ).process({} as Bindings, envelope, 2);
    expect(result.status).toBe('duplicate');
    expect(succeed).not.toHaveBeenCalled();
  });
  it('records permanent missing-domain failures without retrying', async () => {
    const gateway = noopGateway();
    gateway.start = vi.fn().mockResolvedValue('run');
    const fail = vi.fn().mockResolvedValue(undefined);
    gateway.fail = fail;
    const domains = { list: vi.fn().mockResolvedValue([]) } as unknown as DomainDirectoryGateway;
    const result = await new JobProcessor(gateway, domains, {} as CustomHostnameProvider).process(
      {} as Bindings,
      envelope,
      1,
    );
    expect(result.status).toBe('failed');
    expect(fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      1,
      expect.objectContaining({ code: 'DOMAIN_NOT_FOUND', retry: false }),
    );
  });
});
