create or replace function public.manage_person_membership(
  _school_id uuid, _membership_id uuid, _status public.membership_status,
  _lifecycle_state text, _reason text, _actor_id uuid
) returns public.tenant_memberships language plpgsql security definer set search_path='' as $$
declare _membership public.tenant_memberships; _old_state text;
begin
  select lifecycle_state into _old_state from public.tenant_memberships where school_id=_school_id and id=_membership_id for update;
  if not found then raise exception 'Membership not found.' using errcode='P0002'; end if;
  if _status<>'active' and exists(select 1 from public.membership_role_assignments ma join public.authorization_roles r on r.id=ma.role_id
      where ma.membership_id=_membership_id and ma.valid_until is null and r.code in ('super_admin','school_admin'))
    and (select count(distinct ma.membership_id) from public.membership_role_assignments ma
      join public.tenant_memberships tm on tm.id=ma.membership_id and tm.school_id=ma.school_id
      join public.authorization_roles r on r.id=ma.role_id
      where ma.school_id=_school_id and ma.valid_until is null and tm.status='active' and r.code in ('super_admin','school_admin'))<=1 then
    raise exception 'The final active administrator cannot be suspended or revoked.' using errcode='23514';
  end if;
  update public.tenant_memberships set status=_status,lifecycle_state=trim(_lifecycle_state),
    suspended_at=case when _status='suspended' then now() else null end,
    ended_at=case when _status='revoked' then now() else null end,updated_at=now()
  where school_id=_school_id and id=_membership_id returning * into _membership;
  insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,from_state,to_state,reason,actor_account_id)
  values(_school_id,_membership_id,(case when _status='suspended' then 'suspended' when _status='revoked' then 'ended' when _status='active' and _old_state='suspended' then 'reactivated' else 'transitioned' end)::public.lifecycle_event_kind,
    _old_state,_membership.lifecycle_state,nullif(trim(_reason),''),_actor_id);
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'people.membership.transitioned','tenant_membership',_membership_id::text,
    jsonb_build_object('status',_status,'lifecycleState',_membership.lifecycle_state,'reason',nullif(trim(_reason),'')));
  return _membership;
end $$;
revoke execute on function public.manage_person_membership(uuid,uuid,public.membership_status,text,text,uuid) from public,anon,authenticated;
grant execute on function public.manage_person_membership(uuid,uuid,public.membership_status,text,text,uuid) to service_role;
