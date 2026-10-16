import { describe, expect, it, vi } from 'vitest';
import {
  DomainLifecycleService,
  type CustomHostnameProvider,
  type DomainDirectoryGateway,
} from '../../src/services/domain-provisioning.service';
import type { AuthContext } from '../../src/types/context';
import type { Bindings } from '../../src/config/bindings';

const bindings = {
  PLATFORM_BASE_DOMAIN: 'soliventa.localhost',
  CLOUDFLARE_SAAS_TARGET: 'customers.soliventa.localhost',
} as Bindings;
const auth: AuthContext = {
  userId: '22222222-2222-4222-8222-222222222222',
  schoolId: '11111111-1111-4111-8111-111111111111',
  roles: ['school_admin'],
  permissions: new Set(['domains.manage']),
  scope: { kind: 'school-wide' },
};
const providerState = {
  id: 'cloudflare-id',
  hostname: 'www.school.example',
  status: 'pending',
  ssl: { status: 'pending_validation', validation_records: [] },
  ownership_verification: {
    name: '_cf-custom-hostname.www.school.example',
    type: 'txt',
    value: 'token',
  },
};

describe('DomainLifecycleService', () => {
  it('normalizes a custom hostname and never accepts a client school id', async () => {
    const createCustom = vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' });
    const directory = {
      createCustom,
      list: vi.fn(),
      provisionDefaults: vi.fn(),
      updateProviderState: vi.fn(),
      setPrimary: vi.fn(),
      markRemoved: vi.fn(),
    } as unknown as DomainDirectoryGateway;
    const provider = {
      create: vi.fn().mockResolvedValue(providerState),
      get: vi.fn(),
      remove: vi.fn(),
    } as unknown as CustomHostnameProvider;
    await new DomainLifecycleService(directory, provider).create(bindings, auth, {
      hostname: ' WWW.School.Example. ',
      domainType: 'public_site',
    });
    expect(createCustom).toHaveBeenCalledWith(
      bindings,
      expect.objectContaining({
        schoolId: auth.schoolId,
        hostname: 'www.school.example',
        cnameTarget: 'customers.soliventa.localhost',
      }),
    );
  });
  it('removes the provider hostname when database persistence fails', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const directory = {
      createCustom: vi.fn().mockRejectedValue(new Error('unique hostname')),
      list: vi.fn(),
      provisionDefaults: vi.fn(),
      updateProviderState: vi.fn(),
      setPrimary: vi.fn(),
      markRemoved: vi.fn(),
    } as unknown as DomainDirectoryGateway;
    const provider = {
      create: vi.fn().mockResolvedValue(providerState),
      get: vi.fn(),
      remove,
    } as unknown as CustomHostnameProvider;
    await expect(
      new DomainLifecycleService(directory, provider).create(bindings, auth, {
        hostname: 'school.example',
        domainType: 'portal',
      }),
    ).rejects.toThrow('unique hostname');
    expect(remove).toHaveBeenCalledWith(bindings, 'cloudflare-id');
  });
  it('rejects attempts to claim a platform hostname', async () => {
    const service = new DomainLifecycleService(
      {} as DomainDirectoryGateway,
      {} as CustomHostnameProvider,
    );
    await expect(
      service.create(bindings, auth, {
        hostname: 'school.schools.soliventa.localhost',
        domainType: 'public_site',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_HOSTNAME', status: 400 });
  });
});
