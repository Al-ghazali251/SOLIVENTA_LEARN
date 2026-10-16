-- Mid-term modes, traceable CA imports, and weighted end-of-session results.
alter table public.result_component_settings
  add column midterm_ca_only boolean not null default true;

create table public.result_session_weight_settings(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  session_id uuid not null,
  class_id uuid not null,
  first_term_percent numeric(5,2) not null default 33.33 check(first_term_percent>=0 and first_term_percent<=100),
  second_term_percent numeric(5,2) not null default 33.33 check(second_term_percent>=0 and second_term_percent<=100),
  third_term_percent numeric(5,2) not null default 33.34 check(third_term_percent>=0 and third_term_percent<=100),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,session_id,class_id), unique(school_id,id),
  foreign key(school_id,session_id) references public.academic_sessions(school_id,id) on delete cascade,
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  check(first_term_percent+second_term_percent+third_term_percent=100)
);
create trigger result_session_weight_settings_updated before update on public.result_session_weight_settings
for each row execute function public.set_updated_at();

create table public.result_score_imports(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  target_score_id uuid not null,
  source_score_id uuid not null,
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  unique(target_score_id), unique(school_id,id),
  foreign key(school_id,target_score_id) references public.result_scores(school_id,id) on delete cascade,
  foreign key(school_id,source_score_id) references public.result_scores(school_id,id) on delete restrict
);

create table public.result_session_calculations(
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  target_score_id uuid not null, source_term_scores jsonb not null check(jsonb_typeof(source_term_scores)='array'),
  weight_snapshot jsonb not null check(jsonb_typeof(weight_snapshot)='object'), calculated_by uuid not null references auth.users(id),
  calculated_at timestamptz not null default now(), unique(target_score_id), unique(school_id,id),
  foreign key(school_id,target_score_id) references public.result_scores(school_id,id) on delete cascade
);

alter table public.result_session_weight_settings enable row level security;
alter table public.result_score_imports enable row level security;
alter table public.result_session_calculations enable row level security;
create policy result_session_weights_read on public.result_session_weight_settings for select to authenticated
using(public.is_school_member(school_id));
create policy result_session_weights_manage on public.result_session_weight_settings for all to authenticated
using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id));
create policy result_score_imports_read on public.result_score_imports for select to authenticated
using(public.is_school_member(school_id));
create policy result_session_calculations_read on public.result_session_calculations for select to authenticated
using(public.is_school_member(school_id));
grant select,insert,update on public.result_session_weight_settings to authenticated;
grant select on public.result_score_imports to authenticated;
grant select on public.result_session_calculations to authenticated;

create or replace function public.configure_result_period_policy(
  _school uuid,_term uuid,_class uuid,_midterm_ca_only boolean,_ca numeric,_exam numeric,_actor uuid
) returns public.result_component_settings language plpgsql security definer set search_path='' as $$
declare _saved public.result_component_settings;
begin
  if not public.can_manage_school(_school,_actor) and not exists(select 1 from public.class_teacher_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor)
  then raise exception 'You are not assigned to manage this class.' using errcode='42501'; end if;
  if exists(select 1 from public.result_workflows where school_id=_school and term_id=_term and class_id=_class
    and report_type='mid_term' and status not in('draft','reopened'))
  then raise exception 'The mid-term report is locked.' using errcode='23514'; end if;
  if _midterm_ca_only then _ca:=30; _exam:=70; end if;
  if _ca<=0 or _exam<=0 or _ca+_exam<>100 then raise exception 'CA and examination percentages must total 100.' using errcode='22023'; end if;
  insert into public.result_component_settings(school_id,term_id,class_id,report_type,
    continuous_assessment_percent,examination_percent,midterm_ca_only,updated_by)
  values(_school,_term,_class,'mid_term',_ca,_exam,_midterm_ca_only,_actor)
  on conflict(school_id,term_id,class_id,report_type) do update set
    continuous_assessment_percent=excluded.continuous_assessment_percent,
    examination_percent=excluded.examination_percent,midterm_ca_only=excluded.midterm_ca_only,updated_by=excluded.updated_by
  returning * into _saved;
  update public.assessment_definitions set maximum_score=case when _midterm_ca_only then 30 else
    case name when 'Continuous assessment' then _ca else _exam end end,
    weight_percent=case when _midterm_ca_only then 100 else case name when 'Continuous assessment' then _ca else _exam end end
  where school_id=_school and term_id=_term and class_id=_class and report_type='mid_term'
    and name='Continuous assessment';
  if _midterm_ca_only and exists(select 1 from public.result_scores s join public.assessment_definitions a on a.id=s.assessment_id
    where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type='mid_term'
      and (a.name='Examination' or (a.name='Continuous assessment' and s.score>30)))
  then raise exception 'Remove examination scores and CA scores above 30 before switching to CA-only.' using errcode='23514'; end if;
  if _midterm_ca_only then delete from public.assessment_definitions where school_id=_school and term_id=_term and class_id=_class
    and report_type='mid_term' and name='Examination'; end if;
  return _saved;
end $$;

create or replace function public.import_midterm_scores_to_end_term(
  _school uuid,_term uuid,_class uuid,_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare _count integer:=0; _row record; _target_id uuid;
begin
  if not public.can_manage_school(_school,_actor) and not exists(select 1 from public.class_teacher_assignments
    where school_id=_school and class_id=_class and teacher_user_id=_actor)
  then raise exception 'You are not assigned to manage this class.' using errcode='42501'; end if;
  if not exists(select 1 from public.result_releases where school_id=_school and term_id=_term and class_id=_class
    and report_type='mid_term' and status='released') then raise exception 'Publish the mid-term result before importing it.' using errcode='23514'; end if;
  if exists(select 1 from public.result_workflows where school_id=_school and term_id=_term and class_id=_class
    and report_type='end_of_term' and status not in('draft','reopened')) then raise exception 'The end-of-term report is locked.' using errcode='23514'; end if;
  perform public.ensure_result_report(_school,_term,_class,'end_of_term',_actor);
  for _row in select s.id source_score_id,s.student_id,s.score,a.subject_id,a.maximum_score source_max
    from public.result_scores s join public.assessment_definitions a on a.id=s.assessment_id
    where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type='mid_term'
      and a.name='Continuous assessment'
  loop
    select id into _target_id from public.assessment_definitions where school_id=_school and term_id=_term
      and class_id=_class and subject_id=_row.subject_id and report_type='end_of_term' and name='Continuous assessment';
    if _target_id is null then continue; end if;
    insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by)
    select _school,_target_id,_row.student_id,round((_row.score/_row.source_max)*a.maximum_score,2),_actor
    from public.assessment_definitions a where a.id=_target_id
    on conflict(assessment_id,student_id) do update set score=excluded.score,recorded_by=excluded.recorded_by,updated_at=now()
    returning id into _target_id;
    insert into public.result_score_imports(school_id,target_score_id,source_score_id,imported_by)
    values(_school,_target_id,_row.source_score_id,_actor)
    on conflict(target_score_id) do update set source_score_id=excluded.source_score_id,imported_by=excluded.imported_by,imported_at=now();
    _count:=_count+1;
  end loop;
  return _count;
end $$;

create or replace function public.configure_result_session_weights(
  _school uuid,_session uuid,_class uuid,_first numeric,_second numeric,_third numeric,_actor uuid
) returns public.result_session_weight_settings language plpgsql security definer set search_path='' as $$
declare _saved public.result_session_weight_settings;
begin
  if not public.can_manage_school(_school,_actor) then raise exception 'Only a school administrator can configure session weights.' using errcode='42501'; end if;
  if _first<0 or _second<0 or _third<0 or _first+_second+_third<>100 then raise exception 'The three term weights must total 100.' using errcode='22023'; end if;
  insert into public.result_session_weight_settings(school_id,session_id,class_id,first_term_percent,second_term_percent,third_term_percent,updated_by)
  values(_school,_session,_class,_first,_second,_third,_actor)
  on conflict(school_id,session_id,class_id) do update set first_term_percent=excluded.first_term_percent,
    second_term_percent=excluded.second_term_percent,third_term_percent=excluded.third_term_percent,updated_by=excluded.updated_by
  returning * into _saved;
  return _saved;
end $$;

create or replace function public.build_end_of_session_results(
  _school uuid,_session uuid,_class uuid,_actor uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare _target_term uuid; _weights public.result_session_weight_settings; _count integer:=0; _row record; _score_id uuid;
begin
  if not public.can_manage_school(_school,_actor) then raise exception 'Only a school administrator can calculate session results.' using errcode='42501'; end if;
  select id into _target_term from public.academic_terms where school_id=_school and session_id=_session order by position desc limit 1;
  if _target_term is null or (select count(*) from public.academic_terms where school_id=_school and session_id=_session and position between 1 and 3)<>3
  then raise exception 'The session must have First, Second and Third Term.' using errcode='23514'; end if;
  if (select count(*) from public.result_releases r join public.academic_terms t on t.id=r.term_id
      where r.school_id=_school and r.class_id=_class and r.report_type='end_of_term' and r.status='released'
        and t.session_id=_session and t.position between 1 and 3)<>3
  then raise exception 'Publish all three end-of-term reports before calculating the session report.' using errcode='23514'; end if;
  if exists(select 1 from public.result_workflows where school_id=_school and term_id=_target_term and class_id=_class
    and report_type='end_of_session' and status not in('draft','reopened'))
  then raise exception 'The end-of-session report is locked.' using errcode='23514'; end if;
  select * into _weights from public.result_session_weight_settings where school_id=_school and session_id=_session and class_id=_class;
  if _weights.id is null then
    insert into public.result_session_weight_settings(school_id,session_id,class_id,updated_by)
    values(_school,_session,_class,_actor) returning * into _weights;
  end if;
  insert into public.assessment_definitions(school_id,term_id,class_id,subject_id,name,maximum_score,weight_percent,report_type,created_by)
  select _school,_target_term,_class,subject_id,'Session weighted result',100,100,'end_of_session',_actor
  from public.class_subjects where school_id=_school and class_id=_class
  on conflict(school_id,term_id,class_id,subject_id,report_type,name) do nothing;
  for _row in
    with term_totals as (
      select t.position,a.subject_id,st.id student_id,round(sum(s.score)/sum(a.maximum_score)*100,2) term_score
      from public.academic_terms t join public.assessment_definitions a on a.term_id=t.id and a.school_id=t.school_id
      cross join public.students st
      left join public.result_scores s on s.assessment_id=a.id and s.student_id=st.id
      where t.school_id=_school and t.session_id=_session and t.position between 1 and 3 and a.class_id=_class
        and a.report_type='end_of_term' and a.name in('Continuous assessment','Examination')
        and st.school_id=_school and st.class_id=_class and st.status='active'
      group by t.position,a.subject_id,st.id having count(s.id)=count(a.id)
    )
    select student_id,subject_id,
      round(sum(term_score*case position when 1 then _weights.first_term_percent when 2 then _weights.second_term_percent else _weights.third_term_percent end)/100,2) final_score,
      jsonb_agg(jsonb_build_object('position',position,'score',term_score) order by position) sources
    from term_totals group by student_id,subject_id having count(*)=3
  loop
    insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by)
    select _school,a.id,_row.student_id,_row.final_score,_actor from public.assessment_definitions a
    where a.school_id=_school and a.term_id=_target_term and a.class_id=_class and a.subject_id=_row.subject_id
      and a.report_type='end_of_session' and a.name='Session weighted result'
    on conflict(assessment_id,student_id) do update set score=excluded.score,recorded_by=excluded.recorded_by,updated_at=now()
    returning id into _score_id;
    insert into public.result_session_calculations(school_id,target_score_id,source_term_scores,weight_snapshot,calculated_by)
    values(_school,_score_id,_row.sources,jsonb_build_object('first',_weights.first_term_percent,'second',_weights.second_term_percent,'third',_weights.third_term_percent),_actor)
    on conflict(target_score_id) do update set source_term_scores=excluded.source_term_scores,weight_snapshot=excluded.weight_snapshot,
      calculated_by=excluded.calculated_by,calculated_at=now();
    _count:=_count+1;
  end loop;
  return _count;
end $$;

-- Mid-term defaults to one CA assessment over 30; other report types retain CA + examination.
create or replace function public.ensure_result_report(_school uuid,_term uuid,_class uuid,_report_type text,_actor uuid)
returns setof public.assessment_definitions language plpgsql security definer set search_path='' as $$
declare _ca numeric:=30; _exam numeric:=70; _ca_only boolean:=true;
begin
  if _report_type not in('mid_term','end_of_term','end_of_session') then raise exception 'Invalid report type.' using errcode='22023'; end if;
  if not public.can_manage_school(_school,_actor) and not exists(select 1 from public.teacher_class_subject_assignments where school_id=_school and class_id=_class and teacher_user_id=_actor)
    and not exists(select 1 from public.class_teacher_assignments where school_id=_school and class_id=_class and teacher_user_id=_actor)
  then raise exception 'You are not assigned to this class.' using errcode='42501'; end if;
  select continuous_assessment_percent,examination_percent,midterm_ca_only into _ca,_exam,_ca_only
  from public.result_component_settings where school_id=_school and term_id=_term and class_id=_class and report_type=_report_type;
  _ca:=coalesce(_ca,30); _exam:=coalesce(_exam,70); _ca_only:=coalesce(_ca_only,_report_type='mid_term');
  insert into public.assessment_definitions(school_id,term_id,class_id,subject_id,name,maximum_score,weight_percent,report_type,created_by)
  select _school,_term,_class,cs.subject_id,c.name,c.maximum,c.weight,_report_type,_actor from public.class_subjects cs
  cross join lateral (select 'Continuous assessment'::text,case when _report_type='mid_term' and _ca_only then 30 else _ca end,
    case when _report_type='mid_term' and _ca_only then 100 else _ca end
    union all select 'Examination',_exam,_exam where not(_report_type='mid_term' and _ca_only)) c(name,maximum,weight)
  where cs.school_id=_school and cs.class_id=_class and (public.can_manage_school(_school,_actor)
    or exists(select 1 from public.teacher_class_subject_assignments ta where ta.school_id=_school and ta.class_id=_class and ta.subject_id=cs.subject_id and ta.teacher_user_id=_actor)
    or exists(select 1 from public.class_teacher_assignments ca where ca.school_id=_school and ca.class_id=_class and ca.teacher_user_id=_actor))
  on conflict(school_id,term_id,class_id,subject_id,report_type,name) do nothing;
  return query select a.* from public.assessment_definitions a where a.school_id=_school and a.term_id=_term and a.class_id=_class and a.report_type=_report_type;
end $$;

revoke all on function public.configure_result_period_policy(uuid,uuid,uuid,boolean,numeric,numeric,uuid),
 public.import_midterm_scores_to_end_term(uuid,uuid,uuid,uuid),
 public.configure_result_session_weights(uuid,uuid,uuid,numeric,numeric,numeric,uuid),
 public.build_end_of_session_results(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.configure_result_period_policy(uuid,uuid,uuid,boolean,numeric,numeric,uuid),
 public.import_midterm_scores_to_end_term(uuid,uuid,uuid,uuid),
 public.configure_result_session_weights(uuid,uuid,uuid,numeric,numeric,numeric,uuid),
 public.build_end_of_session_results(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
