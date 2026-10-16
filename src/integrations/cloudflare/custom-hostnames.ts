import { z } from 'zod';
import type { Bindings } from '../../config/bindings';
import { AppError } from '../../errors/app-error';

const ResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string() })).default([]),
  result: z.object({
    id: z.string(),
    hostname: z.string(),
    status: z.string(),
    ownership_verification: z
      .object({
        name: z.string().optional(),
        type: z.string().optional(),
        value: z.string().optional(),
      })
      .optional(),
    ssl: z
      .object({
        status: z.string().optional(),
        validation_records: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .optional(),
    verification_errors: z.array(z.string()).optional(),
  }),
});
export type CloudflareHostname = z.infer<typeof ResponseSchema>['result'];

function configured(bindings: Bindings) {
  if (!bindings.CLOUDFLARE_API_TOKEN || !bindings.CLOUDFLARE_ZONE_ID)
    throw new AppError({
      code: 'SERVICE_NOT_READY',
      message: 'Domain provisioning is not configured.',
      status: 503,
    });
}
async function call(
  bindings: Bindings,
  path: string,
  init?: RequestInit,
): Promise<CloudflareHostname> {
  configured(bindings);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${bindings.CLOUDFLARE_ZONE_ID}/custom_hostnames${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${bindings.CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    },
  );
  const parsed = ResponseSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success || !parsed.data.success)
    throw new AppError({
      code: 'SERVICE_NOT_READY',
      message: 'The domain provider rejected the operation.',
      status: 503,
      ...(parsed.success
        ? { details: { providerErrors: parsed.data.errors.map((item) => item.message) } }
        : {}),
    });
  return parsed.data.result;
}
export const cloudflareCustomHostnames = Object.freeze({
  create: (bindings: Bindings, hostname: string, schoolId: string) =>
    call(bindings, '', {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        custom_metadata: { school_id: schoolId },
        ssl: {
          method: 'txt',
          type: 'dv',
          settings: { min_tls_version: '1.2', tls_1_3: 'on', http2: 'on' },
        },
      }),
    }),
  get: (bindings: Bindings, id: string) => call(bindings, `/${encodeURIComponent(id)}`),
  remove: async (bindings: Bindings, id: string) => {
    configured(bindings);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${bindings.CLOUDFLARE_ZONE_ID}/custom_hostnames/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${bindings.CLOUDFLARE_API_TOKEN}` } },
    );
    if (!response.ok && response.status !== 404)
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'The domain provider could not remove the hostname.',
        status: 503,
      });
  },
});
