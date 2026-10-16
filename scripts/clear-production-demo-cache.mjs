import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'ops/production/demo-tenants.json'), 'utf8'));
const config = resolve(root, 'ops/production/wrangler.generated.json');
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const hostnames = manifest.tenants.flatMap((tenant) => [tenant.publicHostname, tenant.portalHostname]);

for (const hostname of hostnames) {
  const result = spawnSync(
    process.execPath,
    [wrangler, 'kv', 'key', 'delete', `domain:${hostname}`, '--binding', 'TENANT_CACHE', '--remote', '--config', config],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Cleared production tenant resolution cache for ${hostnames.length} hostnames.`);
