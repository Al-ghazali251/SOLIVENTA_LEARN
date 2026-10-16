import { z } from 'zod';
import type { Bindings } from '../config/bindings';
import type { PublicBootstrap } from '../services/contracts';
import type { TenantContext } from '../types/context';
import { TenantConfigurationSchema } from '../configuration/model';

const TenantSchema = z.object({
  schoolId: z.string().uuid(),
  hostname: z.string().min(1),
  domainType: z.enum(['public', 'portal']),
  configurationVersion: z.number().int().positive(),
  configurationVersionId: z.string().uuid(),
});
const MissingSchema = z.object({ missing: z.literal(true) });
const PublicBootstrapSchema = z.object({
  tenant: z.object({ id: z.string().uuid(), name: z.string(), primaryDomain: z.string() }),
  branding: z.object({
    logo: z.object({ url: z.string().nullable() }),
    colors: z.object({ primary: z.string(), secondary: z.string(), accent: z.string() }),
    fonts: z.object({ heading: z.string(), body: z.string() }),
    favicon: z.object({ url: z.string().nullable() }),
  }),
  template: z.string(),
  features: z.record(z.string(), z.boolean()),
  navigation: z.array(z.object({ label: z.string(), href: z.string() })),
  configuration: TenantConfigurationSchema,
  configurationVersion: z.number().int().positive(),
});

export const tenantCacheKeys = Object.freeze({
  domain: (hostname: string) => `domain:${hostname}`,
  config: (schoolId: string, version: number) => `tenant-config:${schoolId}:${version}`,
  page: (schoolId: string, version: number, slug: string) =>
    `tenant-page:${schoolId}:${version}:${encodeURIComponent(slug)}`,
});

async function getJson(bindings: Bindings, key: string): Promise<unknown> {
  const value = await bindings.TENANT_CACHE?.get(key);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    await bindings.TENANT_CACHE?.delete(key);
    return undefined;
  }
}

export async function readDomainCache(
  bindings: Bindings,
  hostname: string,
): Promise<TenantContext | null | undefined> {
  const key = tenantCacheKeys.domain(hostname);
  const value = await getJson(bindings, key);
  if (value === undefined) return undefined;
  if (MissingSchema.safeParse(value).success) return null;
  const parsed = TenantSchema.safeParse(value);
  if (!parsed.success) {
    await bindings.TENANT_CACHE?.delete(key);
    return undefined;
  }
  return Object.freeze(parsed.data);
}

export async function writeDomainCache(
  bindings: Bindings,
  hostname: string,
  tenant: TenantContext | null,
): Promise<void> {
  await bindings.TENANT_CACHE?.put(
    tenantCacheKeys.domain(hostname),
    JSON.stringify(tenant ?? { missing: true }),
    { expirationTtl: tenant ? 900 : 30 },
  );
}

export async function readPublicConfigCache(
  bindings: Bindings,
  tenant: TenantContext,
): Promise<PublicBootstrap | undefined> {
  const key = tenantCacheKeys.config(tenant.schoolId, tenant.configurationVersion);
  const value = await getJson(bindings, key);
  if (value === undefined) return undefined;
  const parsed = PublicBootstrapSchema.safeParse(value);
  if (!parsed.success) {
    await bindings.TENANT_CACHE?.delete(key);
    return undefined;
  }
  return Object.freeze(parsed.data);
}

export async function writePublicConfigCache(
  bindings: Bindings,
  tenant: TenantContext,
  value: PublicBootstrap,
): Promise<void> {
  await bindings.TENANT_CACHE?.put(
    tenantCacheKeys.config(tenant.schoolId, tenant.configurationVersion),
    JSON.stringify(value),
    { expirationTtl: 86400 },
  );
}

export async function invalidateTenantCache(
  bindings: Bindings,
  hostnames: readonly string[],
  schoolId: string,
  versions: readonly number[] = [],
): Promise<void> {
  if (!bindings.TENANT_CACHE) return;
  await Promise.all([
    ...hostnames.map((hostname) => bindings.TENANT_CACHE!.delete(tenantCacheKeys.domain(hostname))),
    ...versions.map((version) =>
      bindings.TENANT_CACHE!.delete(tenantCacheKeys.config(schoolId, version)),
    ),
  ]);
}
