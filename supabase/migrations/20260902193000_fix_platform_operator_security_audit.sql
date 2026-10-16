create or replace function public.audit_platform_operator_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account_id uuid := coalesce(new.account_id, old.account_id);
  target_role_id uuid := coalesce(new.role_id, old.role_id);
begin
  insert into public.identity_security_events(
    actor_account_id,
    action,
    target_type,
    target_id,
    metadata
  )
  values(
    auth.uid(),
    case when tg_op = 'INSERT' then 'platform.operator.granted' else 'platform.operator.revoked' end,
    'platform_operator',
    target_account_id::text,
    jsonb_build_object('roleId', target_role_id)
  );
  return coalesce(new, old);
end;
$$;

