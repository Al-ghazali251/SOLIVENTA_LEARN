-- Complete, period-aware school results. Existing results are retained as end-of-term reports.
alter table public.assessment_definitions
  add column report_type text not null default 'end_of_term'
    check (report_type in ('mid_term','end_of_term','end_of_session'));

alter table public.result_workflows
  add column report_type text not null default 'end_of_term'
    check (report_type in ('mid_term','end_of_term','end_of_session'));
alter table public.result_workflows drop constraint result_workflows_school_id_term_id_class_id_key;
alter table public.result_workflows
  add constraint result_workflows_period_key unique(school_id,term_id,class_id,report_type);

alter table public.result_releases
  add column report_type text not null default 'end_of_term'
    check (report_type in ('mid_term','end_of_term','end_of_session'));
alter table public.result_releases drop constraint result_releases_term_id_class_id_key;
alter table public.result_releases
  add constraint result_releases_period_key unique(school_id,term_id,class_id,report_type);

alter table public.assessment_definitions drop constraint assessment_definitions_term_id_class_id_subject_id_name_key;
alter table public.assessment_definitions
  add constraint assessment_definitions_period_subject_key
  unique(school_id,term_id,class_id,subject_id,report_type,name);

create table public.student_report_summaries(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null,
  class_id uuid not null,
  student_id uuid not null,
  report_type text not null check(report_type in ('mid_term','end_of_term','end_of_session')),
  teacher_remark text check(teacher_remark is null or char_length(teacher_remark)<=1000),
  principal_remark text check(principal_remark is null or char_length(principal_remark)<=1000),
  attendance_present integer check(attendance_present is null or attendance_present>=0),
  attendance_total integer check(attendance_total is null or attendance_total>=0),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,term_id,class_id,student_id,report_type), unique(school_id,id),
  foreign key(school_id,term_id) references public.academic_terms(school_id,id) on delete cascade,
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  foreign key(school_id,student_id) references public.students(school_id,id) on delete cascade,
  check(attendance_present is null or attendance_total is null or attendance_present<=attendance_total)
);

create table public.result_promotion_rules(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null,
  report_type text not null default 'end_of_session' check(report_type in ('end_of_term','end_of_session')),
  minimum_average_percent numeric(5,2) check(minimum_average_percent is null or minimum_average_percent between 0 and 100),
  subject_requirements jsonb not null default '[]'::jsonb check(jsonb_typeof(subject_requirements)='array'),
  active boolean not null default true,
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,class_id,report_type), unique(school_id,id),
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade
);

create trigger student_report_summaries_updated before update on public.student_report_summaries
for each row execute function public.set_updated_at();
create trigger result_promotion_rules_updated before update on public.result_promotion_rules
for each row execute function public.set_updated_at();

create or replace function public.enforce_report_summary_editable() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.result_workflows w where w.school_id=new.school_id
    and w.term_id=new.term_id and w.class_id=new.class_id and w.report_type=new.report_type
    and w.status not in ('draft','reopened')) then
    raise exception 'Result report is locked.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger student_report_summaries_workflow_lock before insert or update
on public.student_report_summaries for each row execute function public.enforce_report_summary_editable();

create or replace function public.result_score_is_editable(_school_id uuid,_assessment_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select rw.status in ('draft','reopened') from public.assessment_definitions a
    left join public.result_workflows rw on rw.school_id=a.school_id and rw.term_id=a.term_id
      and rw.class_id=a.class_id and rw.report_type=a.report_type
    where a.school_id=_school_id and a.id=_assessment_id),true);
$$;

create or replace function public.ensure_result_report(
  _school uuid,_term uuid,_class uuid,_report_type text,_actor uuid
) returns setof public.assessment_definitions
language plpgsql security definer set search_path='' as $$
begin
  if _report_type not in ('mid_term','end_of_term','end_of_session') then
    raise exception 'Invalid report type.' using errcode='22023';
  end if;
  if not public.can_manage_school(_school,_actor) and not exists(
    select 1 from public.teacher_class_subject_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor
  ) and not exists(
    select 1 from public.class_teacher_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor
  ) then raise exception 'You are not assigned to this class.' using errcode='42501'; end if;
  insert into public.assessment_definitions(
    school_id,term_id,class_id,subject_id,name,maximum_score,weight_percent,report_type,created_by
  )
  select _school,_term,_class,cs.subject_id,
    case _report_type when 'mid_term' then 'Mid-term' when 'end_of_term' then 'End-of-term' else 'End-of-session' end,
    100,100,_report_type,_actor
  from public.class_subjects cs
  where cs.school_id=_school and cs.class_id=_class
    and (public.can_manage_school(_school,_actor) or exists(
      select 1 from public.teacher_class_subject_assignments ta
      where ta.school_id=_school and ta.class_id=_class and ta.subject_id=cs.subject_id and ta.teacher_user_id=_actor
    ) or exists(
      select 1 from public.class_teacher_assignments ca
      where ca.school_id=_school and ca.class_id=_class and ca.teacher_user_id=_actor
    ))
  on conflict(school_id,term_id,class_id,subject_id,report_type,name) do nothing;
  return query select a.* from public.assessment_definitions a
  where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type=_report_type;
end $$;

create or replace function public.save_result_scores_bulk(
  _school uuid,_assessment uuid,_entries jsonb,_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare _a public.assessment_definitions; _entry jsonb; _saved integer:=0;
begin
  select * into _a from public.assessment_definitions where school_id=_school and id=_assessment;
  if _a.id is null then raise exception 'Assessment not found.' using errcode='P0002'; end if;
  if not public.can_manage_school(_school,_actor) and not exists(
    select 1 from public.teacher_class_subject_assignments where school_id=_school
      and class_id=_a.class_id and subject_id=_a.subject_id and teacher_user_id=_actor
  ) and not exists(
    select 1 from public.class_teacher_assignments where school_id=_school
      and class_id=_a.class_id and teacher_user_id=_actor
  ) then raise exception 'You are not assigned to this subject.' using errcode='42501'; end if;
  if jsonb_typeof(_entries)<>'array' or jsonb_array_length(_entries)>250 then
    raise exception 'Provide an array of at most 250 scores.' using errcode='22023';
  end if;
  for _entry in select value from jsonb_array_elements(_entries) loop
    if not exists(select 1 from public.students where school_id=_school
      and id=(_entry->>'studentId')::uuid and class_id=_a.class_id and status='active') then
      raise exception 'A student is not active in this class.' using errcode='23514';
    end if;
    if (_entry->>'score')::numeric < 0 or (_entry->>'score')::numeric > _a.maximum_score then
      raise exception 'A score is outside the permitted range.' using errcode='23514';
    end if;
    insert into public.result_scores(school_id,assessment_id,student_id,score,remark,recorded_by)
    values(_school,_assessment,(_entry->>'studentId')::uuid,(_entry->>'score')::numeric,
      nullif(trim(_entry->>'remark'),''),_actor)
    on conflict(assessment_id,student_id) do update set score=excluded.score,
      remark=excluded.remark,recorded_by=excluded.recorded_by,updated_at=now();
    _saved:=_saved+1;
  end loop;
  return _saved;
end $$;

alter table public.student_report_summaries enable row level security;
alter table public.result_promotion_rules enable row level security;
create policy report_summaries_read on public.student_report_summaries for select to authenticated
using(public.is_school_member(school_id));
create policy report_summaries_manage on public.student_report_summaries for all to authenticated
using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id));
create policy promotion_rules_read on public.result_promotion_rules for select to authenticated
using(public.is_school_staff(school_id));
create policy promotion_rules_manage on public.result_promotion_rules for all to authenticated
using(public.account_has_permission(auth.uid(),school_id,'students.promote'))
with check(public.account_has_permission(auth.uid(),school_id,'students.promote'));
grant select,insert,update on public.student_report_summaries to authenticated;
grant select,insert,update on public.result_promotion_rules to authenticated;
revoke all on function public.ensure_result_report(uuid,uuid,uuid,text,uuid),
  public.save_result_scores_bulk(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ensure_result_report(uuid,uuid,uuid,text,uuid),
  public.save_result_scores_bulk(uuid,uuid,jsonb,uuid) to service_role;
notify pgrst, 'reload schema';
