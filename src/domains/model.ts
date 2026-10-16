import { z } from 'zod';
import { normalizeHostname } from '../tenant/hostname';

export const DomainTypeSchema = z.enum(['public_site', 'portal']);
export const DomainStatusSchema = z.enum([
  'pending',
  'awaiting_dns',
  'verifying',
  'active',
  'failed',
  'suspended',
  'removed',
]);
export const CertificateStatusSchema = z.enum([
  'pending',
  'provisioning',
  'active',
  'failed',
  'expired',
]);
export const DomainRecordSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  domainType: DomainTypeSchema,
  domainKind: z.enum(['platform', 'custom']),
  status: DomainStatusSchema,
  certificateStatus: CertificateStatusSchema,
  isPrimary: z.boolean(),
  redirectToPrimary: z.boolean(),
  ownershipVerification: z.record(z.string(), z.unknown()).nullable(),
  providerHostnameId: z.string().nullable(),
  certificateValidation: z.array(z.record(z.string(), z.unknown())),
  failureReason: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type DomainRecord = z.infer<typeof DomainRecordSchema>;
export function normalizeCustomHostname(value: string, platformBaseDomain: string) {
  const hostname = normalizeHostname(value);
  const base = normalizeHostname(platformBaseDomain);
  if (hostname === base || hostname.endsWith(`.${base}`))
    throw new Error('Platform hostnames cannot be claimed as custom domains.');
  return hostname;
}
