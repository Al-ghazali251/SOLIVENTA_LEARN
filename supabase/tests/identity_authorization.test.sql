begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(19);

select has_table('public','accounts','tenant-independent accounts exist');
select has_table('public','tenant_memberships','canonical tenant memberships exist');
select has_table('public','membership_lifecycle_events','membership lifecycle is historical');
select has_table('public','membership_entity_links','domain records link to memberships');
select has_table('public','authorization_permissions','permissions are data');
select has_table('public','authorization_roles','roles are data');
select has_table('public','authorization_role_permissions','role permission grants exist');
select has_table('public','membership_role_assignments','memberships receive scoped roles');
select has_table('public','identity_security_events','authorization changes are auditable');
select col_is_pk('public','accounts','id','account identity is one-to-one with auth user');
select col_is_fk('public','accounts','id','account references auth.users');
select col_is_fk('public','tenant_memberships','account_id','membership references account');
select col_is_fk('public','tenant_memberships','school_id','membership references tenant');
select has_function('public','get_account_workspaces',array['uuid'],'workspace resolver exists');
select has_function('public','account_has_permission',array['uuid','uuid','text','jsonb'],'permission boundary exists');
select has_function('public','transition_tenant_membership',array['uuid','membership_status','text','text'],'lifecycle transition boundary exists');
select ok((select count(*) from public.authorization_roles where school_id is null)>=11,'system lifecycle roles are seeded');
select ok((select count(*) from public.authorization_permissions)>=40,'explicit permissions are seeded');
select is((select count(*)::integer from public.tenant_memberships tm join public.school_memberships sm
  on sm.school_id=tm.school_id and sm.user_id=tm.account_id and public.membership_kind_for_school_role(sm.role)=tm.kind
  where sm.status='active'),(select count(*)::integer from public.school_memberships where status='active'),
  'legacy active memberships are represented canonically');

select * from finish();
rollback;
