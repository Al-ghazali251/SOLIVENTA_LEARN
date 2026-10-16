import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
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

const variables = parseVariables(await readFile('.dev.vars', 'utf8'));
if (variables.APP_ENV !== 'development') throw new Error('Fixtures require APP_ENV=development.');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(variables.SUPABASE_URL ?? ''))
  throw new Error('Fixtures require a hosted development Supabase URL.');
if (!variables.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))
  throw new Error('A new-format Supabase secret key is required.');

const supabase = createClient(variables.SUPABASE_URL, variables.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const fixtureUsers = [
  ['MODERATOR', 'e2e-moderator@local.soliventa.test', 'E2E Moderator'],
  ['SCHOOL_A_ADMIN', 'e2e-admin-a@local.soliventa.test', 'School A Administrator'],
  ['SCHOOL_A_TEACHER', 'e2e-teacher-a@local.soliventa.test', 'School A Teacher'],
  ['SCHOOL_A_STUDENT', 'e2e-student-a@local.soliventa.test', 'School A Student'],
  ['SCHOOL_A_PARENT', 'e2e-parent-a@local.soliventa.test', 'School A Parent'],
  ['SCHOOL_B_ADMIN', 'e2e-admin-b@local.soliventa.test', 'School B Administrator'],
  ['SCHOOL_B_TEACHER', 'e2e-teacher-b@local.soliventa.test', 'School B Teacher'],
  ['SCHOOL_B_STUDENT', 'e2e-student-b@local.soliventa.test', 'School B Student'],
];

const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const usersByEmail = new Map(listed.data.users.map((user) => [user.email?.toLowerCase(), user]));
const identities = {};
const credentials = [];
for (const [key, email, displayName] of fixtureUsers) {
  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  const existing = usersByEmail.get(email);
  const result = existing
    ? await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        app_metadata: { ...existing.app_metadata, e2e_fixture: true },
      })
    : await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { e2e_fixture: true },
      });
  if (result.error) throw result.error;
  identities[key] = result.data.user.id;
  credentials.push(`E2E_${key}_EMAIL=${email}`, `E2E_${key}_PASSWORD=${password}`);
  const profile = await supabase
    .from('profiles')
    .upsert(
      { user_id: result.data.user.id, display_name: displayName, email },
      { onConflict: 'user_id' },
    );
  if (profile.error) throw profile.error;
}

await writeFile('.env.e2e', `${credentials.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });

const schoolA = 'aaaaaaaa-0000-4000-8000-000000000001';
const schoolB = 'bbbbbbbb-0000-4000-8000-000000000001';
async function upsert(table, rows, onConflict) {
  const result = await supabase.from(table).upsert(rows, { onConflict });
  if (result.error) throw result.error;
}

await upsert(
  'schools',
  [
    {
      id: schoolA,
      code: 'school-a',
      legal_name: 'Greenfield Academy Limited',
      display_name: 'Greenfield Academy',
    },
    {
      id: schoolB,
      code: 'school-b',
      legal_name: 'Riverside College Limited',
      display_name: 'Riverside College',
    },
  ],
  'id',
);
await upsert(
  'platform_role_assignments',
  [{ user_id: identities.MODERATOR, role: 'moderator' }],
  'user_id,role',
);
await upsert(
  'school_memberships',
  [
    [schoolA, identities.SCHOOL_A_ADMIN, 'school_admin'],
    [schoolA, identities.SCHOOL_A_TEACHER, 'teacher'],
    [schoolA, identities.SCHOOL_A_STUDENT, 'student'],
    [schoolA, identities.SCHOOL_A_PARENT, 'parent'],
    [schoolB, identities.SCHOOL_B_ADMIN, 'school_admin'],
    [schoolB, identities.SCHOOL_B_TEACHER, 'teacher'],
    [schoolB, identities.SCHOOL_B_STUDENT, 'student'],
  ].map(([school_id, user_id, role]) => ({ school_id, user_id, role, status: 'active' })),
  'school_id,user_id,role',
);
await upsert(
  'tenant_domains',
  [
    ['daaaaaaa-0000-4000-8000-000000000001', schoolA, 'school-a.localhost', 'public_site'],
    ['daaaaaaa-0000-4000-8000-000000000002', schoolA, 'portal.school-a.localhost', 'portal'],
    ['dbbbbbbb-0000-4000-8000-000000000001', schoolB, 'school-b.localhost', 'public_site'],
    ['dbbbbbbb-0000-4000-8000-000000000002', schoolB, 'portal.school-b.localhost', 'portal'],
    ['daaaaaaa-0000-4000-8000-000000000011', schoolA, 'school-a.127-0-0-1.nip.io', 'public_site'],
    ['daaaaaaa-0000-4000-8000-000000000012', schoolA, 'portal.school-a.127-0-0-1.nip.io', 'portal'],
    ['dbbbbbbb-0000-4000-8000-000000000011', schoolB, 'school-b.127-0-0-1.nip.io', 'public_site'],
    ['dbbbbbbb-0000-4000-8000-000000000012', schoolB, 'portal.school-b.127-0-0-1.nip.io', 'portal'],
  ].map(([id, school_id, hostname, domain_type]) => ({
    id,
    school_id,
    hostname,
    domain_type,
    status: 'active',
    verified_at: new Date().toISOString(),
    certificate_status: 'active',
    is_primary: hostname.endsWith('.localhost'),
  })),
  'id',
);

const features = {
  admissions: true,
  news: true,
  'portal.academic': true,
  'portal.students': true,
  'portal.staff': true,
  'portal.results': true,
  'portal.attendance': true,
  'portal.fees': true,
  'portal.admissions': true,
  'portal.parents': true,
  'portal.messages': true,
  'portal.exams': true,
  'portal.lessons': true,
  'portal.assignments': true,
  'portal.library': true,
};
function configuration(school, template, colors) {
  return {
    schemaVersion: 1,
    template,
    branding: {
      logoUrl: null,
      faviconUrl: null,
      colors: {
        ...colors,
        background: '#F7F8FA',
        surface: '#FFFFFF',
        text: '#17212B',
        muted: '#667085',
      },
      fonts: { heading: 'Inter', body: 'Inter' },
      buttonStyle: 'rounded',
      cardStyle: 'bordered',
      inputStyle: 'rounded',
    },
    contact: {
      email: `office@${school.toLowerCase().replaceAll(' ', '-')}.test`,
      phone: '+234 800 000 0000',
      address: '1 Learning Avenue, Lagos',
    },
    socialLinks: [],
    features,
    navigation: [
      { label: 'Home', href: '/', requiredFeature: null },
      { label: 'Admissions', href: '/admissions/', requiredFeature: 'admissions' },
    ],
    pages: [
      {
        slug: '/',
        title: school,
        visible: true,
        blocks: [
          {
            id: randomUUID(),
            type: 'hero',
            heading: `Welcome to ${school}`,
            body: 'A secure Soliventa Learn E2E fixture.',
            imageUrl: null,
            primaryAction: { label: 'Admissions', href: '/admissions/' },
          },
        ],
      },
    ],
  };
}

async function ensurePublishedConfiguration(schoolId, actorId, schoolName, template, colors) {
  const school = await supabase
    .from('schools')
    .select('published_config_version_id')
    .eq('id', schoolId)
    .single();
  if (school.error) throw school.error;
  let versionId = school.data.published_config_version_id;
  let needsPublish = !versionId;
  if (versionId) {
    const current = await supabase
      .from('tenant_config_versions')
      .select('config')
      .eq('id', versionId)
      .single();
    if (current.error) throw current.error;
    needsPublish = Object.keys(features).some(
      (key) => current.data.config?.features?.[key] !== features[key],
    );
  }
  if (needsPublish) {
    const saved = await supabase.rpc('save_tenant_config_draft', {
      _school_id: schoolId,
      _version_id: null,
      _actor_id: actorId,
      _config: configuration(schoolName, template, colors),
    });
    if (saved.error) throw saved.error;
    versionId = saved.data.id;
    const published = await supabase.rpc('publish_tenant_config_as_service', {
      _school_id: schoolId,
      _version_id: versionId,
      _actor_id: actorId,
      _action: 'publish',
    });
    if (published.error) throw published.error;
  }
  await upsert(
    'school_feature_entitlements',
    Object.keys(features).map((feature_key) => ({
      school_id: schoolId,
      feature_key,
      entitled: true,
    })),
    'school_id,feature_key',
  );
}

await ensurePublishedConfiguration(
  schoolA,
  identities.SCHOOL_A_ADMIN,
  'Greenfield Academy',
  'modern-academy',
  { primary: '#173B57', secondary: '#F0A202', accent: '#2E86AB' },
);
await ensurePublishedConfiguration(
  schoolB,
  identities.SCHOOL_B_ADMIN,
  'Riverside College',
  'classic-school',
  { primary: '#3D1A78', secondary: '#F5C542', accent: '#6D44B8' },
);

const schoolASession = 'aa300000-0000-4000-8000-000000000001';
const schoolATerm = 'aa300000-0000-4000-8000-000000000002';
const schoolAClass = 'aa300000-0000-4000-8000-000000000003';
const schoolASubject = 'aa300000-0000-4000-8000-000000000004';
await upsert(
  'academic_sessions',
  [
    {
      id: schoolASession,
      school_id: schoolA,
      name: '2026/2027',
      starts_on: '2026-09-01',
      ends_on: '2027-07-31',
      status: 'active',
    },
  ],
  'id',
);
await upsert(
  'academic_terms',
  [
    {
      id: schoolATerm,
      school_id: schoolA,
      session_id: schoolASession,
      name: 'First Term',
      position: 1,
      starts_on: '2026-09-01',
      ends_on: '2026-12-18',
      status: 'active',
    },
  ],
  'id',
);
await upsert(
  'classes',
  [{ id: schoolAClass, school_id: schoolA, name: 'Primary Five', code: 'P5', active: true }],
  'id',
);
await upsert(
  'subjects',
  [
    {
      id: schoolASubject,
      school_id: schoolA,
      name: 'Mathematics',
      code: 'MATH',
      active: true,
    },
  ],
  'id',
);

await upsert(
  'students',
  [
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      school_id: schoolA,
      user_id: identities.SCHOOL_A_STUDENT,
      admission_number: 'A-001',
      username: 'student-a',
      full_name: 'School A Student',
      first_name: 'School A',
      last_name: 'Student',
      class_id: schoolAClass,
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      school_id: schoolA,
      user_id: null,
      admission_number: 'A-002',
      username: 'student-a-two',
      full_name: 'School A Unlinked Student',
      first_name: 'School A',
      last_name: 'Unlinked Student',
      class_id: schoolAClass,
    },
    {
      id: 'b2000000-0000-4000-8000-000000000001',
      school_id: schoolB,
      user_id: identities.SCHOOL_B_STUDENT,
      admission_number: 'B-001',
      username: 'student-b',
      full_name: 'School B Student',
    },
  ],
  'id',
);
await upsert(
  'guardians',
  [
    {
      id: 'a9000000-0000-4000-8000-000000000001',
      school_id: schoolA,
      user_id: identities.SCHOOL_A_PARENT,
      display_name: 'School A Parent',
    },
  ],
  'id',
);
await upsert(
  'guardian_student_links',
  [
    {
      school_id: schoolA,
      guardian_id: 'a9000000-0000-4000-8000-000000000001',
      student_id: 'a1000000-0000-4000-8000-000000000001',
      relationship: 'Parent',
    },
  ],
  'guardian_id,student_id',
);

console.log(
  'Hosted E2E fixtures are ready. Credentials were rotated and written to ignored .env.e2e.',
);
