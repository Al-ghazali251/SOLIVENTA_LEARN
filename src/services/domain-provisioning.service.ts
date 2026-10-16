import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import { normalizeCustomHostname, type DomainRecord } from '../domains/model';
import type { AuthContext } from '../types/context';
import type { CloudflareHostname } from '../integrations/cloudflare/custom-hostnames';
import { invalidateTenantCache } from '../tenant/cache';
import { recordMetric } from '../observability/telemetry';

export interface DomainDirectoryGateway {
  list(bindings: Bindings, schoolId: string): Promise<readonly DomainRecord[]>;
  provisionDefaults(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; baseDomain: string },
  ): Promise<readonly DomainRecord[]>;
  createCustom(
    bindings: Bindings,
    input: {
      schoolId: string;
      actorId: string;
      hostname: string;
      domainType: 'public_site' | 'portal';
      provider: CloudflareHostname;
      cnameTarget: string;
    },
  ): Promise<DomainRecord>;
  updateProviderState(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; domainId: string; provider: CloudflareHostname },
  ): Promise<DomainRecord>;
  setPrimary(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; domainId: string },
  ): Promise<DomainRecord>;
  markRemoved(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; domainId: string },
  ): Promise<{ domain: DomainRecord; providerHostnameId: string | null }>;
  reconciliationCandidates(
    bindings: Bindings,
    limit: number,
  ): Promise<
    readonly { schoolId: string; domainId: string; hostname: string; providerHostnameId: string }[]
  >;
  updateProviderStateAsSystem(
    bindings: Bindings,
    input: { schoolId: string; domainId: string; provider: CloudflareHostname },
  ): Promise<DomainRecord>;
}
export interface CustomHostnameProvider {
  create(bindings: Bindings, hostname: string, schoolId: string): Promise<CloudflareHostname>;
  get(bindings: Bindings, id: string): Promise<CloudflareHostname>;
  remove(bindings: Bindings, id: string): Promise<void>;
}

export class DomainLifecycleService {
  constructor(
    private readonly directory: DomainDirectoryGateway,
    private readonly provider: CustomHostnameProvider,
  ) {}
  private authorize(context: AuthContext) {
    assertSchoolScope(context, context.schoolId);
    assertPermission(context, 'domains.manage');
  }
  list(bindings: Bindings, context: AuthContext) {
    this.authorize(context);
    return this.directory.list(bindings, context.schoolId);
  }
  provisionDefaults(bindings: Bindings, context: AuthContext) {
    this.authorize(context);
    return this.directory.provisionDefaults(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      baseDomain: bindings.PLATFORM_BASE_DOMAIN ?? 'soliventa.localhost',
    });
  }
  async create(
    bindings: Bindings,
    context: AuthContext,
    input: { hostname: string; domainType: 'public_site' | 'portal' },
  ) {
    this.authorize(context);
    let hostname: string;
    try {
      hostname = normalizeCustomHostname(
        input.hostname,
        bindings.PLATFORM_BASE_DOMAIN ?? 'soliventa.localhost',
      );
    } catch (cause) {
      throw new AppError({
        code: 'INVALID_HOSTNAME',
        message: 'This hostname cannot be used as a custom domain.',
        status: 400,
        cause,
      });
    }
    const provider = await this.provider.create(bindings, hostname, context.schoolId);
    try {
      return await this.directory.createCustom(bindings, {
        schoolId: context.schoolId,
        actorId: context.userId,
        hostname,
        domainType: input.domainType,
        provider,
        cnameTarget:
          bindings.CLOUDFLARE_SAAS_TARGET ??
          `customers.${bindings.PLATFORM_BASE_DOMAIN ?? 'soliventa.localhost'}`,
      });
    } catch (error) {
      await this.provider.remove(bindings, provider.id).catch(() => undefined);
      throw error;
    }
  }
  async refresh(bindings: Bindings, context: AuthContext, domainId: string) {
    this.authorize(context);
    const domains = await this.directory.list(bindings, context.schoolId);
    const domain = domains.find((item) => item.id === domainId);
    if (!domain || domain.domainKind !== 'custom')
      throw new AppError({ code: 'NOT_FOUND', message: 'Custom domain not found.', status: 404 });
    if (!domain.providerHostnameId)
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'Custom domain provider state is unavailable.',
        status: 503,
      });
    const state = await this.provider.get(bindings, domain.providerHostnameId);
    const updated = await this.directory.updateProviderState(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      domainId,
      provider: state,
    });
    recordMetric(bindings, {
      type: 'domain_certificate',
      environment: bindings.APP_ENV,
      schoolId: context.schoolId,
      hostname: domain.hostname,
      outcome: updated.certificateStatus,
    });
    await invalidateTenantCache(bindings, [domain.hostname], context.schoolId);
    return updated;
  }
  async setPrimary(bindings: Bindings, context: AuthContext, domainId: string) {
    this.authorize(context);
    const result = await this.directory.setPrimary(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      domainId,
    });
    await invalidateTenantCache(
      bindings,
      (await this.directory.list(bindings, context.schoolId)).map((item) => item.hostname),
      context.schoolId,
    );
    return result;
  }
  async remove(bindings: Bindings, context: AuthContext, domainId: string) {
    this.authorize(context);
    const removed = await this.directory.markRemoved(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      domainId,
    });
    await invalidateTenantCache(bindings, [removed.domain.hostname], context.schoolId);
    if (removed.providerHostnameId)
      await this.provider.remove(bindings, removed.providerHostnameId);
    return removed.domain;
  }
  async reconcile(bindings: Bindings, limit = 50) {
    const candidates = await this.directory.reconciliationCandidates(bindings, limit);
    const outcomes = await Promise.allSettled(
      candidates.map(async (item) => {
        const state = await this.provider.get(bindings, item.providerHostnameId);
        const domain = await this.directory.updateProviderStateAsSystem(bindings, {
          schoolId: item.schoolId,
          domainId: item.domainId,
          provider: state,
        });
        recordMetric(bindings, {
          type: 'domain_certificate',
          environment: bindings.APP_ENV,
          schoolId: item.schoolId,
          hostname: item.hostname,
          outcome: domain.certificateStatus,
        });
        await invalidateTenantCache(bindings, [item.hostname], item.schoolId);
        return domain;
      }),
    );
    return {
      checked: candidates.length,
      failed: outcomes.filter((item) => item.status === 'rejected').length,
    };
  }
}
