-- Complete academic structure with class arms and audited student enrolment.

create table public.class_arms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  code text not null check (code ~ '^[A-Z0-9_-]{1,30}$'),
  capacity integer check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id,id), unique (class_id,name), unique (class_id,code),
  foreign key (school_id,class_id) references public.classes(school_id,id) on delete cascade
);

alter table public.student_enrollments add column arm_id uuid;
alter table public.student_enrollments add constraint student_enrollments_arm_fk
  foreign key (school_id,arm_id) references public.class_arms(school_id,id) on delete restrict;

create index class_arms_school_class_idx on public.class_arms(school_id,class_id) where active;
create index student_enrollments_school_session_idx on public.student_enrollments(school_id,session_id,active);
create unique index student_enrollments_one_active_idx on public.student_enrollments(school_id,student_id) where active;

create trigger class_arms_updated before update on public.class_arms for each row execute function public.set_updated_at();
create trigger class_arms_school_immutable before update on public.class_arms for each row execute function public.prevent_school_id_change();
alter table public.class_arms enable row level security;
create policy class_arms_read on public.class_arms for select to authenticated using(public.is_school_member(school_id));
create policy class_arms_manage on public.class_arms for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
grant select,insert,update,delete on public.class_arms to authenticated,service_role;

create or replace function public.manage_student_enrolment(
  _school_id uuid, _student_id uuid, _session_id uuid, _class_id uuid,
  _arm_id uuid, _enrolled_at date, _active boolean, _actor_id uuid
) returns public.student_enrollments
language plpgsql security definer set search_path='' as $$
declare _row public.student_enrollments;
begin
  if not exists(select 1 from public.students where school_id=_school_id and id=_student_id) then
    raise exception 'Student is outside the school.' using errcode='23503';
  end if;
  if not exists(select 1 from public.academic_sessions where school_id=_school_id and id=_session_id) then
    raise exception 'Session is outside the school.' using errcode='23503';
  end if;
  if not exists(select 1 from public.classes where school_id=_school_id and id=_class_id and active) then
    raise exception 'Class is outside the school or inactive.' using errcode='23503';
  end if;
  if _arm_id is not null and not exists(
    select 1 from public.class_arms where school_id=_school_id and id=_arm_id and class_id=_class_id and active
  ) then raise exception 'Arm does not belong to the selected class.' using errcode='23503'; end if;

  if _active then
    update public.student_enrollments set active=false
      where school_id=_school_id and student_id=_student_id and active and session_id<>_session_id;
  end if;
  insert into public.student_enrollments(school_id,student_id,session_id,class_id,arm_id,enrolled_at,active)
  values(_school_id,_student_id,_session_id,_class_id,_arm_id,coalesce(_enrolled_at,current_date),_active)
  on conflict(student_id,session_id) do update set class_id=excluded.class_id,arm_id=excluded.arm_id,
    enrolled_at=excluded.enrolled_at,active=excluded.active
  returning * into _row;

  if _active then update public.students set class_id=_class_id,updated_at=now()
    where school_id=_school_id and id=_student_id;
  elsif not exists(select 1 from public.student_enrollments where school_id=_school_id and student_id=_student_id and active) then
    update public.students set class_id=null,updated_at=now() where school_id=_school_id and id=_student_id;
  end if;

  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,case when _active then 'academic.student.enrolled' else 'academic.student.unenrolled' end,
    'student_enrollment',_row.id,jsonb_build_object('studentId',_student_id,'sessionId',_session_id,'classId',_class_id,'armId',_arm_id));
  return _row;
end; $$;
revoke all on function public.manage_student_enrolment(uuid,uuid,uuid,uuid,uuid,date,boolean,uuid) from public,anon,authenticated;
grant execute on function public.manage_student_enrolment(uuid,uuid,uuid,uuid,uuid,date,boolean,uuid) to service_role;
