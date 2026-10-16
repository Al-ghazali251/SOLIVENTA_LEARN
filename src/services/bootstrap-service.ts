import type { Bindings } from '../config/bindings';
import { readPublicConfigCache, writePublicConfigCache } from '../tenant/cache';
import type { TenantContext } from '../types/context';
import type { BootstrapDirectory, PublicBootstrap } from './contracts';

export async function getPublicBootstrap(
  bindings: Bindings,
  directory: BootstrapDirectory,
  tenant: TenantContext,
): Promise<{ value: PublicBootstrap; cacheStatus: 'HIT' | 'MISS' }> {
  const cached = await readPublicConfigCache(bindings, tenant);
  if (cached) return { value: cached, cacheStatus: 'HIT' };
  const value = await directory.loadPublic(bindings, tenant);
  await writePublicConfigCache(bindings, tenant, value);
  return { value, cacheStatus: 'MISS' };
}
