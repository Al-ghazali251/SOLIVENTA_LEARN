import type { Bindings } from '../config/bindings';
import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import { invalidateTenantCache } from '../tenant/cache';
import type { AuthContext } from '../types/context';

export type ConfigurationPublishingGateway = {
  publish(
    bindings: Bindings,
    input: Readonly<{ schoolId: string; versionId: string }>,
  ): Promise<
    Readonly<{
      publishedVersion: number;
      previousVersion: number | null;
      hostnames: readonly string[];
    }>
  >;
};

export class ConfigurationPublishingService {
  constructor(private readonly gateway: ConfigurationPublishingGateway) {}

  async publish(
    bindings: Bindings,
    context: AuthContext,
    input: Readonly<{ schoolId: string; versionId: string }>,
  ) {
    assertSchoolScope(context, input.schoolId);
    assertPermission(context, 'school.configure');
    const result = await this.gateway.publish(bindings, input);
    await invalidateTenantCache(
      bindings,
      result.hostnames,
      input.schoolId,
      result.previousVersion ? [result.previousVersion] : [],
    );
    return result;
  }
}
