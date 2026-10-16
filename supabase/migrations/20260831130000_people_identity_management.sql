-- Canonical tenant-scoped identity and membership management for school people.
create or replace function public.provision_person_membership(
  _school_id uuid, _account_id uuid, _kind public.membership_kind, _display_name text,
  _external_reference text, _role_code text, _entity_type text, _entity_id uuid, _actor_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare _membership public.tenant_memberships; _role_id uuid; _assignment_id uuid;
begin
  if not exists(select 1 from public.accounts where id=_account_id) then raise exception 'Account not found.' using errcode='P0002'; end if;
  select id into _role_id from public.authorization_roles
    where code=_role_code and (school_id is null or school_id=_school_id)
    order by school_id nulls last limit 1;
  if _role_id is null then raise exception 'Role not found.' using errcode='P0002'; end if;
  insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,external_reference,display_name,joined_at,created_by)
  values(_school_id,_account_id,_kind,'active','active',nullif(trim(_external_reference),''),trim(_display_name),now(),_actor_id)
  on conflict(school_id,account_id,kind) do update set status='active',lifecycle_state='active',
    external_reference=coalesce(excluded.external_reference,public.tenant_memberships.external_reference),display_name=excluded.display_name,
    suspended_at=null,ended_at=null,updated_at=now()
  returning * into _membership;
  insert into public.membership_role_assignments(school_id,membership_id,role_id,assigned_by)
  values(_school_id,_membership.id,_role_id,_actor_id)
  on conflict(membership_id,role_id) do update set valid_until=null,assigned_by=excluded.assigned_by
  returning id into _assignment_id;
  if _entity_type is not null and _entity_id is not null then
    insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
    values(_school_id,_membership.id,_entity_type,_entity_id)
    on conflict(school_id,membership_id,entity_type,entity_id) do nothing;
  end if;
  insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,to_state,reason,actor_account_id,metadata)
  values(_school_id,_membership.id,'created','active','Person membership provisioned.',_actor_id,jsonb_build_object('roleCode',_role_code));
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'people.membership.provisioned','tenant_membership',_membership.id::text,
    jsonb_build_object('accountId',_account_id,'kind',_kind,'roleCode',_role_code));
  return jsonb_build_object('membershipId',_membership.id,'roleAssignmentId',_assignment_id);
end $$;

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

create or replace function public.assign_person_role(
  _school_id uuid, _membership_id uuid, _role_id uuid, _actor_id uuid
) returns public.membership_role_assignments language plpgsql security definer set search_path='' as $$
declare _assignment public.membership_role_assignments;
begin
  if not exists(select 1 from public.tenant_memberships where school_id=_school_id and id=_membership_id) then raise exception 'Membership not found.' using errcode='P0002'; end if;
  if not exists(select 1 from public.authorization_roles where id=_role_id and (school_id is null or school_id=_school_id) and is_assignable) then raise exception 'Role is not assignable in this school.' using errcode='23514'; end if;
  insert into public.membership_role_assignments(school_id,membership_id,role_id,assigned_by)
  values(_school_id,_membership_id,_role_id,_actor_id)
  on conflict(membership_id,role_id) do update set valid_until=null,assigned_by=excluded.assigned_by
  returning * into _assignment;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'people.role.assigned','tenant_membership',_membership_id::text,jsonb_build_object('roleId',_role_id));
  return _assignment;
end $$;

create or replace function public.revoke_person_role(
  _school_id uuid, _assignment_id uuid, _actor_id uuid
) returns public.membership_role_assignments language plpgsql security definer set search_path='' as $$
declare _assignment public.membership_role_assignments;
begin
  if exists(select 1 from public.membership_role_assignments ma join public.authorization_roles r on r.id=ma.role_id
      where ma.school_id=_school_id and ma.id=_assignment_id and ma.valid_until is null and r.code in ('super_admin','school_admin'))
    and (select count(distinct ma.membership_id) from public.membership_role_assignments ma
      join public.tenant_memberships tm on tm.id=ma.membership_id and tm.school_id=ma.school_id
      join public.authorization_roles r on r.id=ma.role_id
      where ma.school_id=_school_id and ma.valid_until is null and tm.status='active' and r.code in ('super_admin','school_admin'))<=1 then
    raise exception 'The final active administrator role cannot be revoked.' using errcode='23514';
  end if;
  update public.membership_role_assignments set valid_until=greatest(clock_timestamp(),valid_from+interval '1 microsecond')
  where school_id=_school_id and id=_assignment_id and valid_until is null returning * into _assignment;
  if not found then raise exception 'Active role assignment not found.' using errcode='P0002'; end if;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'people.role.revoked','tenant_membership',_assignment.membership_id::text,jsonb_build_object('roleId',_assignment.role_id));
  return _assignment;
end $$;

revoke execute on function public.provision_person_membership(uuid,uuid,public.membership_kind,text,text,text,text,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.manage_person_membership(uuid,uuid,public.membership_status,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.assign_person_role(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke execute on function public.revoke_person_role(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.provision_person_membership(uuid,uuid,public.membership_kind,text,text,text,text,uuid,uuid) to service_role;
grant execute on function public.manage_person_membership(uuid,uuid,public.membership_status,text,text,uuid) to service_role;
grant execute on function public.assign_person_role(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.revoke_person_role(uuid,uuid,uuid) to service_role;
