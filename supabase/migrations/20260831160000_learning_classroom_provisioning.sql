-- Idempotent classroom projection from academic structure, teaching assignments and enrolments.
create table public.learning_classrooms(
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 session_id uuid not null, class_id uuid not null, subject_id uuid not null, title text not null,
 status text not null default 'active' check(status in ('active','archived')),
 provisioned_at timestamptz not null default now(), archived_at timestamptz, updated_at timestamptz not null default now(),
 unique(school_id,id), unique(session_id,class_id,subject_id),
 foreign key(school_id,session_id) references public.academic_sessions(school_id,id) on delete cascade,
 foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
 foreign key(school_id,subject_id) references public.subjects(school_id,id) on delete cascade
);
create table public.learning_classroom_memberships(
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 classroom_id uuid not null, member_kind text not null check(member_kind in ('teacher','student')),
 user_id uuid references auth.users(id) on delete cascade, student_id uuid, role text not null check(role in ('owner','teacher','learner')),
 active boolean not null default true, joined_at timestamptz not null default now(), ended_at timestamptz,
 unique(school_id,id), foreign key(school_id,classroom_id) references public.learning_classrooms(school_id,id) on delete cascade,
 foreign key(school_id,student_id) references public.students(school_id,id) on delete cascade,
 check((member_kind='teacher' and user_id is not null and student_id is null and role in ('owner','teacher')) or (member_kind='student' and student_id is not null and role='learner'))
);
create unique index classroom_teacher_membership_uidx on public.learning_classroom_memberships(classroom_id,user_id) where member_kind='teacher';
create unique index classroom_student_membership_uidx on public.learning_classroom_memberships(classroom_id,student_id) where member_kind='student';
create index classrooms_school_status_idx on public.learning_classrooms(school_id,status,session_id);
create index classroom_members_school_idx on public.learning_classroom_memberships(school_id,classroom_id,active);
create trigger learning_classrooms_updated before update on public.learning_classrooms for each row execute function public.set_updated_at();
create trigger learning_classrooms_school_immutable before update on public.learning_classrooms for each row execute function public.prevent_school_id_change();
alter table public.learning_classrooms enable row level security; alter table public.learning_classroom_memberships enable row level security;
create policy classrooms_read on public.learning_classrooms for select to authenticated using(public.is_school_member(school_id));
create policy classroom_members_read on public.learning_classroom_memberships for select to authenticated using(public.is_school_member(school_id));
create policy classrooms_manage on public.learning_classrooms for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy classroom_members_manage on public.learning_classroom_memberships for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
grant select,insert,update,delete on public.learning_classrooms,public.learning_classroom_memberships to authenticated,service_role;

create or replace function public.reconcile_learning_classrooms(_school_id uuid,_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare _classrooms integer; _members integer;
begin
 insert into public.learning_classrooms(school_id,session_id,class_id,subject_id,title,status,archived_at)
 select _school_id,s.id,c.id,sub.id,c.name||' · '||sub.name,'active',null
 from public.academic_sessions s join public.classes c on c.school_id=s.school_id and c.active
 join public.class_subjects cs on cs.school_id=c.school_id and cs.class_id=c.id
 join public.subjects sub on sub.school_id=cs.school_id and sub.id=cs.subject_id and sub.active
 where s.school_id=_school_id and s.status in ('planned','active')
 on conflict(session_id,class_id,subject_id) do update set title=excluded.title,status='active',archived_at=null;
 get diagnostics _classrooms=row_count;
 update public.learning_classrooms lc set status='archived',archived_at=coalesce(archived_at,now())
 where lc.school_id=_school_id and status='active' and not exists(
  select 1 from public.academic_sessions s join public.classes c on c.school_id=s.school_id and c.id=lc.class_id and c.active
  join public.class_subjects cs on cs.school_id=c.school_id and cs.class_id=c.id and cs.subject_id=lc.subject_id
  join public.subjects sub on sub.school_id=cs.school_id and sub.id=cs.subject_id and sub.active
  where s.id=lc.session_id and s.status in ('planned','active'));

 update public.learning_classroom_memberships m set active=false,ended_at=coalesce(ended_at,now()) where m.school_id=_school_id and active;
 insert into public.learning_classroom_memberships(school_id,classroom_id,member_kind,user_id,role,active,ended_at)
 select _school_id,lc.id,'teacher',ta.teacher_user_id,'teacher',true,null from public.learning_classrooms lc
 join public.teacher_class_subject_assignments ta on ta.school_id=lc.school_id and ta.class_id=lc.class_id and ta.subject_id=lc.subject_id
 where lc.school_id=_school_id and lc.status='active'
 on conflict(classroom_id,user_id) where member_kind='teacher' do update set active=true,ended_at=null,role='teacher';
 insert into public.learning_classroom_memberships(school_id,classroom_id,member_kind,user_id,role,active,ended_at)
 select _school_id,lc.id,'teacher',cta.teacher_user_id,'owner',true,null from public.learning_classrooms lc
 join public.class_teacher_assignments cta on cta.school_id=lc.school_id and cta.class_id=lc.class_id
 where lc.school_id=_school_id and lc.status='active'
 on conflict(classroom_id,user_id) where member_kind='teacher' do update set active=true,ended_at=null,role='owner';
 insert into public.learning_classroom_memberships(school_id,classroom_id,member_kind,user_id,student_id,role,active,ended_at)
 select _school_id,lc.id,'student',st.user_id,e.student_id,'learner',true,null from public.learning_classrooms lc
 join public.student_enrollments e on e.school_id=lc.school_id and e.session_id=lc.session_id and e.class_id=lc.class_id and e.active
 join public.students st on st.school_id=e.school_id and st.id=e.student_id and st.status='active'
 where lc.school_id=_school_id and lc.status='active'
 on conflict(classroom_id,student_id) where member_kind='student' do update set active=true,ended_at=null,user_id=excluded.user_id;
 select count(*) into _members from public.learning_classroom_memberships where school_id=_school_id and active;
 if _actor_id is not null then insert into public.audit_events(school_id,actor_id,action,entity_type,metadata)
 values(_school_id,_actor_id,'learning.classrooms.reconciled','learning_classroom',jsonb_build_object('classroomsTouched',_classrooms,'activeMemberships',_members)); end if;
 return jsonb_build_object('classroomsTouched',_classrooms,'activeMemberships',_members);
end $$;
revoke all on function public.reconcile_learning_classrooms(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_learning_classrooms(uuid,uuid) to service_role;

create or replace function public.trigger_learning_classroom_reconcile() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public.reconcile_learning_classrooms(coalesce(new.school_id,old.school_id),null); return coalesce(new,old); end $$;
do $$ declare _table text; begin foreach _table in array array['academic_sessions','classes','subjects','class_subjects','class_teacher_assignments','teacher_class_subject_assignments','student_enrollments'] loop
 execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.trigger_learning_classroom_reconcile()',_table||'_classroom_reconcile',_table); end loop; end $$;
revoke all on function public.trigger_learning_classroom_reconcile() from public;
select public.reconcile_learning_classrooms(id,null) from public.schools;
