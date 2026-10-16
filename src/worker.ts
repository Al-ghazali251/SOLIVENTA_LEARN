import { adminGateway } from './integrations/supabase/admin-client';
import { GenerationRetryError } from './integrations/openrouter/lesson-generator';
import { app } from './app';
import type { Bindings } from './config/bindings';
import { defaultServices } from './services/default-services';
import { DomainLifecycleService } from './services/domain-provisioning.service';
import { cloudflareCustomHostnames } from './integrations/cloudflare/custom-hostnames';
import { JobProcessor } from './jobs/processor';
import { errorCode, recordMetric, structuredLog } from './observability/telemetry';

export default {
  fetch(request: Request, env: Bindings, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4) || '/';
      request = new Request(url, request);
    }
    return app.fetch(request, env, context);
  },
  scheduled(_event: ScheduledEvent, env: Bindings, context: ExecutionContext) {
    const service = new DomainLifecycleService(
      defaultServices.domainDirectory,
      cloudflareCustomHostnames,
    );
    context.waitUntil(
      service
        .reconcile(env)
        .then((result) => {
          structuredLog('info', {
            type: 'domain_reconciliation',
            environment: env.APP_ENV,
            outcome: 'succeeded',
          });
          recordMetric(env, {
            type: 'domain_reconciliation',
            environment: env.APP_ENV,
            outcome: 'succeeded',
            value: result.checked,
          });
        })
        .catch((error: unknown) => {
          structuredLog('error', {
            type: 'domain_reconciliation',
            environment: env.APP_ENV,
            outcome: 'failed',
            errorCode: errorCode(error),
          });
          recordMetric(env, {
            type: 'domain_reconciliation',
            environment: env.APP_ENV,
            outcome: 'failed',
            errorCode: errorCode(error),
          });
        }),
    );
  },
  async queue(batch: MessageBatch, env: Bindings) {
    const processor = new JobProcessor(
      defaultServices.jobs,
      defaultServices.domainDirectory,
      cloudflareCustomHostnames,
      adminGateway.processLessonGeneration,
    );
    for (const message of batch.messages) {
      try {
        if (batch.queue === 'soliventa-learn-jobs-dlq') {
          const envelope = await processor.deadLetter(env, message.body, message.attempts);
          message.ack();
          structuredLog('error', {
            type: 'job_dead_lettered',
            traceId: envelope.traceId,
            environment: env.APP_ENV,
            schoolId: envelope.tenantId,
            jobId: envelope.jobId,
            operation: envelope.operation,
            attempt: message.attempts,
            outcome: 'dead_lettered',
            errorCode: 'MAX_RETRIES_EXCEEDED',
          });
          recordMetric(env, {
            type: 'background_job',
            schoolId: envelope.tenantId,
            environment: env.APP_ENV,
            operation: envelope.operation,
            outcome: 'dead_lettered',
            errorCode: 'MAX_RETRIES_EXCEEDED',
          });
          continue;
        }
        const result = await processor.process(env, message.body, message.attempts);
        message.ack();
        structuredLog('info', {
          type: 'job_processed',
          traceId: result.envelope.traceId,
          environment: env.APP_ENV,
          schoolId: result.envelope.tenantId,
          jobId: result.envelope.jobId,
          operation: result.envelope.operation,
          attempt: message.attempts,
          outcome: result.status,
        });
        recordMetric(env, {
          type: 'background_job',
          schoolId: result.envelope.tenantId,
          environment: env.APP_ENV,
          operation: result.envelope.operation,
          outcome: result.status,
        });
      } catch (error: unknown) {
        structuredLog('warn', {
          type: 'job_retry',
          environment: env.APP_ENV,
          attempt: message.attempts,
          outcome: 'retrying',
          errorCode: errorCode(error),
        });
        recordMetric(env, {
          type: 'background_job',
          environment: env.APP_ENV,
          outcome: 'retrying',
          errorCode: errorCode(error),
        });
        message.retry({
          delaySeconds:
            error instanceof GenerationRetryError
              ? error.delaySeconds
              : Math.min(900, 30 * Math.max(1, message.attempts)),
        });
      }
    }
  },
};
