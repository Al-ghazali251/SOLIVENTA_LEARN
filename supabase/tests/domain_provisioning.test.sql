begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(5);

select has_column('public','tenant_domains','provider_hostname_id','provider hostname identifier is stored');
select has_column('public','tenant_domains','removed_at','domain removal is retained');
select has_index('public','tenant_domains','tenant_domains_reconciliation_idx','custom domains have a reconciliation index');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='provision_platform_domains' and has_function_privilege('public',p.oid,'EXECUTE')),0,'platform provisioning is not public');
select throws_ok($$update public.tenant_domains set status='removed' where id=(select id from public.tenant_domains limit 1)$$,'23514',null,'removed domains require removal metadata');

select * from finish();
rollback;
