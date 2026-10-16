-- Allow attendance against terms whose optional date boundaries have not yet been configured.
create or replace function public.capture_class_attendance(
  _school_id uuid,
  _class_id uuid,
  _term_id uuid,
  _date date,
  _entries jsonb,
  _actor_id uuid
)
returns setof public.attendance_records
language plpgsql
security definer
set search_path=''
as $$
declare
  _entry jsonb;
  _student uuid;
  _is_manager boolean;
  _saved public.attendance_records;
begin
  _is_manager := public.can_manage_school(_school_id, _actor_id);
  if not _is_manager
    and not exists (
      select 1 from public.class_teacher_assignments
      where school_id = _school_id and class_id = _class_id and teacher_user_id = _actor_id
    )
    and not exists (
      select 1 from public.teacher_class_subject_assignments
      where school_id = _school_id and class_id = _class_id and teacher_user_id = _actor_id
    )
  then
    raise exception 'Teacher is not assigned to this class.' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.academic_terms
    where school_id = _school_id
      and id = _term_id
      and (starts_on is null or _date >= starts_on)
      and (ends_on is null or _date <= ends_on)
  ) then
    raise exception 'Attendance date is outside the selected term.' using errcode='23514';
  end if;

  for _entry in select * from jsonb_array_elements(_entries) loop
    _student := (_entry->>'studentId')::uuid;
    if not exists (
      select 1 from public.students
      where school_id = _school_id and id = _student and class_id = _class_id and status = 'active'
    ) then
      raise exception 'Student is not active in the selected class.' using errcode='23514';
    end if;

    insert into public.attendance_records(
      school_id, student_id, class_id, term_id, attendance_date, status, note, recorded_by
    ) values (
      _school_id, _student, _class_id, _term_id, _date,
      (_entry->>'status')::public.attendance_status,
      nullif(trim(_entry->>'note'), ''), _actor_id
    )
    on conflict(student_id, attendance_date) do update
      set status = excluded.status,
          note = excluded.note,
          term_id = excluded.term_id,
          class_id = excluded.class_id,
          recorded_by = excluded.recorded_by
    returning * into _saved;
    return next _saved;
  end loop;

  insert into public.audit_events(school_id, actor_id, action, entity_type, metadata)
  values (
    _school_id, _actor_id, 'attendance.class.captured', 'attendance',
    jsonb_build_object('classId', _class_id, 'termId', _term_id, 'date', _date, 'count', jsonb_array_length(_entries))
  );
end $$;

revoke all on function public.capture_class_attendance(uuid,uuid,uuid,date,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.capture_class_attendance(uuid,uuid,uuid,date,jsonb,uuid)
  to service_role;
