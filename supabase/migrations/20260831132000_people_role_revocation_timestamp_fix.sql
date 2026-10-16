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
revoke execute on function public.revoke_person_role(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_person_role(uuid,uuid,uuid) to service_role;
