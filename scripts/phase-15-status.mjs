import { readFile } from 'node:fs/promises';

const evidence = JSON.parse(await readFile('ops/pilot/phase-15-evidence.json', 'utf8'));
const expected = {
  stagingDeployment: 'passed',
  representativeTenants: 'passed',
  sanitizedImport: 'passed',
  parallelVerification: 'passed',
  pilotSchool: 'passed',
  supportReadiness: 'passed',
  migrationRepeatability: 'passed',
  rollbackExercise: 'passed',
};
const open = Object.entries(expected)
  .filter(([name, status]) => evidence[name]?.status !== status)
  .map(([name]) => `${name}: ${evidence[name]?.status ?? 'missing'}`);
if (!evidence.generalAvailability)
  open.push(`generalAvailability: false (current cohort: ${evidence.cohort})`);
console.log(
  open.length === 0
    ? 'Phase 15 completion gate passed.'
    : `Phase 15 is OPEN:\n- ${open.join('\n- ')}`,
);
if (process.argv.includes('--enforce') && open.length > 0) process.exitCode = 1;
