begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(27);

-- Unauthenticated users receive no direct database access.
set local role anon;
select is((select count(*)::integer from public.schools), 0, 'anonymous users cannot read schools');
select is((select count(*)::integer from public.students), 0, 'anonymous users cannot read students');

-- School A administrator can manage School A but cannot see or mutate School B.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.schools), 1, 'School A admin reads only School A');
select is((select count(*)::integer from public.students), 2, 'School A admin reads School A students');
select is(
  (select count(*)::integer from public.students where id = 'b2000000-0000-0000-0000-000000000001'),
  0,
  'School A admin cannot guess a School B student UUID'
);
select throws_ok(
  $$insert into public.students (school_id, admission_number, full_name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'B-X', 'Cross Tenant')$$,
  '42501',
  null,
  'School A admin cannot insert into School B'
);
select is(
  (with changed as (
    update public.students set full_name = 'Cross Tenant Update'
    where id = 'b2000000-0000-0000-0000-000000000001' returning 1
  ) select count(*)::integer from changed),
  0,
  'School A admin cannot update School B'
);
select is(
  (with removed as (
    delete from public.students
    where id = 'b2000000-0000-0000-0000-000000000001' returning 1
  ) select count(*)::integer from removed),
  0,
  'School A admin cannot delete from School B'
);

-- Teachers can read their tenant but cannot administer configuration.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.students), 2, 'School A teacher reads School A students');
select throws_ok(
  $$insert into public.tenant_domains (school_id, hostname, domain_type) values ('aaaaaaaa-0000-0000-0000-000000000001', 'forbidden.example.com', 'public_site')$$,
  '42501',
  null,
  'teacher cannot create a domain'
);

-- Students can see themselves and not classmates or another school.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.students), 1, 'student reads only their student record');
select ok(
  exists(select 1 from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'student can read their own record'
);
select is(
  (select count(*)::integer from public.students where id = 'a1000000-0000-0000-0000-000000000002'),
  0,
  'student cannot read a classmate'
);
select is((select count(*)::integer from public.assessment_scores), 0, 'student cannot read unreleased scores');

-- Parents are limited to explicitly linked children.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.students), 1, 'parent reads one linked child');
select ok(
  exists(select 1 from public.students where id = 'a1000000-0000-0000-0000-000000000001'),
  'parent reads the linked child'
);
select is(
  (select count(*)::integer from public.students where id = 'a1000000-0000-0000-0000-000000000002'),
  0,
  'parent cannot read an unlinked child'
);

-- The platform moderator can inspect both tenants but does not bypass constraints.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.schools), 2, 'moderator reads both schools');
select is((select count(*)::integer from public.students), 3, 'moderator reads students across schools');

-- Database invariants reject cross-school references and mutations.
reset role;
select throws_ok(
  $$insert into public.guardian_student_links (school_id, guardian_id, student_id, relationship) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Parent')$$,
  '23503',
  null,
  'cross-school parent link is rejected by a compound foreign key'
);
select throws_ok(
  $$update public.students set school_id = 'bbbbbbbb-0000-0000-0000-000000000001' where id = 'a1000000-0000-0000-0000-000000000002'$$,
  '23514',
  'school_id is immutable',
  'school_id cannot change'
);
select throws_ok(
  $$update public.tenant_branding set primary_color = '#FFFFFF' where config_version_id = 'caaaaaaa-0000-0000-0000-000000000001'$$,
  '55000',
  'published and archived configuration snapshots are immutable',
  'published branding cannot be edited'
);
select throws_ok(
  $$insert into public.tenant_domains (school_id, hostname, domain_type, status, verified_at, is_primary) values ('aaaaaaaa-0000-0000-0000-000000000001', 'second-primary.example.com', 'public_site', 'active', now(), true)$$,
  '23505',
  null,
  'only one primary public domain is permitted per school'
);
select throws_ok(
  $$insert into public.fee_payments (school_id, student_id, amount_minor, paid_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', -1, now())$$,
  '23514',
  null,
  'negative payments are rejected'
);
select throws_ok(
  $$insert into public.assessment_scores (school_id, student_id, assessment_key, score, maximum_score, recorded_by) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'maths-test', 101, 100, '10000000-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'scores above the maximum are rejected'
);

-- Suspending a school makes its ordinary memberships ineffective.
update public.schools set status = 'suspended' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.schools), 0, 'suspended school teacher cannot read the school');
select is((select count(*)::integer from public.students), 0, 'suspended school teacher cannot read students');

select * from finish();
rollback;
