-- Deterministic local-only identities. Never use these credentials outside local development.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'moderator@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-a@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher-a@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'student-a@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'parent-a@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-b@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'teacher-b@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'student-b@local.soliventa.test', extensions.crypt('LocalOnly!123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

-- GoTrue reads these legacy token fields as strings. Explicit empty values keep
-- deterministic fixture users compatible with current and older Auth releases.
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, '')
where email like '%@local.soliventa.test';

insert into public.profiles (user_id, display_name, email)
values
  ('00000000-0000-0000-0000-000000000001', 'Moderator A', 'moderator@local.soliventa.test'),
  ('10000000-0000-0000-0000-000000000001', 'School A Administrator', 'admin-a@local.soliventa.test'),
  ('10000000-0000-0000-0000-000000000002', 'School A Teacher', 'teacher-a@local.soliventa.test'),
  ('10000000-0000-0000-0000-000000000003', 'School A Student', 'student-a@local.soliventa.test'),
  ('10000000-0000-0000-0000-000000000004', 'School A Parent', 'parent-a@local.soliventa.test'),
  ('20000000-0000-0000-0000-000000000001', 'School B Administrator', 'admin-b@local.soliventa.test'),
  ('20000000-0000-0000-0000-000000000002', 'School B Teacher', 'teacher-b@local.soliventa.test'),
  ('20000000-0000-0000-0000-000000000003', 'School B Student', 'student-b@local.soliventa.test')
on conflict (user_id) do nothing;

insert into public.schools (id, code, legal_name, display_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'school-a', 'School A Limited', 'School A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'school-b', 'School B Limited', 'School B')
on conflict (id) do nothing;

insert into public.platform_role_assignments (user_id, role)
values ('00000000-0000-0000-0000-000000000001', 'moderator')
on conflict do nothing;

insert into public.school_memberships (school_id, user_id, role, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'school_admin', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'teacher', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'student', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'parent', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'school_admin', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'teacher', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'student', 'active')
on conflict do nothing;

insert into public.tenant_domains (
  id, school_id, hostname, domain_type, status, verified_at, certificate_status, is_primary
)
values
  ('daaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'school-a.localhost', 'public_site', 'active', now(), 'active', true),
  ('daaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'portal.school-a.localhost', 'portal', 'active', now(), 'active', true),
  ('dbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'school-b.localhost', 'public_site', 'active', now(), 'active', true),
  ('dbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'portal.school-b.localhost', 'portal', 'active', now(), 'active', true)
on conflict (id) do nothing;

insert into public.tenant_config_versions (id, school_id, config, created_by)
values
  ('caaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '{"template":"modern-academy"}', '10000000-0000-0000-0000-000000000001'),
  ('cbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '{"template":"classic-school"}', '20000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.tenant_branding (
  school_id, config_version_id, primary_color, secondary_color, accent_color, heading_font, body_font
)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'caaaaaaa-0000-0000-0000-000000000001', '#173B57', '#F0A202', '#2E86AB', 'Inter', 'Inter'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'cbbbbbbb-0000-0000-0000-000000000001', '#3D1A78', '#F5C542', '#6D44B8', 'Inter', 'Inter')
on conflict (config_version_id) do nothing;

insert into public.tenant_pages (id, school_id, config_version_id, slug, title, template)
values
  ('eaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'caaaaaaa-0000-0000-0000-000000000001', '/', 'School A', 'home'),
  ('ebbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'cbbbbbbb-0000-0000-0000-000000000001', '/', 'School B', 'home')
on conflict (id) do nothing;

insert into public.students (id, school_id, user_id, admission_number, username, full_name)
values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'A-001', 'student-a', 'School A Student'),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'A-002', 'student-a-two', 'School A Unlinked Student'),
  ('b2000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'B-001', 'student-b', 'School B Student')
on conflict (id) do nothing;

insert into public.guardians (id, school_id, user_id, display_name)
values ('a9000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'School A Parent')
on conflict (id) do nothing;

insert into public.guardian_student_links (school_id, guardian_id, student_id, relationship)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Parent')
on conflict do nothing;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select public.publish_tenant_config(
  'aaaaaaaa-0000-0000-0000-000000000001',
  'caaaaaaa-0000-0000-0000-000000000001'
);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
select public.publish_tenant_config(
  'bbbbbbbb-0000-0000-0000-000000000001',
  'cbbbbbbb-0000-0000-0000-000000000001'
);
select set_config('request.jwt.claim.sub', '', false);
