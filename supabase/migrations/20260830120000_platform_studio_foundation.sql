insert into public.authorization_permissions(code,resource,action,description,sensitive)
values
  ('platform.domains.read','platform_domains','read','Read domains across school tenants',true),
  ('platform.domains.manage','platform_domains','manage','Manage domains across school tenants',true),
  ('platform.entitlements.read','platform_entitlements','read','Read tenant feature entitlements',true),
  ('platform.entitlements.manage','platform_entitlements','manage','Manage tenant feature entitlements',true),
  ('platform.operators.read','platform_operators','read','Read platform operator access',true),
  ('platform.operators.manage','platform_operators','manage','Manage platform operator access',true),
  ('platform.audit.read','platform_audit','read','Read cross-tenant operational audit',true)
on conflict(code) do nothing;

insert into public.platform_authorization_roles(code,name)
values
  ('platform_admin','Platform administrator'),
  ('platform_operator','Platform operator'),
  ('platform_support','Platform support'),
  ('platform_auditor','Platform auditor')
on conflict(code) do update set name=excluded.name;

insert into public.platform_authorization_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_authorization_roles r cross join public.authorization_permissions p
where
  (r.code='platform_admin' and p.code like 'platform.%')
  or (r.code='platform_operator' and p.code in (
    'platform.schools.read','platform.schools.manage','platform.settings.manage',
    'platform.domains.read','platform.domains.manage','platform.entitlements.read',
    'platform.entitlements.manage','platform.operators.read','platform.audit.read'))
  or (r.code='platform_support' and p.code in (
    'platform.schools.read','platform.domains.read','platform.entitlements.read','platform.audit.read'))
  or (r.code='platform_auditor' and p.code in (
    'platform.schools.read','platform.domains.read','platform.entitlements.read',
    'platform.operators.read','platform.audit.read'))
on conflict do nothing;

create table public.platform_operator_role_assignments (
  account_id uuid not null references public.accounts(id) on delete cascade,
  role_id uuid not null references public.platform_authorization_roles(id) on delete restrict,
  granted_by uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(account_id,role_id)
);
create index platform_operator_assignments_role_idx
  on public.platform_operator_role_assignments(role_id,account_id);

insert into public.platform_operator_role_assignments(account_id,role_id,granted_by)
select pra.user_id,par.id,pra.granted_by
from public.platform_role_assignments pra
join public.platform_authorization_roles par on par.code='platform_admin'
on conflict do nothing;

create or replace function public.get_platform_operator_access(_account_id uuid)
returns table(role_codes text[],permissions text[])
language sql stable security definer set search_path='' as $$
  select
    coalesce(array_agg(distinct r.code) filter(where r.code is not null),'{}'::text[]),
    coalesce(array_agg(distinct p.code) filter(where p.code is not null),'{}'::text[])
  from public.platform_operator_role_assignments a
  join public.platform_authorization_roles r on r.id=a.role_id
  left join public.platform_authorization_role_permissions rp on rp.role_id=r.id
  left join public.authorization_permissions p on p.id=rp.permission_id
  where a.account_id=_account_id
$$;
revoke all on function public.get_platform_operator_access(uuid) from public;
grant execute on function public.get_platform_operator_access(uuid) to service_role;

alter table public.platform_operator_role_assignments enable row level security;
create policy platform_operator_self_read on public.platform_operator_role_assignments for select
  using(account_id=auth.uid());

create or replace function public.audit_platform_operator_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.identity_security_events(actor_account_id,subject_account_id,event_type,metadata)
  values(auth.uid(),coalesce(new.account_id,old.account_id),
    case when tg_op='INSERT' then 'platform.operator.granted' else 'platform.operator.revoked' end,
    jsonb_build_object('roleId',coalesce(new.role_id,old.role_id)));
  return coalesce(new,old);
end;
$$;
create trigger platform_operator_change_audit after insert or delete
on public.platform_operator_role_assignments for each row execute function public.audit_platform_operator_change();
