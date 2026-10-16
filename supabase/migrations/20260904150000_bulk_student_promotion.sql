-- Permit school administrators, registrars, and assigned class teachers to promote
-- a validated batch without granting teachers broad academic-management access.
insert into public.authorization_permissions(code,resource,action,description,sensitive)
values('students.promote','students','promote','Promote students within an authorized class',true)
on conflict(code) do nothing;

insert into public.authorization_role_permissions(role_id,permission_id)
select r.id,p.id
from public.authorization_roles r
cross join public.authorization_permissions p
where r.school_id is null
  and r.code in ('super_admin','school_admin','teacher','registrar')
  and p.code='students.promote'
on conflict do nothing;

create or replace function public.bulk_promote_students(
  _school_id uuid, _actor_id uuid, _student_ids uuid[], _source_class_id uuid,
  _target_session_id uuid, _target_class_id uuid, _target_arm_id uuid, _enrolled_at date
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  _student_id uuid;
  _promoted integer := 0;
begin
  if coalesce(cardinality(_student_ids),0) < 1 or cardinality(_student_ids) > 500 then
    raise exception 'Select between 1 and 500 students.' using errcode='22023';
  end if;
  if (select count(*) from unnest(_student_ids) value) <> (select count(distinct value) from unnest(_student_ids) value) then
    raise exception 'Student selection contains duplicates.' using errcode='22023';
  end if;
  if not public.can_manage_school(_school_id,_actor_id)
    and not exists(select 1 from public.class_teacher_assignments where school_id=_school_id and class_id=_source_class_id and teacher_user_id=_actor_id)
    and not exists(select 1 from public.teacher_class_subject_assignments where school_id=_school_id and class_id=_source_class_id and teacher_user_id=_actor_id)
  then raise exception 'You are not assigned to the source class.' using errcode='42501'; end if;
  if not exists(select 1 from public.classes where school_id=_school_id and id=_source_class_id and active) then
    raise exception 'Source class is outside the school or inactive.' using errcode='23503';
  end if;
  if exists(
    select 1 from unnest(_student_ids) selected(id)
    left join public.students s on s.school_id=_school_id and s.id=selected.id and s.status='active'
    where s.id is null or s.class_id is distinct from _source_class_id
  ) then raise exception 'Every selected student must be active and in the source class.' using errcode='22023'; end if;

  foreach _student_id in array _student_ids loop
    perform public.manage_student_enrolment(
      _school_id,_student_id,_target_session_id,_target_class_id,_target_arm_id,
      coalesce(_enrolled_at,current_date),true,_actor_id
    );
    _promoted := _promoted + 1;
  end loop;
  insert into public.audit_events(school_id,actor_id,action,entity_type,metadata)
  values(_school_id,_actor_id,'students.promoted.bulk','class',jsonb_build_object(
    'sourceClassId',_source_class_id,'targetClassId',_target_class_id,
    'targetSessionId',_target_session_id,'targetArmId',_target_arm_id,
    'studentIds',to_jsonb(_student_ids),'promoted',_promoted
  ));
  return jsonb_build_object('promoted',_promoted);
end; $$;

revoke all on function public.bulk_promote_students(uuid,uuid,uuid[],uuid,uuid,uuid,uuid,date)
from public,anon,authenticated;
grant execute on function public.bulk_promote_students(uuid,uuid,uuid[],uuid,uuid,uuid,uuid,date)
to service_role;

notify pgrst, 'reload schema';
