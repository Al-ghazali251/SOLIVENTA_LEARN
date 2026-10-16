-- Configurable continuous-assessment and examination components per report.
create table public.result_component_settings(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null,
  class_id uuid not null,
  report_type text not null check(report_type in ('mid_term','end_of_term','end_of_session')),
  continuous_assessment_percent numeric(5,2) not null default 30
    check(continuous_assessment_percent>0 and continuous_assessment_percent<100),
  examination_percent numeric(5,2) not null default 70
    check(examination_percent>0 and examination_percent<100),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,term_id,class_id,report_type), unique(school_id,id),
  foreign key(school_id,term_id) references public.academic_terms(school_id,id) on delete cascade,
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  check(continuous_assessment_percent+examination_percent=100)
);
create trigger result_component_settings_updated before update on public.result_component_settings
for each row execute function public.set_updated_at();
alter table public.result_component_settings enable row level security;
create policy result_component_settings_read on public.result_component_settings for select to authenticated
using(public.is_school_member(school_id));
create policy result_component_settings_manage on public.result_component_settings for all to authenticated
using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id));
grant select,insert,update on public.result_component_settings to authenticated;

create or replace function public.configure_result_components(
  _school uuid,_term uuid,_class uuid,_report_type text,_ca numeric,_exam numeric,_actor uuid
) returns public.result_component_settings
language plpgsql security definer set search_path='' as $$
declare _saved public.result_component_settings;
begin
  if _ca<=0 or _exam<=0 or _ca+_exam<>100 then
    raise exception 'Continuous assessment and examination percentages must total 100.' using errcode='22023';
  end if;
  if not public.can_manage_school(_school,_actor) and not exists(
    select 1 from public.teacher_class_subject_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor
  ) and not exists(
    select 1 from public.class_teacher_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor
  ) then raise exception 'You are not assigned to this class.' using errcode='42501'; end if;
  if exists(select 1 from public.result_workflows where school_id=_school and term_id=_term
    and class_id=_class and report_type=_report_type and status not in('draft','reopened')) then
    raise exception 'Result report is locked.' using errcode='23514';
  end if;
  if exists(
    select 1 from public.assessment_definitions a join public.result_scores s on s.assessment_id=a.id
    where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type=_report_type
      and ((a.name='Continuous assessment' and s.score>_ca) or (a.name='Examination' and s.score>_exam))
  ) then raise exception 'The new allocation is below a score that has already been entered.' using errcode='23514'; end if;
  insert into public.result_component_settings(school_id,term_id,class_id,report_type,
    continuous_assessment_percent,examination_percent,updated_by)
  values(_school,_term,_class,_report_type,_ca,_exam,_actor)
  on conflict(school_id,term_id,class_id,report_type) do update set
    continuous_assessment_percent=excluded.continuous_assessment_percent,
    examination_percent=excluded.examination_percent,updated_by=excluded.updated_by
  returning * into _saved;
  update public.assessment_definitions set maximum_score=case name
    when 'Continuous assessment' then _ca when 'Examination' then _exam else maximum_score end
  where school_id=_school and term_id=_term and class_id=_class and report_type=_report_type
    and name in('Continuous assessment','Examination');
  return _saved;
end $$;

create or replace function public.save_subject_result_scores_bulk(
  _school uuid,_ca_assessment uuid,_exam_assessment uuid,_entries jsonb,_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare _ca public.assessment_definitions; _exam public.assessment_definitions; _entry jsonb; _saved integer:=0;
begin
  select * into _ca from public.assessment_definitions where school_id=_school and id=_ca_assessment for update;
  select * into _exam from public.assessment_definitions where school_id=_school and id=_exam_assessment for update;
  if _ca.id is null or _exam.id is null or _ca.name<>'Continuous assessment' or _exam.name<>'Examination'
    or (_ca.term_id,_ca.class_id,_ca.subject_id,_ca.report_type) is distinct from
       (_exam.term_id,_exam.class_id,_exam.subject_id,_exam.report_type)
  then raise exception 'The score components do not belong to the same subject report.' using errcode='23514'; end if;
  if not public.can_manage_school(_school,_actor) and not exists(
    select 1 from public.teacher_class_subject_assignments where school_id=_school and class_id=_ca.class_id
      and subject_id=_ca.subject_id and teacher_user_id=_actor
  ) and not exists(
    select 1 from public.class_teacher_assignments where school_id=_school and class_id=_ca.class_id and teacher_user_id=_actor
  ) then raise exception 'You are not assigned to this subject.' using errcode='42501'; end if;
  if not public.result_score_is_editable(_school,_ca.id) then raise exception 'Result report is locked.' using errcode='23514'; end if;
  if jsonb_typeof(_entries)<>'array' or jsonb_array_length(_entries)=0 or jsonb_array_length(_entries)>250 then
    raise exception 'Provide an array of 1 to 250 scores.' using errcode='22023';
  end if;
  for _entry in select value from jsonb_array_elements(_entries) loop
    if not exists(select 1 from public.students where school_id=_school and id=(_entry->>'studentId')::uuid
      and class_id=_ca.class_id and status='active') then raise exception 'A student is not active in this class.' using errcode='23514'; end if;
    if (_entry->>'continuousAssessmentScore')::numeric not between 0 and _ca.maximum_score
      or (_entry->>'examinationScore')::numeric not between 0 and _exam.maximum_score
    then raise exception 'A score is outside the permitted component range.' using errcode='23514'; end if;
    insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by)
    values(_school,_ca.id,(_entry->>'studentId')::uuid,(_entry->>'continuousAssessmentScore')::numeric,_actor)
    on conflict(assessment_id,student_id) do update set score=excluded.score,recorded_by=excluded.recorded_by,updated_at=now();
    insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by)
    values(_school,_exam.id,(_entry->>'studentId')::uuid,(_entry->>'examinationScore')::numeric,_actor)
    on conflict(assessment_id,student_id) do update set score=excluded.score,recorded_by=excluded.recorded_by,updated_at=now();
    _saved:=_saved+1;
  end loop;
  return _saved;
end $$;

create or replace function public.ensure_result_report(
  _school uuid,_term uuid,_class uuid,_report_type text,_actor uuid
) returns setof public.assessment_definitions
language plpgsql security definer set search_path='' as $$
declare _ca numeric:=30; _exam numeric:=70;
begin
  if _report_type not in ('mid_term','end_of_term','end_of_session') then raise exception 'Invalid report type.' using errcode='22023'; end if;
  if not public.can_manage_school(_school,_actor) and not exists(select 1 from public.teacher_class_subject_assignments where school_id=_school and class_id=_class and teacher_user_id=_actor)
    and not exists(select 1 from public.class_teacher_assignments where school_id=_school and class_id=_class and teacher_user_id=_actor)
  then raise exception 'You are not assigned to this class.' using errcode='42501'; end if;
  select continuous_assessment_percent,examination_percent into _ca,_exam
  from public.result_component_settings where school_id=_school and term_id=_term and class_id=_class and report_type=_report_type;
  _ca:=coalesce(_ca,30); _exam:=coalesce(_exam,70);
  insert into public.assessment_definitions(school_id,term_id,class_id,subject_id,name,maximum_score,weight_percent,report_type,created_by)
  select _school,_term,_class,cs.subject_id,component.name,component.maximum,component.maximum,_report_type,_actor
  from public.class_subjects cs cross join (values('Continuous assessment'::text,_ca),('Examination'::text,_exam)) component(name,maximum)
  where cs.school_id=_school and cs.class_id=_class and (public.can_manage_school(_school,_actor)
    or exists(select 1 from public.teacher_class_subject_assignments ta where ta.school_id=_school and ta.class_id=_class and ta.subject_id=cs.subject_id and ta.teacher_user_id=_actor)
    or exists(select 1 from public.class_teacher_assignments ca where ca.school_id=_school and ca.class_id=_class and ca.teacher_user_id=_actor))
  on conflict(school_id,term_id,class_id,subject_id,report_type,name) do nothing;
  return query select a.* from public.assessment_definitions a where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type=_report_type;
end $$;
revoke all on function public.configure_result_components(uuid,uuid,uuid,text,numeric,numeric,uuid) from public,anon,authenticated;
revoke all on function public.save_subject_result_scores_bulk(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.configure_result_components(uuid,uuid,uuid,text,numeric,numeric,uuid) to service_role;
grant execute on function public.save_subject_result_scores_bulk(uuid,uuid,uuid,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
