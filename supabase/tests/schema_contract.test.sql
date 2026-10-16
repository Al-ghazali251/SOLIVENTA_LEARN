begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles', 'schools', 'platform_role_assignments', 'school_memberships',
        'tenant_domains', 'tenant_config_versions', 'tenant_branding', 'tenant_features',
        'tenant_navigation', 'tenant_pages', 'tenant_page_blocks', 'students', 'guardians',
        'guardian_student_links', 'fee_payments', 'assessment_scores', 'audit_events',
        'cache_invalidation_outbox'
      ])
      and c.relkind = 'r'
  ),
  18,
  'all baseline tables exist'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles', 'schools', 'platform_role_assignments', 'school_memberships',
        'tenant_domains', 'tenant_config_versions', 'tenant_branding', 'tenant_features',
        'tenant_navigation', 'tenant_pages', 'tenant_page_blocks', 'students', 'guardians',
        'guardian_student_links', 'fee_payments', 'assessment_scores', 'audit_events',
        'cache_invalidation_outbox'
      ])
      and not c.relrowsecurity
  ),
  0,
  'RLS is enabled on every baseline table'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(array[
        'is_platform_moderator', 'is_school_active', 'is_school_member',
        'has_school_role', 'is_linked_guardian', 'can_manage_school', 'publish_tenant_config'
      ])
      and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  ),
  0,
  'security-definer functions use an empty search path'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname = any(array[
        'is_platform_moderator', 'is_school_active', 'is_school_member',
        'has_school_role', 'is_linked_guardian', 'can_manage_school', 'publish_tenant_config'
      ])
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ),
  0,
  'security-definer functions are not executable by public'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'school_memberships', 'tenant_domains', 'tenant_config_versions', 'tenant_branding',
        'tenant_features', 'tenant_navigation', 'tenant_pages', 'tenant_page_blocks', 'students',
        'guardians', 'guardian_student_links', 'fee_payments', 'assessment_scores', 'audit_events',
        'cache_invalidation_outbox'
      ])
      and t.tgname like '%_school_immutable'
      and not t.tgisinternal
  ),
  15,
  'all tenant-owned baseline tables make school_id immutable'
);

select is(
  (
    select count(*)::integer
    from public.tenant_config_versions v
    where v.status = 'published'
      and v.id = (
        select s.published_config_version_id from public.schools s where s.id = v.school_id
      )
  ),
  2,
  'seeded schools point to exactly one published configuration'
);

select * from finish();
rollback;
