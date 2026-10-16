import { describe, expect, it, vi } from 'vitest';
import {
  PlatformStudioService,
  type PlatformStudioGateway,
} from '../../src/services/platform-studio.service';
import type { AuthContext } from '../../src/types/context';
import type { Permission } from '../../src/permissions/permissions';

const context = (
  permissions: Permission[],
  scope: AuthContext['scope']['kind'] = 'platform',
): AuthContext => ({
  userId: '11111111-1111-4111-8111-111111111111',
  schoolId: '22222222-2222-4222-8222-222222222222',
  roles: ['moderator'],
  permissions: new Set(permissions),
  scope: { kind: scope },
});

const gateway = (): PlatformStudioGateway => ({
  workspace: vi.fn().mockResolvedValue({
    schools: [],
    domains: [],
    features: [],
    entitlements: [],
    operatorAssignments: [],
    operatorRoles: [],
    accounts: [],
    auditEvents: [],
  }),
  execute: vi.fn().mockResolvedValue({ id: 'saved' }),
});

describe('platform studio authorization', () => {
  it('requires platform scope for the workspace', async () => {
    await expect(
      new PlatformStudioService(gateway()).workspace(
        {} as never,
        context(['platform.schools.read'], 'school-wide'),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('requires the operation-specific permission', async () => {
    await expect(
      new PlatformStudioService(gateway()).execute(
        {} as never,
        context(['platform.schools.read']),
        {
          operation: 'school.lifecycle',
          schoolId: '22222222-2222-4222-8222-222222222222',
          status: 'suspended',
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('prevents operators from revoking their own access', async () => {
    await expect(
      new PlatformStudioService(gateway()).execute(
        {} as never,
        context(['platform.operators.manage']),
        {
          operation: 'operator.revoke',
          accountId: '11111111-1111-4111-8111-111111111111',
          roleCode: 'platform_admin',
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
