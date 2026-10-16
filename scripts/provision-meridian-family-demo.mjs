import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

if (process.env.CONFIRM_MERIDIAN_FAMILY_DEMO !== 'MERIDIAN_PRODUCTION') {
  throw new Error('Set CONFIRM_MERIDIAN_FAMILY_DEMO=MERIDIAN_PRODUCTION.');
}
for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}.`);
}
if (!process.env.SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
  throw new Error('SUPABASE_SECRET_KEY must use the sb_secret_ format.');
}

const schoolId = '30000000-0000-4000-8000-000000000003';
const portalUrl = 'https://portal.meridian.learn.soliventa.tech';
const parentEmail = 'ireoluwawisdomdev@gmail.com';
const studentEmail = 'ireoluwawisdomdev+meridian-student@gmail.com';
const parentName = 'Ireoluwa Wisdom Demo Parent';
const studentName = 'Meridian Demo Student';
const parentPassword = `${randomBytes(18).toString('base64url')}Aa1!`;
const studentPassword = `${randomBytes(18).toString('base64url')}Aa1!`;

async function resilientFetch(input, init) {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const request = input instanceof Request ? input.clone() : input;
      return await fetch(request, init);
    } catch (error) {
      if (attempt === maximumAttempts) throw error;
      const delayMs = 500 * 2 ** (attempt - 1);
      console.warn(
        `Supabase closed a connection; retrying request ${attempt + 1}/${maximumAttempts} in ${delayMs} ms.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Supabase request retries were exhausted.');
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: resilientFetch },
});

async function findUser(email) {
  const perPage = 200;
  for (let page = 1; page <= 100; page += 1) {
    const listed = await db.auth.admin.listUsers({ page, perPage });
    if (listed.error) throw listed.error;
    const user = listed.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user || listed.data.users.length < perPage) return user;
  }
  throw new Error(`Could not finish searching for ${email}.`);
}

async function ensureUser(email, password, displayName) {
  const existing = await findUser(email);
  const identity = existing
    ? await db.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { ...existing.user_metadata, full_name: displayName, meridian_demo: true },
      })
    : await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: displayName, meridian_demo: true },
      });
  if (identity.error) throw identity.error;
  const profile = await db
    .from('profiles')
    .upsert(
      { user_id: identity.data.user.id, display_name: displayName, email },
      { onConflict: 'user_id' },
    );
  if (profile.error) throw profile.error;
  return identity.data.user.id;
}

async function upsert(table, value, onConflict) {
  const result = await db.from(table).upsert(value, { onConflict }).select();
  if (result.error) throw result.error;
  return result.data;
}

const school = await db.from('schools').select('id').eq('id', schoolId).single();
if (school.error) throw new Error(`Meridian school is unavailable: ${school.error.message}`);
const [sessionResult, feeResult] = await Promise.all([
  db
    .from('academic_sessions')
    .select('id,name')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle(),
  db
    .from('fee_definitions')
    .select('id,name,class_ids,student_audience')
    .eq('school_id', schoolId)
    .eq('active', true)
    .in('student_audience', ['all', 'new'])
    .limit(20),
]);
if (sessionResult.error || !sessionResult.data)
  throw sessionResult.error ?? new Error('Meridian needs an active academic session.');
if (feeResult.error) throw feeResult.error;
const targetedClassId = (feeResult.data ?? []).flatMap((fee) =>
  Array.isArray(fee.class_ids) ? fee.class_ids : [],
)[0];
const classResult = targetedClassId
  ? await db
      .from('classes')
      .select('id,name')
      .eq('school_id', schoolId)
      .eq('id', targetedClassId)
      .eq('active', true)
      .single()
  : await db
      .from('classes')
      .select('id,name')
      .eq('school_id', schoolId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
if (classResult.error || !classResult.data)
  throw classResult.error ?? new Error('Meridian needs an active class.');

const parentUserId = await ensureUser(parentEmail, parentPassword, parentName);
const studentUserId = await ensureUser(studentEmail, studentPassword, studentName);
await upsert(
  'school_memberships',
  [
    { school_id: schoolId, user_id: parentUserId, role: 'parent', status: 'active' },
    { school_id: schoolId, user_id: studentUserId, role: 'student', status: 'active' },
  ],
  'school_id,user_id,role',
);

let student = await db
  .from('students')
  .select('id')
  .eq('school_id', schoolId)
  .eq('user_id', studentUserId)
  .maybeSingle();
if (student.error) throw student.error;
if (!student.data) {
  const admissionNumber = await db.rpc('next_school_identifier', {
    _school_id: schoolId,
    _kind: 'admission',
    _name: studentName,
  });
  if (admissionNumber.error) throw admissionNumber.error;
  const inserted = await db
    .from('students')
    .insert({
      school_id: schoolId,
      user_id: studentUserId,
      admission_number: String(admissionNumber.data),
      full_name: studentName,
      first_name: 'Meridian Demo',
      last_name: 'Student',
      class_id: classResult.data.id,
      status: 'active',
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  student = inserted;
} else {
  const updated = await db
    .from('students')
    .update({ class_id: classResult.data.id, status: 'active' })
    .eq('id', student.data.id);
  if (updated.error) throw updated.error;
}
await upsert(
  'student_enrollments',
  {
    school_id: schoolId,
    student_id: student.data.id,
    class_id: classResult.data.id,
    session_id: sessionResult.data.id,
    active: true,
  },
  'student_id,session_id',
);

let guardian = await db
  .from('guardians')
  .select('id')
  .eq('school_id', schoolId)
  .eq('user_id', parentUserId)
  .maybeSingle();
if (guardian.error) throw guardian.error;
if (!guardian.data) {
  const guardianNumber = await db.rpc('next_school_identifier', {
    _school_id: schoolId,
    _kind: 'guardian',
    _name: parentName,
  });
  if (guardianNumber.error) throw guardianNumber.error;
  const inserted = await db
    .from('guardians')
    .insert({
      school_id: schoolId,
      user_id: parentUserId,
      display_name: parentName,
      guardian_number: String(guardianNumber.data),
    })
    .select('id')
    .single();
  if (inserted.error) throw inserted.error;
  guardian = inserted;
}
await upsert(
  'guardian_student_links',
  {
    school_id: schoolId,
    guardian_id: guardian.data.id,
    student_id: student.data.id,
    relationship: 'Parent',
  },
  'guardian_id,student_id',
);

const verification = await db
  .from('guardian_student_links')
  .select('guardian_id,student_id')
  .eq('school_id', schoolId)
  .eq('guardian_id', guardian.data.id)
  .eq('student_id', student.data.id)
  .single();
if (verification.error) throw verification.error;
await writeFile(
  '.env.meridian-family-demo',
  [
    `MERIDIAN_PORTAL_URL=${portalUrl}`,
    `MERIDIAN_PARENT_EMAIL=${parentEmail}`,
    `MERIDIAN_PARENT_PASSWORD=${parentPassword}`,
    `MERIDIAN_STUDENT_EMAIL=${studentEmail}`,
    `MERIDIAN_STUDENT_PASSWORD=${studentPassword}`,
    `MERIDIAN_STUDENT_CLASS=${classResult.data.name}`,
    `MERIDIAN_SESSION=${sessionResult.data.name}`,
    '',
  ].join('\n'),
  { encoding: 'utf8', mode: 0o600 },
);
console.log(
  'Meridian family demo provisioned and verified. Credentials written to .env.meridian-family-demo.',
);
