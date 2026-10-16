import { z } from 'zod';

const id = z.string().uuid();
export const PlatformStudioCommandSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('school.create'),
    code: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}$/),
    legalName: z.string().trim().min(2).max(200),
    displayName: z.string().trim().min(2).max(200),
  }),
  z.object({
    operation: z.literal('school.lifecycle'),
    schoolId: id,
    status: z.enum(['active', 'suspended', 'archived']),
  }),
  z.object({
    operation: z.literal('entitlement.set'),
    schoolId: id,
    featureKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/),
    entitled: z.boolean(),
  }),
  z.object({
    operation: z.literal('feature.availability'),
    featureKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/),
    available: z.boolean(),
  }),
  z.object({
    operation: z.literal('operator.assign'),
    accountId: id,
    roleCode: z.enum([
      'platform_admin',
      'platform_operator',
      'platform_support',
      'platform_auditor',
    ]),
  }),
  z.object({
    operation: z.literal('operator.revoke'),
    accountId: id,
    roleCode: z.enum([
      'platform_admin',
      'platform_operator',
      'platform_support',
      'platform_auditor',
    ]),
  }),
]);

export type PlatformStudioCommand = z.infer<typeof PlatformStudioCommandSchema>;
export type PlatformStudioWorkspace = Readonly<{
  schools: Record<string, unknown>[];
  domains: Record<string, unknown>[];
  features: Record<string, unknown>[];
  entitlements: Record<string, unknown>[];
  operatorAssignments: Record<string, unknown>[];
  operatorRoles: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
  auditEvents: Record<string, unknown>[];
}>;
