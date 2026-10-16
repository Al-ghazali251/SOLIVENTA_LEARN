import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const current = JSON.parse(readFileSync('contracts/openapi.v1.json', 'utf8'));
let previous;
try {
  previous = JSON.parse(
    execFileSync('git', ['show', 'origin/main:contracts/openapi.v1.json'], { encoding: 'utf8' }),
  );
} catch {
  console.log('No base v1 contract exists; compatibility check skipped.');
  process.exit(0);
}

const breaking = [];
for (const [path, methods] of Object.entries(previous.paths ?? {})) {
  const currentPath = current.paths?.[path];
  if (!currentPath) {
    breaking.push(`removed path ${path}`);
    continue;
  }
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    const next = currentPath[method];
    if (!next) {
      breaking.push(`removed operation ${method.toUpperCase()} ${path}`);
      continue;
    }
    for (const status of Object.keys(operation.responses ?? {})) {
      if (!next.responses?.[status])
        breaking.push(`removed response ${status} from ${method.toUpperCase()} ${path}`);
    }
  }
}
if (breaking.length)
  throw new Error(`Breaking v1 contract changes detected:\n- ${breaking.join('\n- ')}`);
console.log('No breaking v1 path, operation, or response changes detected.');
