import { GenerationRetryError } from '../integrations/openrouter/lesson-generator';
import type { Bindings } from '../config/bindings';
import type {
  DomainDirectoryGateway,
  CustomHostnameProvider,
} from '../services/domain-provisioning.service';
import type { JobGateway } from '../services/background-jobs.service';
import { JobEnvelopeSchema, PermanentJobError, type JobEnvelope } from './model';
import { invalidateTenantCache } from '../tenant/cache';

export class JobProcessor {
  constructor(
    private readonly jobs: JobGateway,
    private readonly domains: DomainDirectoryGateway,
    private readonly provider: CustomHostnameProvider,
    private readonly generate?: (bindings: Bindings, envelope: JobEnvelope) => Promise<void>,
  ) {}
  private async execute(bindings: Bindings, envelope: JobEnvelope) {
    if (envelope.operation === 'lesson.generate') {
      if (!this.generate)
        throw new PermanentJobError('AI_NOT_CONFIGURED', 'Lesson generation is unavailable.');
      await this.generate(bindings, envelope);
      return;
    }
    if (envelope.operation === 'domain.verify') {
      const domain = (await this.domains.list(bindings, envelope.tenantId)).find(
        (item) => item.id === envelope.resource.id,
      );
      if (!domain || domain.domainKind !== 'custom' || !domain.providerHostnameId)
        throw new PermanentJobError('DOMAIN_NOT_FOUND', 'The custom domain no longer exists.');
      const provider = await this.provider.get(bindings, domain.providerHostnameId);
      await this.domains.updateProviderStateAsSystem(bindings, {
        schoolId: envelope.tenantId,
        domainId: domain.id,
        provider,
      });
      await invalidateTenantCache(bindings, [domain.hostname], envelope.tenantId);
      return;
    }
    // Local platform hostnames are not publicly reachable over HTTPS. Cache
    // warming is an edge concern; publication has already invalidated local KV.
    if (bindings.APP_ENV === 'development') return;
    const domains = (await this.domains.list(bindings, envelope.tenantId)).filter(
      (item) => item.status === 'active' && item.domainType === 'public_site',
    );
    const results = await Promise.allSettled(
      domains.flatMap((domain) =>
        ['/', '/about/'].map((path) =>
          fetch(`https://${domain.hostname}${path}`, {
            headers: { 'X-Soliventa-Prewarm': 'background-job' },
          }).then((response) => {
            if (!response.ok) throw new Error(`warm failed ${response.status}`);
          }),
        ),
      ),
    );
    if (results.some((item) => item.status === 'rejected'))
      throw new Error('One or more cache-warming requests failed.');
  }
  async process(bindings: Bindings, value: unknown, deliveryAttempt: number) {
    const envelope = JobEnvelopeSchema.parse(value);
    const attempt = Math.min(20, Math.max(1, deliveryAttempt));
    if ((await this.jobs.start(bindings, envelope, attempt)) === 'already-complete')
      return { envelope, status: 'duplicate' as const };
    try {
      await this.execute(bindings, envelope);
      await this.jobs.succeed(bindings, envelope, attempt);
      return { envelope, status: 'succeeded' as const };
    } catch (error: unknown) {
      const permanent = error instanceof PermanentJobError;
      const known = permanent || error instanceof GenerationRetryError;
      const code = known ? error.code : 'TRANSIENT_FAILURE';
      const message = known ? error.message : 'The operation failed and will be retried.';
      await this.jobs.fail(bindings, envelope, attempt, { code, message, retry: !permanent });
      if (permanent) return { envelope, status: 'failed' as const };
      throw error;
    }
  }
  async deadLetter(bindings: Bindings, value: unknown, deliveryAttempt: number) {
    const envelope = JobEnvelopeSchema.parse(value);
    await this.jobs.deadLetter(bindings, envelope, Math.min(20, Math.max(1, deliveryAttempt)), {
      code: 'MAX_RETRIES_EXCEEDED',
      message: 'The operation exhausted its retry allowance.',
    });
    return envelope;
  }
}
