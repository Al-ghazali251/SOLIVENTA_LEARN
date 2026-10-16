import type { Bindings } from '../config/bindings';
import { AppError } from '../errors/app-error';
import { assertPermission } from '../permissions/authorize';
import type { Permission } from '../permissions/permissions';
import {
  PlatformStudioCommandSchema,
  type PlatformStudioCommand,
  type PlatformStudioWorkspace,
} from '../platform-studio/model';
import type { AuthContext } from '../types/context';

export interface PlatformStudioGateway {
  workspace(bindings: Bindings, context: AuthContext): Promise<PlatformStudioWorkspace>;
  execute(
    bindings: Bindings,
    input: { actorId: string; command: PlatformStudioCommand },
  ): Promise<Record<string, unknown>>;
}

const permissionByOperation: Record<PlatformStudioCommand['operation'], Permission> = {
  'school.create': 'platform.schools.manage',
  'school.lifecycle': 'platform.schools.manage',
  'entitlement.set': 'platform.entitlements.manage',
  'feature.availability': 'platform.settings.manage',
  'operator.assign': 'platform.operators.manage',
  'operator.revoke': 'platform.operators.manage',
};

export class PlatformStudioService {
  constructor(private readonly gateway: PlatformStudioGateway) {}

  async workspace(bindings: Bindings, context: AuthContext) {
    this.assertPlatform(context);
    assertPermission(context, 'platform.schools.read');
    return await this.gateway.workspace(bindings, context);
  }

  async execute(bindings: Bindings, context: AuthContext, value: unknown) {
    this.assertPlatform(context);
    const parsed = PlatformStudioCommandSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Platform studio command validation failed.',
        status: 400,
        details: { issues: parsed.error.issues },
      });
    assertPermission(context, permissionByOperation[parsed.data.operation]);
    if (parsed.data.operation === 'operator.revoke' && parsed.data.accountId === context.userId)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You cannot revoke your own platform access.',
        status: 409,
      });
    return await this.gateway.execute(bindings, { actorId: context.userId, command: parsed.data });
  }

  private assertPlatform(context: AuthContext) {
    if (context.scope.kind !== 'platform')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Platform operator scope is required.',
        status: 403,
      });
  }
}
