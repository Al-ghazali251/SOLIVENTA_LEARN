create table public.platform_features (
  feature_key text primary key check (feature_key ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  available boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.school_feature_entitlements (
  school_id uuid not null references public.schools(id) on delete cascade,
  feature_key text not null references public.platform_features(feature_key) on delete restrict,
  entitled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (school_id, feature_key)
);
alter table public.platform_features enable row level security;
alter table public.school_feature_entitlements enable row level security;

insert into public.platform_features(feature_key, available)
values ('admissions',true),('news',true),('gallery',true),('portal.students',true),('portal.results',true),('portal.attendance',true)
on conflict (feature_key) do nothing;
insert into public.platform_features(feature_key, available)
select distinct feature_key,true from public.tenant_features on conflict (feature_key) do nothing;
insert into public.school_feature_entitlements(school_id,feature_key,entitled)
select distinct school_id,feature_key,true from public.tenant_features on conflict (school_id,feature_key) do update set entitled=excluded.entitled;

create or replace function public.save_tenant_config_draft(
  _school_id uuid, _version_id uuid, _actor_id uuid, _config jsonb
) returns public.tenant_config_versions
language plpgsql security definer set search_path = '' as $$
declare target public.tenant_config_versions; page jsonb; block jsonb; page_id uuid; idx integer;
begin
  if not public.can_manage_school(_school_id, _actor_id) then raise exception 'not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(_config) <> 'object' or (_config->>'schemaVersion')::int <> 1 then raise exception 'invalid configuration' using errcode = '23514'; end if;
  if _version_id is null then
    insert into public.tenant_config_versions(school_id, config, created_by) values(_school_id, _config, _actor_id) returning * into target;
  else
    update public.tenant_config_versions set config = _config where id = _version_id and school_id = _school_id and status = 'draft' returning * into target;
    if not found then raise exception 'draft not found' using errcode = 'P0002'; end if;
    delete from public.tenant_page_blocks where config_version_id = target.id;
    delete from public.tenant_pages where config_version_id = target.id;
    delete from public.tenant_navigation where config_version_id = target.id;
    delete from public.tenant_features where config_version_id = target.id;
    delete from public.tenant_branding where config_version_id = target.id;
  end if;
  insert into public.tenant_branding(school_id,config_version_id,logo_url,favicon_url,primary_color,secondary_color,accent_color,heading_font,body_font,tokens)
  values(_school_id,target.id,_config#>>'{branding,logoUrl}',_config#>>'{branding,faviconUrl}',_config#>>'{branding,colors,primary}',_config#>>'{branding,colors,secondary}',_config#>>'{branding,colors,accent}',_config#>>'{branding,fonts,heading}',_config#>>'{branding,fonts,body}',jsonb_build_object('colors',_config#>'{branding,colors}','buttonStyle',_config#>'{branding,buttonStyle}','cardStyle',_config#>'{branding,cardStyle}','contact',_config->'contact','socialLinks',_config->'socialLinks'));
  insert into public.tenant_features(school_id,config_version_id,feature_key,enabled)
  select _school_id,target.id,key,(value::text)::boolean from jsonb_each(_config->'features');
  insert into public.tenant_navigation(school_id,config_version_id,location,label,href,position,required_feature)
  select _school_id,target.id,'header',item->>'label',item->>'href',ordinality-1,item->>'requiredFeature' from jsonb_array_elements(_config->'navigation') with ordinality as n(item,ordinality);
  for page in select * from jsonb_array_elements(_config->'pages') loop
    insert into public.tenant_pages(school_id,config_version_id,slug,title,template,visible) values(_school_id,target.id,page->>'slug',page->>'title',_config->>'template',(page->>'visible')::boolean) returning id into page_id;
    idx := 0; for block in select * from jsonb_array_elements(page->'blocks') loop
      insert into public.tenant_page_blocks(id,school_id,config_version_id,page_id,block_type,position,content) values(gen_random_uuid(),_school_id,target.id,page_id,block->>'type',idx,block-'id'-'type'); idx := idx + 1;
    end loop;
  end loop;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school_id,_actor_id,'tenant_config.draft_saved','tenant_config_version',target.id::text,jsonb_build_object('version',target.version));
  return target;
end $$;

create or replace function public.publish_tenant_config_as_service(_school_id uuid,_version_id uuid,_actor_id uuid,_action text default 'publish') returns public.tenant_config_versions
language plpgsql security definer set search_path = '' as $$
declare target public.tenant_config_versions;
begin
  if not public.can_manage_school(_school_id,_actor_id) then raise exception 'not authorized' using errcode='42501'; end if;
  perform 1 from public.schools where id=_school_id and status='active' for update; if not found then raise exception 'active school not found' using errcode='P0002'; end if;
  select * into target from public.tenant_config_versions where id=_version_id and school_id=_school_id and status='draft' for update; if not found then raise exception 'draft not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.tenant_branding where config_version_id=_version_id) or not exists(select 1 from public.tenant_pages where config_version_id=_version_id and slug='/' and visible) then raise exception 'configuration incomplete' using errcode='23514'; end if;
  update public.tenant_config_versions set status='archived' where school_id=_school_id and status='published';
  update public.tenant_config_versions set status='published',published_by=_actor_id,published_at=now() where id=_version_id returning * into target;
  update public.schools set published_config_version_id=_version_id where id=_school_id;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school_id,_actor_id,case when _action='rollback' then 'tenant_config.rolled_back' else 'tenant_config.published' end,'tenant_config_version',_version_id::text,jsonb_build_object('version',target.version));
  insert into public.cache_invalidation_outbox(school_id,config_version_id) values(_school_id,_version_id); return target;
end $$;

revoke all on function public.save_tenant_config_draft(uuid,uuid,uuid,jsonb) from public;
revoke all on function public.publish_tenant_config_as_service(uuid,uuid,uuid,text) from public;
grant execute on function public.save_tenant_config_draft(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.publish_tenant_config_as_service(uuid,uuid,uuid,text) to service_role;
