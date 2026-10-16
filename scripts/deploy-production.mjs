import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

for (const key of ['TENANT_CACHE_KV_ID', 'RATE_LIMIT_NAMESPACE_ID'])
  if (!process.env[key]) throw new Error(`Missing ${key}.`);
const source = JSON.parse(
  (await readFile('wrangler.jsonc', 'utf8'))
    .replace(/^\s*\/\/.*$/gmu, '')
    .replace(/,\s*([}\]])/gu, '$1'),
);
source.$schema = '../../node_modules/wrangler/config-schema.json';
source.main = '../../src/worker.ts';
source.kv_namespaces = [{ binding: 'TENANT_CACHE', id: process.env.TENANT_CACHE_KV_ID }];
source.ratelimits = [
  {
    name: 'RATE_LIMITER',
    namespace_id: process.env.RATE_LIMIT_NAMESPACE_ID,
    simple: { limit: 120, period: 60 },
  },
];
for (const name of [
  'OPENROUTER_MODEL',
  'OPENROUTER_DATA_COLLECTION',
  'LESSON_AI_DAILY_LIMIT',
  'LESSON_AI_SCHOOL_DAILY_LIMIT',
]) {
  if (process.env[name]) source.vars[name] = process.env[name];
}
const generated = 'ops/production/wrangler.generated.json';
await writeFile(generated, `${JSON.stringify(source, null, 2)}\n`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
if (!process.env.PREVIEW_TOKEN_SECRET || process.env.PREVIEW_TOKEN_SECRET.length < 32)
  throw new Error('PREVIEW_TOKEN_SECRET must contain at least 32 characters.');
const livePaystack = process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_');
const testPaystack = process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_test_');
if (!livePaystack && !(testPaystack && process.env.ALLOW_PAYSTACK_TEST_IN_PRODUCTION === 'true'))
  throw new Error(
    'PAYSTACK_SECRET_KEY must be live, or explicitly allow a test key with ALLOW_PAYSTACK_TEST_IN_PRODUCTION=true.',
  );
if (testPaystack)
  console.warn('WARNING: deploying Paystack test mode; no real charges will be processed.');
const secretNames = [
  'OPENROUTER_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'PREVIEW_TOKEN_SECRET',
  'PAYSTACK_SECRET_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_SAAS_TARGET',
];
const secrets = Object.fromEntries(
  secretNames.map((name) => [name, process.env[name]]).filter(([, value]) => Boolean(value)),
);
const uploadedSecrets = spawnSync(
  process.execPath,
  [wrangler, 'secret', 'bulk', '--config', generated],
  {
    input: `${JSON.stringify(secrets)}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);
if (uploadedSecrets.error) throw uploadedSecrets.error;
if (uploadedSecrets.status !== 0) process.exit(uploadedSecrets.status ?? 1);
const result = spawnSync(process.execPath, [wrangler, 'deploy', '--config', generated], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
