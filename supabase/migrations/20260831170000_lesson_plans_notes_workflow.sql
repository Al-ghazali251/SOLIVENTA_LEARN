-- Structured lesson plans/notes, immutable revisions, resources and approval workflow.
alter table public.lessons drop constraint if exists lessons_status_check;
alter table public.lessons
 add column classroom_id uuid,
 add column kind text not null default 'plan' check(kind in ('plan','note')),
 add column revision integer not null default 1 check(revision>0),
 add column submitted_at timestamptz, add column submitted_by uuid references auth.users(id),
 add column reviewed_at timestamptz, add column reviewed_by uuid references auth.users(id),
 add column review_note text,
 add constraint lessons_status_check check(status in ('draft','submitted','changes_requested','approved','published','archived')),
 add constraint lessons_classroom_fk foreign key(school_id,classroom_id) references public.learning_classrooms(school_id,id) on delete restrict;

create table public.lesson_revisions(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,
 lesson_id uuid not null,revision integer not null,kind text not null,title text not null,summary text,content jsonb not null,
 status text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 unique(lesson_id,revision),unique(school_id,id),foreign key(school_id,lesson_id) references public.lessons(school_id,id) on delete cascade
);
create table public.lesson_resources(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,
 lesson_id uuid not null,kind text not null check(kind in ('link','document','video','image','audio','other')),
 title text not null check(char_length(trim(title)) between 1 and 200),url text not null check(char_length(trim(url)) between 1 and 2000),
 description text,mime_type text,size_bytes bigint check(size_bytes is null or size_bytes>=0),position integer not null default 1 check(position>0),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(school_id,id),
 foreign key(school_id,lesson_id) references public.lessons(school_id,id) on delete cascade
);
create table public.lesson_workflow_events(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,
 lesson_id uuid not null,from_status text,to_status text not null,note text,actor_id uuid not null references auth.users(id),occurred_at timestamptz not null default now(),
 unique(school_id,id),foreign key(school_id,lesson_id) references public.lessons(school_id,id) on delete cascade
);
create index lesson_resources_lesson_idx on public.lesson_resources(school_id,lesson_id,position);
create index lesson_workflow_lesson_idx on public.lesson_workflow_events(school_id,lesson_id,occurred_at);
do $$ declare t text; begin foreach t in array array['lesson_revisions','lesson_resources','lesson_workflow_events'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I_read on public.%I for select to authenticated using(public.is_school_member(school_id))',t,t); end loop; end $$;
grant select on public.lesson_revisions,public.lesson_resources,public.lesson_workflow_events to authenticated,service_role;
grant insert,update,delete on public.lesson_revisions,public.lesson_resources,public.lesson_workflow_events to service_role;

create or replace function public.can_edit_classroom(_school uuid,_classroom uuid,_actor uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_manage_school(_school,_actor) or exists(select 1 from public.learning_classroom_memberships where school_id=_school and classroom_id=_classroom and user_id=_actor and member_kind='teacher' and active)
$$;
create or replace function public.save_lesson_document(_school uuid,_lesson uuid,_classroom uuid,_kind text,_title text,_summary text,_content jsonb,_actor uuid)
returns public.lessons language plpgsql security definer set search_path='' as $$
declare _room public.learning_classrooms;_row public.lessons;
begin
 select * into _room from public.learning_classrooms where school_id=_school and id=_classroom and status='active';
 if _room.id is null or not public.can_edit_classroom(_school,_classroom,_actor) then raise exception 'Classroom is unavailable or outside the teaching assignment.' using errcode='42501';end if;
 if _kind not in ('plan','note') then raise exception 'Invalid lesson kind.' using errcode='23514';end if;
 if jsonb_typeof(_content)<>'object' or jsonb_typeof(_content->'sections')<>'array' then raise exception 'Structured lesson sections are required.' using errcode='23514';end if;
 if _lesson is null then
  insert into public.lessons(school_id,classroom_id,class_id,subject_id,kind,title,summary,content,status,created_by)
  values(_school,_classroom,_room.class_id,_room.subject_id,_kind,trim(_title),nullif(trim(_summary),''),_content,'draft',_actor) returning * into _row;
 else
  update public.lessons set classroom_id=_classroom,class_id=_room.class_id,subject_id=_room.subject_id,kind=_kind,title=trim(_title),summary=nullif(trim(_summary),''),content=_content,revision=revision+1,status='draft',submitted_at=null,submitted_by=null,reviewed_at=null,reviewed_by=null,review_note=null
  where school_id=_school and id=_lesson and status in ('draft','changes_requested') returning * into _row;
  if _row.id is null then raise exception 'Only draft or returned lessons can be edited.' using errcode='23514';end if;
 end if;
 insert into public.lesson_revisions(school_id,lesson_id,revision,kind,title,summary,content,status,created_by) values(_school,_row.id,_row.revision,_row.kind,_row.title,_row.summary,_row.content,_row.status,_actor);
 return _row;
end $$;
create or replace function public.transition_lesson_document(_school uuid,_lesson uuid,_action text,_note text,_actor uuid)
returns public.lessons language plpgsql security definer set search_path='' as $$
declare _old public.lessons;_row public.lessons;_target text;
begin select * into _old from public.lessons where school_id=_school and id=_lesson for update;if _old.id is null then raise exception 'Lesson not found.' using errcode='P0002';end if;
 if _action='submit' and _old.status in ('draft','changes_requested') and public.can_edit_classroom(_school,_old.classroom_id,_actor) then _target:='submitted';
 elsif _action in ('approve','request_changes') and _old.status='submitted' and public.can_manage_school(_school,_actor) then _target:=case when _action='approve' then 'approved' else 'changes_requested' end;
 elsif _action='publish' and _old.status='approved' and public.can_manage_school(_school,_actor) then _target:='published';
 elsif _action='archive' and _old.status='published' and public.can_manage_school(_school,_actor) then _target:='archived';
 else raise exception 'Lesson transition is not permitted from the current state.' using errcode='42501';end if;
 update public.lessons set status=_target,submitted_at=case when _target='submitted' then now() else submitted_at end,submitted_by=case when _target='submitted' then _actor else submitted_by end,reviewed_at=case when _target in ('approved','changes_requested') then now() else reviewed_at end,reviewed_by=case when _target in ('approved','changes_requested') then _actor else reviewed_by end,review_note=case when _target in ('approved','changes_requested') then nullif(trim(_note),'') else review_note end,published_at=case when _target='published' then now() else published_at end where id=_lesson returning * into _row;
 insert into public.lesson_workflow_events(school_id,lesson_id,from_status,to_status,note,actor_id) values(_school,_lesson,_old.status,_target,nullif(trim(_note),''),_actor);
 insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school,_actor,'lesson.'||_action,'lesson',_lesson,jsonb_build_object('from',_old.status,'to',_target,'revision',_old.revision));
 return _row;
end $$;
create or replace function public.add_lesson_resource(_school uuid,_lesson uuid,_kind text,_title text,_url text,_description text,_actor uuid)
returns public.lesson_resources language plpgsql security definer set search_path='' as $$
declare _row public.lesson_resources;_classroom uuid;begin select classroom_id into _classroom from public.lessons where school_id=_school and id=_lesson and status in ('draft','changes_requested');if _classroom is null or not public.can_edit_classroom(_school,_classroom,_actor) then raise exception 'Lesson resources are not editable.' using errcode='42501';end if;
insert into public.lesson_resources(school_id,lesson_id,kind,title,url,description,position,created_by) values(_school,_lesson,_kind,trim(_title),trim(_url),nullif(trim(_description),''),coalesce((select max(position)+1 from public.lesson_resources where lesson_id=_lesson),1),_actor) returning * into _row;return _row;end $$;
create or replace function public.remove_lesson_resource(_school uuid,_resource uuid,_actor uuid) returns public.lesson_resources language plpgsql security definer set search_path='' as $$
declare _row public.lesson_resources;_classroom uuid;begin select l.classroom_id into _classroom from public.lesson_resources r join public.lessons l on l.id=r.lesson_id and l.school_id=r.school_id where r.school_id=_school and r.id=_resource and l.status in ('draft','changes_requested');if _classroom is null or not public.can_edit_classroom(_school,_classroom,_actor) then raise exception 'Lesson resource is not editable.' using errcode='42501';end if;delete from public.lesson_resources where school_id=_school and id=_resource returning * into _row;return _row;end $$;
revoke all on function public.can_edit_classroom(uuid,uuid,uuid),public.save_lesson_document(uuid,uuid,uuid,text,text,text,jsonb,uuid),public.transition_lesson_document(uuid,uuid,text,text,uuid),public.add_lesson_resource(uuid,uuid,text,text,text,text,uuid),public.remove_lesson_resource(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_lesson_document(uuid,uuid,uuid,text,text,text,jsonb,uuid),public.transition_lesson_document(uuid,uuid,text,text,uuid),public.add_lesson_resource(uuid,uuid,text,text,text,text,uuid),public.remove_lesson_resource(uuid,uuid,uuid) to service_role;
