import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createClient } from '@supabase/supabase-js';

function parseVariables(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].trim()]),
  );
}
const variables = {
  ...parseVariables(await readFile('.dev.vars', 'utf8')),
  ...parseVariables(await readFile('.env.e2e', 'utf8')),
};
const auth = createClient(variables.SUPABASE_URL, variables.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const apiPort = process.env.E2E_API_PORT ?? '8787';
const request = (hostname, path, init = {}) =>
  new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(apiPort),
        path,
        method: init.method ?? 'GET',
        headers: { ...init.headers, Host: `${hostname}:${apiPort}` },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });

const schoolA = await request('school-a.localhost', '/v1/public/bootstrap');
const schoolB = await request('school-b.localhost', '/v1/public/bootstrap');
const unknown = await request('unknown-school.localhost', '/v1/public/bootstrap');
if (schoolA.status !== 200 || schoolB.status !== 200 || unknown.status !== 404)
  throw new Error(
    `Public tenant verification failed: A=${schoolA.status}, B=${schoolB.status}, unknown=${unknown.status}`,
  );

const signedIn = await auth.auth.signInWithPassword({
  email: variables.E2E_SCHOOL_A_ADMIN_EMAIL,
  password: variables.E2E_SCHOOL_A_ADMIN_PASSWORD,
});
if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('No E2E session.');
const headers = { Authorization: `Bearer ${signedIn.data.session.access_token}` };
const ownPortal = await request('portal.school-a.localhost', '/v1/portal/bootstrap', { headers });
const otherPortal = await request('portal.school-b.localhost', '/v1/portal/bootstrap', { headers });
if (ownPortal.status !== 200 || otherPortal.status !== 403)
  throw new Error(
    `Portal isolation verification failed: own=${ownPortal.status}, crossSchool=${otherPortal.status}`,
  );
await auth.auth.signOut();
console.log(
  'Hosted fixture verification passed: public tenancy and authenticated cross-school isolation.',
);
