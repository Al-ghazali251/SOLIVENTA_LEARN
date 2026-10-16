create type public.domain_kind as enum ('platform', 'custom');

alter table public.tenant_domains
  add column domain_kind public.domain_kind not null default 'custom',
  add column provider_hostname_id text unique,
  add column ownership_verification jsonb,
  add column certificate_validation jsonb,
  add column failure_reason text,
  add column last_checked_at timestamptz,
  add column removed_at timestamptz,
  add constraint tenant_domains_provider_fields_check check (
    (domain_kind = 'platform' and provider_hostname_id is null)
    or domain_kind = 'custom'
  ),
  add constraint tenant_domains_removed_timestamp_check check (
    (status = 'removed' and removed_at is not null) or (status <> 'removed' and removed_at is null)
  );

create index tenant_domains_reconciliation_idx
  on public.tenant_domains(last_checked_at) where domain_kind = 'custom' and status in ('awaiting_dns','verifying','active','failed');

create or replace function public.provision_platform_domains(
  _school_id uuid, _actor_id uuid, _base_domain text
)
returns setof public.tenant_domains
language plpgsql security definer set search_path = '' as $$
declare school_code text; public_host text; portal_host text;
begin
  if _actor_id is distinct from auth.uid() and auth.role() <> 'service_role' then
    raise exception 'actor mismatch' using errcode = '42501';
  end if;
  if not public.can_manage_school(_school_id, _actor_id) then
    raise exception 'not authorized to provision domains' using errcode = '42501';
  end if;
  if _base_domain !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' then
    raise exception 'invalid base domain' using errcode = '22023';
  end if;
  select lower(code::text) into school_code from public.schools where id=_school_id and status='active';
  if school_code is null then raise exception 'active school not found' using errcode='P0002'; end if;
  public_host := school_code || '.schools.' || lower(_base_domain);
  portal_host := 'portal.' || school_code || '.schools.' || lower(_base_domain);
  insert into public.tenant_domains(school_id,hostname,domain_type,status,verified_at,certificate_status,is_primary,domain_kind)
  values (_school_id,public_host,'public_site','active',now(),'active',not exists(select 1 from public.tenant_domains where school_id=_school_id and domain_type='public_site' and is_primary and status<>'removed'),'platform'),
         (_school_id,portal_host,'portal','active',now(),'active',not exists(select 1 from public.tenant_domains where school_id=_school_id and domain_type='portal' and is_primary and status<>'removed'),'platform')
  on conflict(normalized_hostname) do nothing;
  insert into public.audit_events(school_id,actor_id,action,entity_type,metadata)
  values(_school_id,_actor_id,'domains.platform.provisioned','tenant_domain',jsonb_build_object('public',public_host,'portal',portal_host));
  return query select * from public.tenant_domains where school_id=_school_id and normalized_hostname in(public_host,portal_host);
end;
$$;

create or replace function public.set_primary_tenant_domain(_school_id uuid,_domain_id uuid,_actor_id uuid)
returns public.tenant_domains language plpgsql security definer set search_path='' as $$
declare target public.tenant_domains;
begin
  if not public.can_manage_school(_school_id,_actor_id) then raise exception 'not authorized to manage domains' using errcode='42501'; end if;
  select * into target from public.tenant_domains where school_id=_school_id and id=_domain_id and status='active' for update;
  if target.id is null then raise exception 'active domain not found' using errcode='P0002'; end if;
  update public.tenant_domains set is_primary=false,redirect_to_primary=true where school_id=_school_id and domain_type=target.domain_type and status='active';
  update public.tenant_domains set is_primary=true,redirect_to_primary=false where id=_domain_id returning * into target;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school_id,_actor_id,'domain.primary.changed','tenant_domain',_domain_id::text,jsonb_build_object('hostname',target.normalized_hostname));
  return target;
end;
$$;

create or replace function public.remove_custom_tenant_domain(_school_id uuid,_domain_id uuid,_actor_id uuid)
returns public.tenant_domains language plpgsql security definer set search_path='' as $$
declare target public.tenant_domains; fallback_id uuid;
begin
  if not public.can_manage_school(_school_id,_actor_id) then raise exception 'not authorized to manage domains' using errcode='42501'; end if;
  select * into target from public.tenant_domains where school_id=_school_id and id=_domain_id and domain_kind='custom' and status<>'removed' for update;
  if target.id is null then raise exception 'custom domain not found' using errcode='P0002'; end if;
  if target.is_primary then
    select id into fallback_id from public.tenant_domains where school_id=_school_id and domain_type=target.domain_type and id<>target.id and status='active' order by (domain_kind='platform') desc,created_at limit 1 for update;
    if fallback_id is null then raise exception 'cannot remove the only active domain' using errcode='23514'; end if;
    update public.tenant_domains set is_primary=false,redirect_to_primary=false where id=target.id;
    update public.tenant_domains set is_primary=true,redirect_to_primary=false where id=fallback_id;
  end if;
  update public.tenant_domains set status='removed',is_primary=false,redirect_to_primary=false,removed_at=now(),verified_at=null where id=_domain_id returning * into target;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school_id,_actor_id,'domain.custom.removed','tenant_domain',_domain_id::text,jsonb_build_object('hostname',target.normalized_hostname));
  return target;
end;
$$;

revoke all on function public.provision_platform_domains(uuid,uuid,text) from public;
revoke all on function public.set_primary_tenant_domain(uuid,uuid,uuid) from public;
revoke all on function public.remove_custom_tenant_domain(uuid,uuid,uuid) from public;
grant execute on function public.provision_platform_domains(uuid,uuid,text) to authenticated, service_role;
grant execute on function public.set_primary_tenant_domain(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.remove_custom_tenant_domain(uuid,uuid,uuid) to authenticated, service_role;
