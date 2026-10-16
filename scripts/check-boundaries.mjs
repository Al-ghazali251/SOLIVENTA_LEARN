import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const ignoredDirectories = new Set(['node_modules', 'dist', '.wrangler', '.git', 'coverage']);
const violations = [];

function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else if (sourceExtensions.has(extname(path))) files.push(path);
  }
  return files;
}

function report(file, rule, detail) {
  violations.push(`${relative(root, file)}: ${rule} (${detail})`);
}

for (const file of filesUnder(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8');
  const normalized = file.replaceAll('\\', '/');

  if (
    /from\s+['"][^'"]*(?:soliventa-learn-web|apps\/school-|academiq-web)[^'"]*['"]/.test(source)
  ) {
    report(file, 'frontend-import', 'API code cannot import frontend source');
  }
  if (
    normalized.includes('/src/api/routes/') &&
    /@supabase\/supabase-js|integrations\/supabase\/(?:admin-)?client/.test(source)
  ) {
    report(file, 'route-data-access', 'HTTP routes must call application services, not Supabase');
  }
  if (
    /SUPABASE_SECRET_KEY/.test(source) &&
    !normalized.endsWith('/src/config/bindings.ts') &&
    !normalized.endsWith('/src/integrations/supabase/admin-client.ts')
  ) {
    report(
      file,
      'supabase-secret-boundary',
      'Supabase secret-key access is restricted to bindings and admin-client',
    );
  }
}

if (violations.length > 0) {
  console.error(
    `Dependency boundary violations:\n${violations.map((item) => `- ${item}`).join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log('Dependency boundaries passed.');
}
