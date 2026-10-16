import { readFile } from 'node:fs/promises';

const gates = JSON.parse(await readFile('ops/testing/phase-14-gates.json', 'utf8'));
const incomplete = [];
for (const [name, gate] of Object.entries(gates)) {
  if (name === 'milestone3') continue;
  if (gate.status !== 'implemented') incomplete.push(`${name}: ${gate.status}`);
}
for (const [name, status] of Object.entries(gates.milestone3)) {
  if (status !== 'implemented') incomplete.push(`milestone3.${name}: ${status}`);
}
console.log(
  incomplete.length === 0
    ? 'Phase 14 completion gate passed.'
    : `Phase 14 is OPEN:\n- ${incomplete.join('\n- ')}`,
);
if (process.argv.includes('--enforce') && incomplete.length > 0) process.exitCode = 1;
