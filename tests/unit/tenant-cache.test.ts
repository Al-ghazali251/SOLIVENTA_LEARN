import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../../src/config/bindings';
import { getPublicBootstrap } from '../../src/services/bootstrap-service';
import { ConfigurationPublishingService } from '../../src/services/configuration-publishing.service';
import type { BootstrapDirectory, PublicBootstrap } from '../../src/services/contracts';
import { permissionsForRoles } from '../../src/permissions/roles';
import { readDomainCache, tenantCacheKeys, writeDomainCache } from '../../src/tenant/cache';
import type { AuthContext, TenantContext } from '../../src/types/context';
import { defaultPortalConfiguration, type TenantConfiguration } from '../../src/configuration/model';

class MemoryKv {
  readonly values = new Map<string, string>();
  get(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }
  put(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }
  delete(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const schoolId = '11111111-1111-4111-8111-111111111111';
const tenant: TenantContext = {
  schoolId,
  hostname: 'greenfield.example',
  domainType: 'public',
  configurationVersion: 42,
  configurationVersionId: '33333333-3333-4333-8333-333333333333',
};
const configuration: TenantConfiguration = {
  schemaVersion: 1,
  template: 'modern-academy',
  branding: {
    logoUrl: null,
    faviconUrl: null,
    colors: {
      primary: '#111111',
      secondary: '#222222',
      accent: '#333333',
      background: '#ffffff',
      surface: '#ffffff',
      text: '#111111',
      muted: '#666666',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    buttonStyle: 'rounded',
    cardStyle: 'bordered',
    inputStyle: 'rounded',
  },
  contact: { email: 'hello@example.test', phone: '+2348000000000', address: '1 School Road' },
  socialLinks: [],
  portal: defaultPortalConfiguration,
  features: { admissions: true },
  navigation: [],
  mediaLibrary: [],
  pages: [
    {
      slug: '/',
      title: 'Home',
      visible: true,
      seo: { title: '', description: '', socialImage: null, noindex: false },
      blocks: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          type: 'richText',
          heading: 'Welcome',
          paragraphs: ['Welcome to our school.'],
        },
      ],
    },
  ],
};
const bootstrap: PublicBootstrap = {
  tenant: { id: schoolId, name: 'Greenfield Academy', primaryDomain: 'greenfield.example' },
  branding: {
    logo: { url: null },
    colors: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    fonts: { heading: 'Inter', body: 'Inter' },
    favicon: { url: null },
  },
  template: 'modern-academy',
  features: { admissions: true, news: true },
  navigation: [],
  configuration,
  configurationVersion: 42,
};

function bindings(kv: MemoryKv): Bindings {
  return {
    APP_ENV: 'development',
    APP_ORIGIN: 'http://localhost:4321',
    PORTAL_ORIGIN: 'http://localhost:5173',
    SUPABASE_URL: 'https://example.invalid',
    SUPABASE_PUBLISHABLE_KEY: 'key',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    TENANT_CACHE: kv as unknown as KVNamespace,
  };
}

describe('tenant bootstrap caching', () => {
  it('caches published public configuration by school and immutable version', async () => {
    const kv = new MemoryKv();
    const loadPublic = vi.fn<BootstrapDirectory['loadPublic']>(() => Promise.resolve(bootstrap));
    const directory = { loadPublic, loadPortal: vi.fn<BootstrapDirectory['loadPortal']>() };
    expect((await getPublicBootstrap(bindings(kv), directory, tenant)).cacheStatus).toBe('MISS');
    expect((await getPublicBootstrap(bindings(kv), directory, tenant)).cacheStatus).toBe('HIT');
    expect(loadPublic).toHaveBeenCalledTimes(1);
    expect(kv.values.has(tenantCacheKeys.config(schoolId, 42))).toBe(true);
  });

  it('separates negative domain entries and rejects poisoned cache values', async () => {
    const kv = new MemoryKv();
    const env = bindings(kv);
    await writeDomainCache(env, 'unknown.example', null);
    await writeDomainCache(env, tenant.hostname, tenant);
    expect(await readDomainCache(env, 'unknown.example')).toBeNull();
    expect(await readDomainCache(env, tenant.hostname)).toMatchObject({ schoolId });
    kv.values.set(
      tenantCacheKeys.domain(tenant.hostname),
      JSON.stringify({ schoolId: 'attacker' }),
    );
    expect(await readDomainCache(env, tenant.hostname)).toBeUndefined();
    expect(kv.values.has(tenantCacheKeys.domain(tenant.hostname))).toBe(false);
  });

  it('invalidates domain mappings and the previous version after publishing', async () => {
    const kv = new MemoryKv();
    const env = bindings(kv);
    kv.values.set(tenantCacheKeys.domain(tenant.hostname), '{}');
    kv.values.set(tenantCacheKeys.config(schoolId, 41), '{}');
    const gateway = {
      publish: vi.fn(() =>
        Promise.resolve({
          publishedVersion: 42,
          previousVersion: 41,
          hostnames: [tenant.hostname],
        }),
      ),
    };
    const service = new ConfigurationPublishingService(gateway);
    const auth: AuthContext = {
      userId: '22222222-2222-4222-8222-222222222222',
      schoolId,
      roles: ['school_admin'],
      permissions: permissionsForRoles(['school_admin']),
      scope: { kind: 'school-wide' },
    };
    await service.publish(env, auth, { schoolId, versionId: tenant.configurationVersionId });
    expect(kv.values.has(tenantCacheKeys.domain(tenant.hostname))).toBe(false);
    expect(kv.values.has(tenantCacheKeys.config(schoolId, 41))).toBe(false);
  });
});
