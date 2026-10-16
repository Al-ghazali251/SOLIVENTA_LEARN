import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
const retiredBrand = new RegExp(`tri${'vex'}`, 'i');
const violations = files.filter((file) => {
  try {
    return retiredBrand.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
});
if (violations.length) {
  console.error(
    `Retired brand reference found:\n${violations.map((file) => `- ${file}`).join('\n')}`,
  );
  process.exitCode = 1;
} else console.log('Soliventa branding check passed.');
