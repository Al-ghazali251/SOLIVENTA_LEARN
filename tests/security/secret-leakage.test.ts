import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat().filter((path) => /\.(?:ts|tsx|js|mjs|astro)$/u.test(path));
}

describe('secret leakage controls', () => {
  it('does not embed secret-key values or legacy service-role names in application source', async () => {
    const files = await sourceFiles(join(process.cwd(), 'src'));
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const source = contents.join('\n');
    expect(source).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/u);
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
