-- Identity and authorization are deliberately independent from domain records.
-- auth.users authenticates; accounts identify; tenant memberships establish lifecycle context;
-- role assignments grant permissions and optional resource scopes.

create type public.account_status as enum ('pending_verification', 'active', 'locked', 'disabled', 'closed');
create type public.membership_kind as enum ('applicant', 'guardian', 'student', 'teacher', 'administrator', 'specialist');
create type public.lifecycle_event_kind as enum ('created', 'transitioned', 'suspended', 'reactivated', 'ended', 'converted');

create table public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  status public.account_status not null default 'active',
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  primary_email extensions.citext,
  primary_phone text,
  avatar_url text,
  locale text not null default 'en-NG',
  timezone text not null default 'Africa/Lagos',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  disabled_at timestamptz,
  disabled_reason text,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'disabled' and disabled_at is not null) or (status <> 'disabled' and disabled_at is null))
);

comment on table public.accounts is 'Tenant-independent application identity; authentication remains in auth.users.';

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind public.membership_kind not null,
  status public.membership_status not null default 'active',
  lifecycle_state text not null default 'active' check (char_length(trim(lifecycle_state)) between 2 and 80),
  external_reference text,
  display_name text,
  joined_at timestamptz,
  suspended_at timestamptz,
  ended_at timestamptz,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, account_id, kind),
  unique (school_id, id),
  unique (id, school_id),
  check (valid_until is null or valid_until > valid_from),
  check (status <> 'suspended' or suspended_at is not null),
  check (status <> 'revoked' or ended_at is not null)
);

create unique index tenant_memberships_external_reference_idx
  on public.tenant_memberships(school_id, external_reference) where external_reference is not null;
create index tenant_memberships_account_idx on public.tenant_memberships(account_id, status);
create index tenant_memberships_school_kind_idx on public.tenant_memberships(school_id, kind, status);

create table public.membership_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  membership_id uuid not null,
  event_kind public.lifecycle_event_kind not null,
  from_state text,
  to_state text not null,
  reason text,
  actor_account_id uuid references public.accounts(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (membership_id, school_id) references public.tenant_memberships(id, school_id) on delete cascade
);

create index membership_lifecycle_events_history_idx
  on public.membership_lifecycle_events(membership_id, occurred_at desc);

create table public.membership_entity_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  membership_id uuid not null,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,79}$'),
  entity_id uuid not null,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, membership_id, entity_type, entity_id),
  foreign key (membership_id, school_id) references public.tenant_memberships(id, school_id) on delete cascade
);

create unique index membership_entity_primary_idx
  on public.membership_entity_links(school_id, entity_type, entity_id) where is_primary;

create table public.authorization_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.:-]{2,100}$'),
  resource text not null,
  action text not null,
  description text,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.authorization_roles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  name text not null check (char_length(trim(name)) between 2 and 100),
  description text,
  is_system boolean not null default false,
  is_assignable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index authorization_global_role_code_idx
  on public.authorization_roles(code) where school_id is null;
create unique index authorization_school_role_code_idx
  on public.authorization_roles(school_id, code) where school_id is not null;

create table public.authorization_role_permissions (
  role_id uuid not null references public.authorization_roles(id) on delete cascade,
  permission_id uuid not null references public.authorization_permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.membership_role_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  membership_id uuid not null,
  role_id uuid not null references public.authorization_roles(id) on delete cascade,
  resource_scope jsonb not null default '{}'::jsonb check (jsonb_typeof(resource_scope) = 'object'),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  assigned_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (membership_id, role_id),
  check (valid_until is null or valid_until > valid_from),
  foreign key (membership_id, school_id) references public.tenant_memberships(id, school_id) on delete cascade
);

create index membership_role_assignments_school_idx on public.membership_role_assignments(school_id);

create table public.identity_security_events (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools(id) on delete set null,
  actor_account_id uuid references public.accounts(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz not null default now()
);
create index identity_security_events_school_time_idx on public.identity_security_events(school_id,occurred_at desc);

-- Platform assignments intentionally remain outside tenant memberships. This maps the existing
-- platform role to permission bundles without granting production tenant access implicitly.
create table public.platform_authorization_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.platform_authorization_role_permissions (
  role_id uuid not null references public.platform_authorization_roles(id) on delete cascade,
  permission_id uuid not null references public.authorization_permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

insert into public.authorization_permissions(code, resource, action, description, sensitive) values
  ('students.read','students','read','Read authorized student records',true),
  ('students.create','students','create','Create student records',true),
  ('students.update','students','update','Update student records',true),
  ('students.delete','students','delete','Delete student records',true),
  ('staff.manage','staff','manage','Manage staff identities and memberships',true),
  ('academic.read','academic','read','Read academic structure',false),
  ('academic.manage','academic','manage','Manage academic structure',true),
  ('attendance.record','attendance','record','Record attendance in authorized scope',true),
  ('results.read','results','read','Read results in authorized scope',true),
  ('results.record','results','record','Record results in authorized scope',true),
  ('results.release','results','release','Release approved results',true),
  ('fees.read','finance','read','Read financial records in authorized scope',true),
  ('fees.manage','finance','manage','Manage fees and invoices',true),
  ('payments.verify','payments','verify','Verify payments',true),
  ('admissions.manage','admissions','manage','Manage admissions',true),
  ('admissions.read','admissions','read','Read admissions in authorized scope',true),
  ('parents.manage','guardians','manage','Manage guardian relationships',true),
  ('parents.read','guardians','read','Read guardian records in authorized scope',true),
  ('messages.read','messages','read','Read authorized messages',true),
  ('messages.send','messages','send','Send authorized messages',true),
  ('exams.read','exams','read','Read assigned examinations',true),
  ('exams.manage','exams','manage','Manage examinations in authorized scope',true),
  ('assignments.read','assignments','read','Read assignments',false),
  ('assignments.manage','assignments','manage','Manage assigned classwork',true),
  ('lessons.read','lessons','read','Read published lessons',false),
  ('lessons.manage','lessons','manage','Manage lessons in assigned scope',true),
  ('library.read','library','read','Read library records',false),
  ('library.manage','library','manage','Manage library records',true),
  ('school.configure','school','configure','Configure school tenant',true),
  ('domains.manage','domains','manage','Manage tenant domains',true),
  ('children.read','students','read_linked','Read explicitly linked children',true),
  ('self.read','identity','read_self','Read own domain record',true),
  ('applicant.self.read','applicant','read_self','Read only the linked applicant aggregate',true),
  ('membership.read','membership','read','Read tenant memberships',true),
  ('membership.manage','membership','manage','Create and transition tenant memberships',true),
  ('roles.read','authorization','read','Read roles and grants',true),
  ('roles.manage','authorization','manage','Manage tenant roles and grants',true),
  ('audit.read','audit','read','Read tenant audit events',true),
  ('platform.schools.read','platform_school','read','Read platform school registry',true),
  ('platform.schools.manage','platform_school','manage','Manage platform school lifecycle',true),
  ('platform.settings.manage','platform_settings','manage','Manage platform settings',true),
  ('platform.manage','platform','manage','Operate platform controls without implicit tenant data access',true);

insert into public.authorization_roles(code,name,description,is_system) values
  ('super_admin','School owner','Full tenant administration',true),
  ('school_admin','School administrator','General tenant administration',true),
  ('teacher','Teacher','Assigned teaching resources',true),
  ('student','Student','Own enrolled learner experience',true),
  ('parent','Parent or guardian','Explicitly linked children',true),
  ('applicant','Applicant','Own pre-enrolment application',true),
  ('admissions_officer','Admissions officer','Admissions specialist',true),
  ('bursar','Bursar','Finance specialist',true),
  ('librarian','Librarian','Library specialist',true),
  ('exam_officer','Exam officer','Examination specialist',true),
  ('registrar','Registrar','Academic records specialist',true);

insert into public.authorization_role_permissions(role_id,permission_id)
select r.id,p.id from public.authorization_roles r cross join public.authorization_permissions p
where r.school_id is null and (
  (r.code = 'super_admin' and p.code not like 'platform.%')
  or (r.code = 'school_admin' and p.code not like 'platform.%')
  or (r.code = 'teacher' and p.code in ('students.read','academic.read','attendance.record','results.read','results.record','exams.read','assignments.read','assignments.manage','lessons.read','lessons.manage','messages.read','messages.send'))
  or (r.code = 'student' and p.code in ('self.read','results.read','fees.read','messages.read','messages.send','exams.read','assignments.read','lessons.read','library.read'))
  or (r.code = 'parent' and p.code in ('children.read','results.read','fees.read','parents.read','messages.read','messages.send'))
  or (r.code = 'applicant' and p.code in ('self.read','applicant.self.read','fees.read','messages.read','messages.send','exams.read'))
  or (r.code = 'admissions_officer' and p.code in ('admissions.read','admissions.manage','students.read','parents.read','messages.read','messages.send'))
  or (r.code = 'bursar' and p.code in ('students.read','academic.read','fees.read','fees.manage','payments.verify'))
  or (r.code = 'librarian' and p.code in ('students.read','academic.read','library.read','library.manage','messages.read','messages.send'))
  or (r.code = 'exam_officer' and p.code in ('students.read','academic.read','results.read','results.record','results.release','exams.read','exams.manage'))
  or (r.code = 'registrar' and p.code in ('students.read','students.update','academic.read','results.read','membership.read'))
);

insert into public.platform_authorization_roles(code,name) values ('moderator','Platform moderator');
insert into public.platform_authorization_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_authorization_roles r cross join public.authorization_permissions p
where r.code='moderator' and p.code like 'platform.%';

create or replace function public.membership_kind_for_school_role(_role public.school_role)
returns public.membership_kind language sql immutable set search_path = '' as $$
  select case _role::text
    when 'student' then 'student'::public.membership_kind
    when 'parent' then 'guardian'::public.membership_kind
    when 'teacher' then 'teacher'::public.membership_kind
    when 'super_admin' then 'administrator'::public.membership_kind
    when 'school_admin' then 'administrator'::public.membership_kind
    else 'specialist'::public.membership_kind end
$$;

insert into public.accounts(id,status,display_name,primary_email,primary_phone,avatar_url,email_verified_at,phone_verified_at,created_at)
select u.id,'active',coalesce(p.display_name,u.raw_user_meta_data->>'full_name',split_part(coalesce(u.email,u.phone,u.id::text),'@',1)),
  coalesce(p.email,u.email),coalesce(p.phone,u.phone),coalesce(p.avatar_url,u.raw_user_meta_data->>'avatar_url'),
  u.email_confirmed_at,u.phone_confirmed_at,u.created_at
from auth.users u left join public.profiles p on p.user_id=u.id on conflict(id) do nothing;

insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,joined_at)
select distinct on (school_id,user_id,public.membership_kind_for_school_role(role))
  school_id,user_id,public.membership_kind_for_school_role(role),status,
  case when status='active' then 'active' else status::text end,created_at
from public.school_memberships
order by school_id,user_id,public.membership_kind_for_school_role(role),
  case status when 'active' then 0 when 'invited' then 1 when 'suspended' then 2 else 3 end,
  created_at
on conflict(school_id,account_id,kind) do nothing;

insert into public.membership_role_assignments(school_id,membership_id,role_id)
select sm.school_id,tm.id,ar.id from public.school_memberships sm
join public.tenant_memberships tm on tm.school_id=sm.school_id and tm.account_id=sm.user_id
  and tm.kind=public.membership_kind_for_school_role(sm.role)
join public.authorization_roles ar on ar.school_id is null and ar.code=sm.role::text
on conflict(membership_id,role_id) do nothing;

insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
select s.school_id,tm.id,'student',s.id from public.students s
join public.tenant_memberships tm on tm.school_id=s.school_id and tm.account_id=s.user_id and tm.kind='student'
where s.user_id is not null on conflict do nothing;

insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
select g.school_id,tm.id,'guardian',g.id from public.guardians g
join public.tenant_memberships tm on tm.school_id=g.school_id and tm.account_id=g.user_id and tm.kind='guardian'
on conflict do nothing;

create or replace function public.bootstrap_account_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts(id,display_name,primary_email,primary_phone,avatar_url,email_verified_at,phone_verified_at)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,new.phone,new.id::text),'@',1)),
    new.email,new.phone,new.raw_user_meta_data->>'avatar_url',new.email_confirmed_at,new.phone_confirmed_at)
  on conflict(id) do update set primary_email=excluded.primary_email,primary_phone=excluded.primary_phone,
    email_verified_at=excluded.email_verified_at,phone_verified_at=excluded.phone_verified_at,updated_at=now();
  return new;
end;
$$;
create trigger auth_user_account_bootstrap after insert or update of email,phone,email_confirmed_at,phone_confirmed_at
on auth.users for each row execute function public.bootstrap_account_identity();

create or replace function public.sync_school_membership_to_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare _membership_id uuid; _role_id uuid;
begin
  insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,joined_at,ended_at,suspended_at)
  values(new.school_id,new.user_id,public.membership_kind_for_school_role(new.role),new.status,new.status::text,now(),
    case when new.status='revoked' then now() end,case when new.status='suspended' then now() end)
  on conflict(school_id,account_id,kind) do update set status=excluded.status,lifecycle_state=excluded.lifecycle_state,
    ended_at=excluded.ended_at,suspended_at=excluded.suspended_at,updated_at=now() returning id into _membership_id;
  select id into _role_id from public.authorization_roles where school_id is null and code=new.role::text;
  insert into public.membership_role_assignments(school_id,membership_id,role_id)
  values(new.school_id,_membership_id,_role_id) on conflict(membership_id,role_id) do nothing;
  return new;
end;
$$;
create trigger school_membership_identity_sync after insert or update of status,role
on public.school_memberships for each row execute function public.sync_school_membership_to_identity();

create or replace function public.revoke_school_membership_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare _membership_id uuid; _role_id uuid;
begin
  select id into _membership_id from public.tenant_memberships
  where school_id=old.school_id and account_id=old.user_id and kind=public.membership_kind_for_school_role(old.role);
  select id into _role_id from public.authorization_roles where school_id is null and code=old.role::text;
  delete from public.membership_role_assignments where membership_id=_membership_id and role_id=_role_id;
  if _membership_id is not null and not exists(select 1 from public.school_memberships sm
    where sm.school_id=old.school_id and sm.user_id=old.user_id
      and public.membership_kind_for_school_role(sm.role)=public.membership_kind_for_school_role(old.role)) then
    update public.tenant_memberships set status='revoked',lifecycle_state='access_revoked',ended_at=now(),updated_at=now()
    where id=_membership_id;
  end if;
  return old;
end;
$$;
create trigger school_membership_identity_revoke after delete on public.school_memberships
for each row execute function public.revoke_school_membership_identity();
create trigger school_membership_identity_revoke_on_update after update of school_id,user_id,role
on public.school_memberships for each row
when (old.school_id is distinct from new.school_id or old.user_id is distinct from new.user_id or old.role is distinct from new.role)
execute function public.revoke_school_membership_identity();

create or replace function public.record_membership_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,to_state,actor_account_id)
    values(new.school_id,new.id,'created',new.lifecycle_state,auth.uid());
  elsif old.lifecycle_state is distinct from new.lifecycle_state or old.status is distinct from new.status then
    insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,from_state,to_state,actor_account_id,metadata)
    values(new.school_id,new.id,
      case when new.status='suspended' then 'suspended'::public.lifecycle_event_kind
        when old.status='suspended' and new.status='active' then 'reactivated'::public.lifecycle_event_kind
        when new.status='revoked' then 'ended'::public.lifecycle_event_kind
        else 'transitioned'::public.lifecycle_event_kind end,
      old.lifecycle_state,new.lifecycle_state,auth.uid(),jsonb_build_object('fromStatus',old.status,'toStatus',new.status));
  end if;
  return new;
end;
$$;
create trigger tenant_membership_lifecycle after insert or update of status,lifecycle_state
on public.tenant_memberships for each row execute function public.record_membership_lifecycle();

create or replace function public.validate_membership_role_school()
returns trigger language plpgsql set search_path = '' as $$
declare _role_school uuid;
begin
  select school_id into _role_school from public.authorization_roles where id=new.role_id;
  if _role_school is not null and _role_school<>new.school_id then raise exception 'role_school_mismatch' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger membership_role_school_guard before insert or update on public.membership_role_assignments
for each row execute function public.validate_membership_role_school();

create or replace function public.account_has_permission(_account_id uuid,_school_id uuid,_permission text,_scope jsonb default '{}'::jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.accounts a join public.tenant_memberships tm on tm.account_id=a.id
    join public.membership_role_assignments ma on ma.membership_id=tm.id and ma.school_id=tm.school_id
    join public.authorization_roles ar on ar.id=ma.role_id and (ar.school_id is null or ar.school_id=tm.school_id)
    join public.authorization_role_permissions rp on rp.role_id=ar.id
    join public.authorization_permissions p on p.id=rp.permission_id
    where (_account_id=auth.uid() or auth.role()='service_role')
      and a.id=_account_id and a.status='active' and tm.school_id=_school_id and tm.status='active'
      and p.code=_permission and tm.valid_from<=now() and (tm.valid_until is null or tm.valid_until>now())
      and ma.valid_from<=now() and (ma.valid_until is null or ma.valid_until>now())
      and (ma.resource_scope='{}'::jsonb or ma.resource_scope @> _scope));
$$;

create or replace function public.get_account_workspaces(_account_id uuid default auth.uid())
returns table(membership_id uuid,school_id uuid,school_name text,membership_kind public.membership_kind,
  membership_status public.membership_status,lifecycle_state text,role_codes text[],permissions text[],resource_scopes jsonb)
language sql stable security definer set search_path = '' as $$
  select tm.id,s.id,s.display_name,tm.kind,tm.status,tm.lifecycle_state,
    coalesce(array_agg(distinct ar.code) filter(where ar.code is not null),'{}'::text[]),
    coalesce(array_agg(distinct p.code) filter(where p.code is not null),'{}'::text[]),
    coalesce(jsonb_object_agg(ar.code,ma.resource_scope) filter(where ar.code is not null),'{}'::jsonb)
  from public.tenant_memberships tm join public.schools s on s.id=tm.school_id
  left join public.membership_role_assignments ma on ma.membership_id=tm.id and ma.valid_from<=now() and (ma.valid_until is null or ma.valid_until>now())
  left join public.authorization_roles ar on ar.id=ma.role_id
  left join public.authorization_role_permissions rp on rp.role_id=ar.id
  left join public.authorization_permissions p on p.id=rp.permission_id
  where tm.account_id=_account_id and (_account_id=auth.uid() or auth.role()='service_role')
    and tm.status in ('active','invited') and tm.valid_from<=now() and (tm.valid_until is null or tm.valid_until>now())
  group by tm.id,s.id,s.display_name,tm.kind,tm.status,tm.lifecycle_state order by s.display_name,tm.kind;
$$;

create or replace function public.transition_tenant_membership(_membership_id uuid,_status public.membership_status,_state text,_reason text)
returns public.tenant_memberships language plpgsql security definer set search_path = '' as $$
declare _row public.tenant_memberships;
begin
  select * into _row from public.tenant_memberships where id=_membership_id for update;
  if _row.id is null then raise exception 'membership_not_found' using errcode='P0002'; end if;
  if not public.account_has_permission(auth.uid(),_row.school_id,'membership.manage') then raise exception 'permission_denied' using errcode='42501'; end if;
  update public.tenant_memberships set status=_status,lifecycle_state=_state,
    suspended_at=case when _status='suspended' then now() end,
    ended_at=case when _status='revoked' then now() end,updated_at=now()
  where id=_membership_id returning * into _row;
  update public.membership_lifecycle_events set reason=_reason where id=(select id from public.membership_lifecycle_events where membership_id=_membership_id order by occurred_at desc limit 1);
  return _row;
end;
$$;

create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger tenant_memberships_updated_at before update on public.tenant_memberships for each row execute function public.set_updated_at();
create trigger authorization_roles_updated_at before update on public.authorization_roles for each row execute function public.set_updated_at();

create or replace function public.audit_identity_security_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare _school_id uuid; _target_id text;
begin
  _school_id:=case when tg_op='DELETE' then old.school_id else new.school_id end;
  _target_id:=case when tg_op='DELETE' then old.id::text else new.id::text end;
  insert into public.identity_security_events(school_id,actor_account_id,action,target_type,target_id)
  values(_school_id,auth.uid(),lower(tg_op),tg_table_name,_target_id);
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger tenant_memberships_audit after insert or update or delete on public.tenant_memberships for each row execute function public.audit_identity_security_change();
create trigger membership_roles_audit after insert or update or delete on public.membership_role_assignments for each row execute function public.audit_identity_security_change();

alter table public.accounts enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.membership_lifecycle_events enable row level security;
alter table public.membership_entity_links enable row level security;
alter table public.authorization_permissions enable row level security;
alter table public.authorization_roles enable row level security;
alter table public.authorization_role_permissions enable row level security;
alter table public.membership_role_assignments enable row level security;
alter table public.platform_authorization_roles enable row level security;
alter table public.platform_authorization_role_permissions enable row level security;
alter table public.identity_security_events enable row level security;

create policy accounts_self_read on public.accounts for select to authenticated using(id=auth.uid());
create policy accounts_self_update on public.accounts for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy memberships_self_read on public.tenant_memberships for select to authenticated using(account_id=auth.uid());
create policy memberships_authorized_read on public.tenant_memberships for select to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'membership.read'));
create policy memberships_authorized_insert on public.tenant_memberships for insert to authenticated
  with check(public.account_has_permission(auth.uid(),school_id,'membership.manage'));
create policy lifecycle_self_read on public.membership_lifecycle_events for select to authenticated
  using(exists(select 1 from public.tenant_memberships tm where tm.id=membership_id and tm.account_id=auth.uid()));
create policy lifecycle_authorized_read on public.membership_lifecycle_events for select to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'membership.read'));
create policy entity_links_self_read on public.membership_entity_links for select to authenticated
  using(exists(select 1 from public.tenant_memberships tm where tm.id=membership_id and tm.account_id=auth.uid()));
create policy entity_links_authorized_manage on public.membership_entity_links for all to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'membership.manage'))
  with check(public.account_has_permission(auth.uid(),school_id,'membership.manage'));
create policy permissions_member_read on public.authorization_permissions for select to authenticated using(true);
create policy roles_member_read on public.authorization_roles for select to authenticated
  using(school_id is null or exists(select 1 from public.tenant_memberships tm where tm.school_id=authorization_roles.school_id and tm.account_id=auth.uid() and tm.status='active'));
create policy roles_authorized_insert on public.authorization_roles for insert to authenticated
  with check(school_id is not null and not is_system and public.account_has_permission(auth.uid(),school_id,'roles.manage'));
create policy roles_authorized_update on public.authorization_roles for update to authenticated
  using(school_id is not null and not is_system and public.account_has_permission(auth.uid(),school_id,'roles.manage'))
  with check(school_id is not null and not is_system and public.account_has_permission(auth.uid(),school_id,'roles.manage'));
create policy roles_authorized_delete on public.authorization_roles for delete to authenticated
  using(school_id is not null and not is_system and public.account_has_permission(auth.uid(),school_id,'roles.manage'));
create policy role_permissions_member_read on public.authorization_role_permissions for select to authenticated using(true);
create policy role_permissions_authorized_manage on public.authorization_role_permissions for all to authenticated
  using(exists(select 1 from public.authorization_roles ar where ar.id=role_id and ar.school_id is not null
    and not ar.is_system and public.account_has_permission(auth.uid(),ar.school_id,'roles.manage')))
  with check(exists(select 1 from public.authorization_roles ar where ar.id=role_id and ar.school_id is not null
    and not ar.is_system and public.account_has_permission(auth.uid(),ar.school_id,'roles.manage')));
create policy assignments_self_read on public.membership_role_assignments for select to authenticated
  using(exists(select 1 from public.tenant_memberships tm where tm.id=membership_id and tm.account_id=auth.uid()));
create policy assignments_authorized_manage on public.membership_role_assignments for all to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'roles.manage'))
  with check(public.account_has_permission(auth.uid(),school_id,'roles.manage'));
create policy identity_security_authorized_read on public.identity_security_events for select to authenticated
  using(school_id is not null and public.account_has_permission(auth.uid(),school_id,'audit.read'));

revoke execute on function public.get_account_workspaces(uuid) from public,anon;
revoke execute on function public.account_has_permission(uuid,uuid,text,jsonb) from public,anon;
revoke execute on function public.transition_tenant_membership(uuid,public.membership_status,text,text) from public,anon;
revoke update on public.accounts from authenticated;
grant update(display_name,primary_phone,avatar_url,locale,timezone,metadata,last_seen_at) on public.accounts to authenticated;
grant execute on function public.get_account_workspaces(uuid) to authenticated;
grant execute on function public.account_has_permission(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.transition_tenant_membership(uuid,public.membership_status,text,text) to authenticated;

notify pgrst,'reload schema';
