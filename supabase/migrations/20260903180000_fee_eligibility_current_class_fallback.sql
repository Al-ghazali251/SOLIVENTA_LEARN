-- A current student class remains authoritative while schools transition legacy
-- student records into session-specific enrolments.
create or replace function public.student_matches_fee_definition(_school uuid, _student uuid, _fee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.fee_definitions f
    join public.academic_sessions fee_session
      on fee_session.school_id = f.school_id
     and fee_session.id = f.session_id
    join public.students s
      on s.school_id = f.school_id
     and s.id = _student
     and s.status = 'active'
    left join lateral (
      select enrollment.id, enrollment.class_id
      from public.student_enrollments enrollment
      where enrollment.school_id = s.school_id
        and enrollment.student_id = s.id
        and enrollment.session_id = f.session_id
        and enrollment.active
      order by enrollment.enrolled_at desc
      limit 1
    ) current_enrollment on true
    where f.school_id = _school
      and f.id = _fee
      and f.active
      and (current_enrollment.id is not null or fee_session.status = 'active')
      and (
        cardinality(f.class_ids) = 0
        or coalesce(current_enrollment.class_id, s.class_id) = any(f.class_ids)
      )
      and (
        f.student_audience = 'all'
        or (f.student_audience = 'new' and not exists (
          select 1 from public.student_enrollments prior
          where prior.school_id = s.school_id
            and prior.student_id = s.id
            and prior.session_id <> f.session_id
        ))
        or (f.student_audience = 'returning' and exists (
          select 1 from public.student_enrollments prior
          where prior.school_id = s.school_id
            and prior.student_id = s.id
            and prior.session_id <> f.session_id
        ))
      )
  );
$$;

revoke all on function public.student_matches_fee_definition(uuid, uuid, uuid)
from public, anon, authenticated;

notify pgrst, 'reload schema';
