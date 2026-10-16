import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import { invalidateTenantCache } from '../tenant/cache';
import type { AuthContext } from '../types/context';
import {
  TenantConfigurationSchema,
  effectiveFeatures,
  migrateTenantConfiguration,
  type ConfigurationVersion,
  type TenantConfiguration,
} from '../configuration/model';

export interface ConfigurationStudioGateway {
  uploadAsset(
    bindings: Bindings,
    input: { schoolId: string; actorId: string; name: string; mimeType: string; base64: string },
  ): Promise<{ id: string; name: string; url: string; mimeType: string; sizeBytes: number }>;
  getWorkspace(
    bindings: Bindings,
    schoolId: string,
    actorId: string,
  ): Promise<{
    draft: ConfigurationVersion;
    versions: readonly ConfigurationVersion[];
    platformFeatures: Record<string, boolean>;
    entitlements: Record<string, boolean>;
  }>;
  saveDraft(
    bindings: Bindings,
    input: {
      schoolId: string;
      versionId?: string;
      actorId: string;
      configuration: TenantConfiguration;
    },
  ): Promise<ConfigurationVersion>;
  publish(
    bindings: Bindings,
    input: { schoolId: string; versionId: string; actorId: string; action: 'publish' | 'rollback' },
  ): Promise<{
    version: ConfigurationVersion;
    previousVersion: number | null;
    hostnames: readonly string[];
  }>;
  cloneVersion(
    bindings: Bindings,
    input: { schoolId: string; sourceVersionId: string; actorId: string },
  ): Promise<ConfigurationVersion>;
  loadPreview(
    bindings: Bindings,
    schoolId: string,
    versionId: string,
  ): Promise<ConfigurationVersion>;
}

export class ConfigurationStudioService {
  constructor(private readonly gateway: ConfigurationStudioGateway) {}
  private authorize(context: AuthContext) {
    assertSchoolScope(context, context.schoolId);
    assertPermission(context, 'school.configure');
  }
  async workspace(bindings: Bindings, context: AuthContext) {
    this.authorize(context);
    return this.gateway.getWorkspace(bindings, context.schoolId, context.userId);
  }
  async uploadAsset(
    bindings: Bindings,
    context: AuthContext,
    input: { name: string; mimeType: string; base64: string },
  ) {
    this.authorize(context);
    return this.gateway.uploadAsset(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      ...input,
    });
  }
  async save(
    bindings: Bindings,
    context: AuthContext,
    input: { versionId?: string; configuration: unknown },
  ) {
    this.authorize(context);
    const parsed = TenantConfigurationSchema.safeParse(input.configuration);
    if (!parsed.success)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Configuration validation failed.',
        status: 400,
        details: { issues: parsed.error.issues },
      });
    const configuration = migrateTenantConfiguration(parsed.data);
    const workspace = await this.gateway.getWorkspace(bindings, context.schoolId, context.userId);
    const effective = effectiveFeatures(
      workspace.platformFeatures,
      workspace.entitlements,
      configuration.features,
    );
    const forbidden = Object.keys(configuration.features).filter(
      (key) => configuration.features[key] && !effective[key],
    );
    if (forbidden.length)
      throw new AppError({
        code: 'FEATURE_NOT_ENTITLED',
        message: 'One or more features are unavailable for this subscription.',
        status: 422,
        details: { features: forbidden },
      });
    return this.gateway.saveDraft(bindings, {
      schoolId: context.schoolId,
      actorId: context.userId,
      configuration: { ...configuration, features: effective },
      ...(input.versionId ? { versionId: input.versionId } : {}),
    });
  }
  async publish(
    bindings: Bindings,
    context: AuthContext,
    versionId: string,
    action: 'publish' | 'rollback' = 'publish',
  ) {
    this.authorize(context);
    const result = await this.gateway.publish(bindings, {
      schoolId: context.schoolId,
      versionId,
      actorId: context.userId,
      action,
    });
    await invalidateTenantCache(
      bindings,
      result.hostnames,
      context.schoolId,
      result.previousVersion ? [result.previousVersion] : [],
    );
    return result.version;
  }
  async rollback(bindings: Bindings, context: AuthContext, sourceVersionId: string) {
    this.authorize(context);
    const draft = await this.gateway.cloneVersion(bindings, {
      schoolId: context.schoolId,
      sourceVersionId,
      actorId: context.userId,
    });
    return this.publish(bindings, context, draft.id, 'rollback');
  }
}
