-- Apply common teacher/principal remarks to a reviewed set of students atomically.
create or replace function public.save_result_summaries_bulk(
  _school uuid,_term uuid,_class uuid,_report_type text,_student_ids uuid[],
  _teacher_remark text,_principal_remark text,_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare _student uuid; _saved integer:=0;
begin
  if array_length(_student_ids,1) is null or array_length(_student_ids,1)>250 then
    raise exception 'Select between 1 and 250 students.' using errcode='22023';
  end if;
  if _teacher_remark is null and _principal_remark is null then
    raise exception 'Provide a teacher or principal remark.' using errcode='22023';
  end if;
  if not public.can_manage_school(_school,_actor) and not exists(
    select 1 from public.class_teacher_assignments where school_id=_school and class_id=_class and teacher_user_id=_actor
  ) then raise exception 'You are not assigned to manage this class.' using errcode='42501'; end if;
  if exists(select 1 from public.result_workflows where school_id=_school and term_id=_term and class_id=_class
    and report_type=_report_type and status not in('draft','reopened'))
  then raise exception 'Result report is locked.' using errcode='23514'; end if;
  foreach _student in array _student_ids loop
    if not exists(select 1 from public.students where school_id=_school and id=_student and class_id=_class and status='active')
    then raise exception 'A selected student is not active in this class.' using errcode='23514'; end if;
    insert into public.student_report_summaries(school_id,term_id,class_id,student_id,report_type,
      teacher_remark,principal_remark,updated_by)
    values(_school,_term,_class,_student,_report_type,_teacher_remark,_principal_remark,_actor)
    on conflict(school_id,term_id,class_id,student_id,report_type) do update set
      teacher_remark=coalesce(excluded.teacher_remark,student_report_summaries.teacher_remark),
      principal_remark=coalesce(excluded.principal_remark,student_report_summaries.principal_remark),
      updated_by=excluded.updated_by;
    _saved:=_saved+1;
  end loop;
  return _saved;
end $$;
revoke all on function public.save_result_summaries_bulk(uuid,uuid,uuid,text,uuid[],text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_result_summaries_bulk(uuid,uuid,uuid,text,uuid[],text,text,uuid) to service_role;
notify pgrst,'reload schema';
