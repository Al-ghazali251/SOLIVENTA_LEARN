import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const enabled = process.env.RUN_HOSTED_INTEGRATION === '1';

describe.skipIf(!enabled)('hosted Supabase integration', () => {
  it('verifies authentication, tenant mapping, and cross-school isolation', async () => {
    const { stdout } = await run(process.execPath, ['scripts/verify-hosted-fixtures.mjs'], {
      cwd: process.cwd(),
      timeout: 60_000,
    });
    expect(stdout).toContain('Hosted fixture verification passed');
  }, 70_000);
});
