-- Soliventa Learn greenfield tenancy baseline.
-- This schema is intentionally new and does not derive from the legacy database.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.school_status as enum ('active', 'suspended', 'archived');
create type public.platform_role as enum ('moderator');
create type public.school_role as enum (
  'super_admin',
  'school_admin',
  'teacher',
  'student',
  'parent',
  'bursar',
  'librarian',
  'exam_officer'
);
create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type public.domain_type as enum ('public_site', 'portal');
create type public.domain_status as enum (
  'pending',
  'awaiting_dns',
  'verifying',
  'active',
  'failed',
  'suspended',
  'removed'
);
create type public.verification_method as enum ('cname', 'txt', 'delegated');
create type public.certificate_status as enum (
  'pending',
  'provisioning',
  'active',
  'failed',
  'expired'
);
create type public.config_status as enum ('draft', 'published', 'archived');
create type public.student_status as enum (
  'active',
  'graduated',
  'withdrawn',
  'suspended',
  'transferred'
);
create type public.cache_invalidation_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 160),
  email extensions.citext,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  code extensions.citext not null unique check (code::text ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}$'),
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 200),
  display_name text not null check (char_length(trim(display_name)) between 2 and 200),
  status public.school_status not null default 'active',
  published_config_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, published_config_version_id)
);

create table public.platform_role_assignments (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.platform_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.school_role not null,
  status public.membership_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id, role),
  unique (school_id, id)
);

create table public.tenant_config_versions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  version bigint generated always as identity,
  status public.config_status not null default 'draft',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_by uuid not null references auth.users (id) on delete restrict,
  published_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (school_id, version),
  unique (school_id, id),
  check (
    (status = 'draft' and published_by is null and published_at is null)
    or (status in ('published', 'archived') and published_by is not null and published_at is not null)
  )
);

alter table public.schools
  add constraint schools_published_config_same_school_fk
  foreign key (id, published_config_version_id)
  references public.tenant_config_versions (school_id, id)
  deferrable initially deferred;

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  hostname text not null,
  normalized_hostname text generated always as (
    lower(regexp_replace(trim(hostname), '\.$', ''))
  ) stored,
  domain_type public.domain_type not null,
  status public.domain_status not null default 'pending',
  verification_method public.verification_method not null default 'cname',
  verification_token_hash text,
  verified_at timestamptz,
  certificate_status public.certificate_status not null default 'pending',
  is_primary boolean not null default false,
  redirect_to_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_hostname),
  unique (school_id, id),
  check (
    normalized_hostname ~ '^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
    or normalized_hostname ~ '^[a-z0-9][a-z0-9-]{0,62}(\.[a-z0-9][a-z0-9-]{0,62})*\.localhost$'
  ),
  check (not (is_primary and redirect_to_primary)),
  check ((status = 'active' and verified_at is not null) or status <> 'active')
);

create unique index tenant_domains_one_primary_per_type_idx
  on public.tenant_domains (school_id, domain_type)
  where is_primary and status <> 'removed';

create table public.tenant_branding (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  config_version_id uuid not null,
  logo_url text,
  favicon_url text,
  primary_color text not null check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text not null check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  heading_font text not null,
  body_font text not null,
  tokens jsonb not null default '{}'::jsonb check (jsonb_typeof(tokens) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (config_version_id),
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade
);

create table public.tenant_features (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  config_version_id uuid not null,
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  unique (config_version_id, feature_key),
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade
);

create table public.tenant_navigation (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  config_version_id uuid not null,
  location text not null check (location in ('header', 'footer', 'portal')),
  label text not null check (char_length(trim(label)) between 1 and 80),
  href text not null check (char_length(trim(href)) between 1 and 500),
  position integer not null check (position >= 0),
  required_feature text,
  visible boolean not null default true,
  unique (config_version_id, location, position),
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade
);

create table public.tenant_pages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  config_version_id uuid not null,
  slug text not null check (slug = '/' or slug ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$'),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text check (description is null or char_length(description) <= 320),
  template text not null check (template ~ '^[a-z][a-z0-9-]{1,80}$'),
  seo jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object'),
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (config_version_id, slug),
  unique (school_id, id),
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade
);

create table public.tenant_page_blocks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  config_version_id uuid not null,
  page_id uuid not null,
  block_type text not null check (block_type ~ '^[a-z][a-z0-9-]{1,80}$'),
  position integer not null check (position >= 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, position),
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade,
  foreign key (school_id, page_id)
    references public.tenant_pages (school_id, id) on delete cascade
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  admission_number text not null,
  username extensions.citext,
  full_name text not null check (char_length(trim(full_name)) between 2 and 200),
  status public.student_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, admission_number),
  unique (school_id, id)
);

create unique index students_active_username_idx
  on public.students (school_id, username)
  where username is not null and status = 'active';
create unique index students_user_id_idx on public.students (user_id) where user_id is not null;

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id),
  unique (school_id, id)
);

create table public.guardian_student_links (
  school_id uuid not null references public.schools (id) on delete cascade,
  guardian_id uuid not null,
  student_id uuid not null,
  relationship text not null check (char_length(trim(relationship)) between 2 and 60),
  created_at timestamptz not null default now(),
  primary key (guardian_id, student_id),
  foreign key (school_id, guardian_id)
    references public.guardians (school_id, id) on delete cascade,
  foreign key (school_id, student_id)
    references public.students (school_id, id) on delete cascade
);

create table public.fee_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = upper(currency)),
  provider text,
  provider_reference text,
  recorded_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (school_id, student_id)
    references public.students (school_id, id) on delete restrict
);

create table public.assessment_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  assessment_key text not null check (char_length(trim(assessment_key)) between 1 and 100),
  score numeric(7, 2) not null check (score >= 0),
  maximum_score numeric(7, 2) not null check (maximum_score > 0 and score <= maximum_score),
  recorded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, assessment_key),
  foreign key (school_id, student_id)
    references public.students (school_id, id) on delete cascade
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 2 and 80),
  entity_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create table public.cache_invalidation_outbox (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  config_version_id uuid not null,
  status public.cache_invalidation_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key (school_id, config_version_id)
    references public.tenant_config_versions (school_id, id) on delete cascade
);

create index school_memberships_user_school_idx
  on public.school_memberships (user_id, school_id) where status = 'active';
create index school_memberships_school_role_idx
  on public.school_memberships (school_id, role) where status = 'active';
create index tenant_domains_school_idx on public.tenant_domains (school_id, domain_type, status);
create index tenant_config_versions_school_status_idx
  on public.tenant_config_versions (school_id, status);
create unique index tenant_config_one_published_idx
  on public.tenant_config_versions (school_id) where status = 'published';
create index tenant_features_school_version_idx
  on public.tenant_features (school_id, config_version_id);
create index tenant_branding_school_version_idx
  on public.tenant_branding (school_id, config_version_id);
create index tenant_navigation_school_version_idx
  on public.tenant_navigation (school_id, config_version_id);
create index tenant_pages_school_version_idx
  on public.tenant_pages (school_id, config_version_id);
create index tenant_page_blocks_page_idx on public.tenant_page_blocks (page_id, position);
create index tenant_page_blocks_school_version_idx
  on public.tenant_page_blocks (school_id, config_version_id);
create index students_school_status_idx on public.students (school_id, status);
create index guardian_student_links_school_student_idx
  on public.guardian_student_links (school_id, student_id);
create index fee_payments_school_student_idx on public.fee_payments (school_id, student_id, paid_at desc);
create unique index fee_payments_provider_reference_idx
  on public.fee_payments (provider, provider_reference)
  where provider is not null and provider_reference is not null;
create index assessment_scores_school_student_idx on public.assessment_scores (school_id, student_id);
create index audit_events_school_time_idx on public.audit_events (school_id, occurred_at desc);
create index cache_invalidation_pending_idx
  on public.cache_invalidation_outbox (created_at) where status in ('pending', 'failed');
create index cache_invalidation_school_idx
  on public.cache_invalidation_outbox (school_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_school_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.school_id is distinct from old.school_id then
    raise exception 'school_id is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.protect_config_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_version uuid;
  target_status public.config_status;
begin
  target_version := case when tg_op = 'DELETE' then old.config_version_id else new.config_version_id end;
  select status into target_status from public.tenant_config_versions where id = target_version;
  if target_status in ('published', 'archived') then
    raise exception 'published and archived configuration snapshots are immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.protect_config_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('published', 'archived') then
    if not (
      old.status = 'published'
      and new.status = 'archived'
      and new.id = old.id
      and new.school_id = old.school_id
      and new.version = old.version
      and new.config = old.config
      and new.created_by = old.created_by
      and new.published_by = old.published_by
      and new.created_at = old.created_at
      and new.published_at = old.published_at
    ) then
      raise exception 'published and archived configuration versions are immutable' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger schools_updated_at before update on public.schools
for each row execute function public.set_updated_at();
create trigger school_memberships_updated_at before update on public.school_memberships
for each row execute function public.set_updated_at();
create trigger tenant_domains_updated_at before update on public.tenant_domains
for each row execute function public.set_updated_at();
create trigger tenant_branding_updated_at before update on public.tenant_branding
for each row execute function public.set_updated_at();
create trigger tenant_pages_updated_at before update on public.tenant_pages
for each row execute function public.set_updated_at();
create trigger tenant_page_blocks_updated_at before update on public.tenant_page_blocks
for each row execute function public.set_updated_at();
create trigger students_updated_at before update on public.students
for each row execute function public.set_updated_at();
create trigger guardians_updated_at before update on public.guardians
for each row execute function public.set_updated_at();
create trigger assessment_scores_updated_at before update on public.assessment_scores
for each row execute function public.set_updated_at();

create trigger tenant_config_versions_protect before update on public.tenant_config_versions
for each row execute function public.protect_config_version();
create trigger tenant_branding_protect before insert or update or delete on public.tenant_branding
for each row execute function public.protect_config_snapshot();
create trigger tenant_features_protect before insert or update or delete on public.tenant_features
for each row execute function public.protect_config_snapshot();
create trigger tenant_navigation_protect before insert or update or delete on public.tenant_navigation
for each row execute function public.protect_config_snapshot();
create trigger tenant_pages_protect before insert or update or delete on public.tenant_pages
for each row execute function public.protect_config_snapshot();
create trigger tenant_page_blocks_protect before insert or update or delete on public.tenant_page_blocks
for each row execute function public.protect_config_snapshot();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'school_memberships', 'tenant_domains', 'tenant_config_versions', 'tenant_branding',
    'tenant_features', 'tenant_navigation', 'tenant_pages', 'tenant_page_blocks', 'students',
    'guardians', 'guardian_student_links', 'fee_payments', 'assessment_scores', 'audit_events',
    'cache_invalidation_outbox'
  ] loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_school_id_change()',
      table_name || '_school_immutable',
      table_name
    );
  end loop;
end;
$$;

create or replace function public.is_platform_moderator(_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_role_assignments
    where user_id = _user_id and role = 'moderator'
  );
$$;

create or replace function public.is_school_active(_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.schools where id = _school_id and status = 'active');
$$;

create or replace function public.is_school_member(_school_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_school_active(_school_id) and exists (
    select 1 from public.school_memberships
    where school_id = _school_id and user_id = _user_id and status = 'active'
  );
$$;

create or replace function public.has_school_role(
  _school_id uuid,
  _roles public.school_role[],
  _user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_school_active(_school_id) and exists (
    select 1 from public.school_memberships
    where school_id = _school_id
      and user_id = _user_id
      and status = 'active'
      and role = any(_roles)
  );
$$;

create or replace function public.is_linked_guardian(_school_id uuid, _student_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_school_active(_school_id) and exists (
    select 1
    from public.guardian_student_links link
    join public.guardians guardian
      on guardian.school_id = link.school_id and guardian.id = link.guardian_id
    where link.school_id = _school_id
      and link.student_id = _student_id
      and guardian.user_id = _user_id
  );
$$;

create or replace function public.can_manage_school(_school_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_moderator(_user_id)
    or public.has_school_role(_school_id, array['super_admin', 'school_admin']::public.school_role[], _user_id);
$$;

create or replace function public.storage_object_school_id(_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(_name))[1])::uuid
    else null
  end;
$$;

create or replace function public.publish_tenant_config(_school_id uuid, _version_id uuid)
returns public.tenant_config_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  target public.tenant_config_versions;
begin
  if actor is null or not public.can_manage_school(_school_id, actor) then
    raise exception 'not authorized to publish tenant configuration' using errcode = '42501';
  end if;

  perform 1 from public.schools where id = _school_id and status = 'active' for update;
  if not found then
    raise exception 'active school not found' using errcode = 'P0002';
  end if;

  select * into target
  from public.tenant_config_versions
  where id = _version_id and school_id = _school_id and status = 'draft'
  for update;
  if not found then
    raise exception 'draft configuration version not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.tenant_branding where config_version_id = _version_id) then
    raise exception 'branding is required before publication' using errcode = '23514';
  end if;
  if not exists (select 1 from public.tenant_pages where config_version_id = _version_id and slug = '/') then
    raise exception 'a visible home page is required before publication' using errcode = '23514';
  end if;

  update public.tenant_config_versions
  set status = 'archived'
  where school_id = _school_id and status = 'published';

  update public.tenant_config_versions
  set status = 'published', published_by = actor, published_at = now()
  where id = _version_id
  returning * into target;

  update public.schools set published_config_version_id = _version_id where id = _school_id;

  insert into public.audit_events (school_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _school_id,
    actor,
    'tenant_config.published',
    'tenant_config_version',
    _version_id::text,
    jsonb_build_object('version', target.version)
  );

  insert into public.cache_invalidation_outbox (school_id, config_version_id)
  values (_school_id, _version_id);

  return target;
end;
$$;

revoke all on function public.is_platform_moderator(uuid) from public;
revoke all on function public.is_school_active(uuid) from public;
revoke all on function public.is_school_member(uuid, uuid) from public;
revoke all on function public.has_school_role(uuid, public.school_role[], uuid) from public;
revoke all on function public.is_linked_guardian(uuid, uuid, uuid) from public;
revoke all on function public.can_manage_school(uuid, uuid) from public;
revoke all on function public.storage_object_school_id(text) from public;
revoke all on function public.publish_tenant_config(uuid, uuid) from public;
grant execute on function public.is_platform_moderator(uuid) to authenticated, service_role;
grant execute on function public.is_school_active(uuid) to authenticated, service_role;
grant execute on function public.is_school_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.has_school_role(uuid, public.school_role[], uuid) to authenticated, service_role;
grant execute on function public.is_linked_guardian(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.can_manage_school(uuid, uuid) to authenticated, service_role;
grant execute on function public.storage_object_school_id(text) to anon, authenticated, service_role;
grant execute on function public.publish_tenant_config(uuid, uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.schools enable row level security;
alter table public.platform_role_assignments enable row level security;
alter table public.school_memberships enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.tenant_config_versions enable row level security;
alter table public.tenant_branding enable row level security;
alter table public.tenant_features enable row level security;
alter table public.tenant_navigation enable row level security;
alter table public.tenant_pages enable row level security;
alter table public.tenant_page_blocks enable row level security;
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.guardian_student_links enable row level security;
alter table public.fee_payments enable row level security;
alter table public.assessment_scores enable row level security;
alter table public.audit_events enable row level security;
alter table public.cache_invalidation_outbox enable row level security;

create policy profiles_read_self on public.profiles for select to authenticated
using (user_id = auth.uid() or public.is_platform_moderator());
create policy profiles_update_self on public.profiles for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy schools_read_members on public.schools for select to authenticated
using (public.is_school_member(id) or public.is_platform_moderator());
create policy schools_update_managers on public.schools for update to authenticated
using (public.can_manage_school(id)) with check (public.can_manage_school(id));

create policy platform_roles_read_self on public.platform_role_assignments for select to authenticated
using (user_id = auth.uid() or public.is_platform_moderator());

create policy memberships_read on public.school_memberships for select to authenticated
using (user_id = auth.uid() or public.can_manage_school(school_id));
create policy memberships_insert on public.school_memberships for insert to authenticated
with check (public.can_manage_school(school_id));
create policy memberships_update on public.school_memberships for update to authenticated
using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy memberships_delete on public.school_memberships for delete to authenticated
using (public.can_manage_school(school_id));

create policy domains_read on public.tenant_domains for select to authenticated
using (public.is_school_member(school_id) or public.is_platform_moderator());
create policy domains_manage on public.tenant_domains for all to authenticated
using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));

create policy config_versions_read on public.tenant_config_versions for select to authenticated
using (public.is_school_member(school_id) or public.is_platform_moderator());
create policy config_versions_create on public.tenant_config_versions for insert to authenticated
with check (public.can_manage_school(school_id) and created_by = auth.uid() and status = 'draft');
create policy config_versions_update_draft on public.tenant_config_versions for update to authenticated
using (public.can_manage_school(school_id) and status = 'draft')
with check (public.can_manage_school(school_id));
create policy config_versions_delete_draft on public.tenant_config_versions for delete to authenticated
using (public.can_manage_school(school_id) and status = 'draft');

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenant_branding', 'tenant_features', 'tenant_navigation', 'tenant_pages', 'tenant_page_blocks'
  ] loop
    execute format(
      'create policy %1$I_read on public.%1$I for select to authenticated using (public.is_school_member(school_id) or public.is_platform_moderator())',
      table_name
    );
    execute format(
      'create policy %1$I_insert on public.%1$I for insert to authenticated with check (public.can_manage_school(%1$I.school_id) and exists (select 1 from public.tenant_config_versions v where v.id = %1$I.config_version_id and v.school_id = %1$I.school_id and v.status = ''draft''))',
      table_name
    );
    execute format(
      'create policy %1$I_update on public.%1$I for update to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id))',
      table_name
    );
    execute format(
      'create policy %1$I_delete on public.%1$I for delete to authenticated using (public.can_manage_school(school_id))',
      table_name
    );
  end loop;
end;
$$;

create policy students_read_staff_self_parent on public.students for select to authenticated
using (
  public.has_school_role(school_id, array['super_admin','school_admin','teacher','exam_officer','bursar','librarian']::public.school_role[])
  or user_id = auth.uid()
  or public.is_linked_guardian(school_id, id)
  or public.is_platform_moderator()
);
create policy students_manage on public.students for all to authenticated
using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));

create policy guardians_read on public.guardians for select to authenticated
using (user_id = auth.uid() or public.can_manage_school(school_id));
create policy guardians_manage on public.guardians for all to authenticated
using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy guardian_links_read on public.guardian_student_links for select to authenticated
using (
  public.can_manage_school(school_id)
  or exists (
    select 1 from public.guardians g
    where g.school_id = guardian_student_links.school_id
      and g.id = guardian_student_links.guardian_id
      and g.user_id = auth.uid()
  )
);
create policy guardian_links_manage on public.guardian_student_links for all to authenticated
using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));

create policy fee_payments_read on public.fee_payments for select to authenticated
using (
  public.has_school_role(school_id, array['super_admin','school_admin','bursar']::public.school_role[])
  or exists (select 1 from public.students s where s.id = student_id and s.user_id = auth.uid())
  or public.is_linked_guardian(school_id, student_id)
  or public.is_platform_moderator()
);
create policy fee_payments_manage on public.fee_payments for all to authenticated
using (public.has_school_role(school_id, array['super_admin','school_admin','bursar']::public.school_role[]))
with check (public.has_school_role(school_id, array['super_admin','school_admin','bursar']::public.school_role[]));

create policy assessment_scores_read_staff on public.assessment_scores for select to authenticated
using (
  public.has_school_role(school_id, array['super_admin','school_admin','teacher','exam_officer']::public.school_role[])
  or public.is_platform_moderator()
);
create policy assessment_scores_manage_staff on public.assessment_scores for all to authenticated
using (public.has_school_role(school_id, array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]))
with check (public.has_school_role(school_id, array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]));

create policy audit_events_read on public.audit_events for select to authenticated
using (
  public.is_platform_moderator()
  or (school_id is not null and public.can_manage_school(school_id))
);

create policy cache_outbox_moderator_read on public.cache_invalidation_outbox for select to authenticated
using (public.is_platform_moderator());

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'tenant-public-assets',
    'tenant-public-assets',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']
  ),
  (
    'tenant-private-files',
    'tenant-private-files',
    false,
    20971520,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do nothing;

create policy public_assets_read on storage.objects for select to anon, authenticated
using (bucket_id = 'tenant-public-assets');
create policy public_assets_manage on storage.objects for all to authenticated
using (
  bucket_id = 'tenant-public-assets'
  and public.can_manage_school(public.storage_object_school_id(name))
)
with check (
  bucket_id = 'tenant-public-assets'
  and public.can_manage_school(public.storage_object_school_id(name))
);
create policy private_files_manage on storage.objects for all to authenticated
using (
  bucket_id = 'tenant-private-files'
  and public.can_manage_school(public.storage_object_school_id(name))
)
with check (
  bucket_id = 'tenant-private-files'
  and public.can_manage_school(public.storage_object_school_id(name))
);
