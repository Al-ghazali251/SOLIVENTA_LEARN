import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { app } from '../src/app';
import type { Bindings } from '../src/config/bindings';

const output = resolve('contracts/openapi.v1.json');
const env: Bindings = {
  APP_ENV: 'development',
  APP_ORIGIN: 'http://localhost:4321',
  PORTAL_ORIGIN: 'http://localhost:5173',
  SUPABASE_URL: 'https://contract.invalid',
  SUPABASE_PUBLISHABLE_KEY: 'contract',
  SUPABASE_SECRET_KEY: 'sb_secret_contract',
};
const response = await app.request('http://localhost/openapi.json', undefined, env);
if (!response.ok) throw new Error(`OpenAPI generation failed with ${response.status}.`);
const document = (await response.json()) as Record<string, unknown>;
const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committed = await readFile(output, 'utf8').catch(() => '');
  if (committed !== serialized) {
    throw new Error('OpenAPI contract drift detected. Run pnpm contract:generate and commit it.');
  }
} else {
  await mkdir(resolve('contracts'), { recursive: true });
  await writeFile(output, serialized, 'utf8');
}
