-- Immutable, reviewed curriculum topic versions and durable AI requests.
create table public.curriculum_topics (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 class_id uuid not null, subject_id uuid not null,
 curriculum text not null, version text not null, term text not null,
 week integer not null check(week between 1 and 53), topic text not null,
 objectives text[] not null check(cardinality(objectives) between 1 and 15),
 source_excerpt text not null check(char_length(source_excerpt) between 50 and 24000),
 source_reference text not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), unique(school_id,id),
 foreign key(school_id,class_id) references public.classes(school_id,id),
 foreign key(school_id,subject_id) references public.subjects(school_id,id)
);
create index curriculum_topics_scope on public.curriculum_topics(school_id,class_id,subject_id);
create table public.lesson_generation_requests (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id),
 classroom_id uuid not null, topic_id uuid not null, actor_id uuid not null references auth.users(id),
 request_key uuid not null, language text not null, duration integer not null check(duration between 10 and 180),
 context jsonb not null, context_hash text generated always as (md5(context::text)) stored, prompt_version text not null, model text, usage jsonb,
 lesson_id uuid, attempts integer not null default 0, lease_until timestamptz,
 created_at timestamptz not null default now(), unique(school_id,id), unique(school_id,actor_id,request_key),
 foreign key(school_id,classroom_id) references public.learning_classrooms(school_id,id),
 foreign key(school_id,topic_id) references public.curriculum_topics(school_id,id),
 foreign key(school_id,lesson_id) references public.lessons(school_id,id)
);
create table public.lesson_ai_daily_usage (
 scope text not null, day date not null default (now() at time zone 'UTC')::date,
 requests integer not null default 0, primary key(scope,day)
);
alter table public.curriculum_topics enable row level security;
alter table public.lesson_generation_requests enable row level security;
alter table public.lesson_ai_daily_usage enable row level security;
revoke all on public.curriculum_topics,public.lesson_generation_requests,public.lesson_ai_daily_usage from anon,authenticated;
grant all on public.curriculum_topics,public.lesson_generation_requests,public.lesson_ai_daily_usage to service_role;
-- Full documents/revisions contain private teacher guidance. Delivery is through
-- the authenticated API's class-scoped student projection, never raw table reads.
revoke all on public.lessons,public.lesson_revisions,public.lesson_resources,public.lesson_workflow_events from anon,authenticated;

create function public.request_lesson_generation(_school uuid,_actor uuid,_classroom uuid,_topic uuid,_key uuid,_language text,_duration integer,_prompt text)
returns public.lesson_generation_requests language plpgsql security definer set search_path='' as $$
declare r public.lesson_generation_requests; t public.curriculum_topics; c public.learning_classrooms; ctx jsonb;
begin
 if not public.can_edit_classroom(_school,_classroom,_actor) then raise exception 'Classroom is outside your teaching assignment.' using errcode='42501'; end if;
 select * into c from public.learning_classrooms where school_id=_school and id=_classroom and status='active';
 select * into t from public.curriculum_topics where school_id=_school and id=_topic and class_id=c.class_id and subject_id=c.subject_id;
 if t.id is null then raise exception 'Choose an approved curriculum topic for this classroom.' using errcode='23514'; end if;
 ctx:=jsonb_build_object('curriculum',t.curriculum,'version',t.version,'term',t.term,'week',t.week,'topic',t.topic,'objectives',t.objectives,'sourceExcerpt',t.source_excerpt,'sourceReference',t.source_reference,'class',(select name from public.classes where id=c.class_id),'subject',(select name from public.subjects where id=c.subject_id),'language',_language,'durationMinutes',_duration);
 insert into public.lesson_generation_requests(school_id,classroom_id,topic_id,actor_id,request_key,language,duration,context,prompt_version)
 values(_school,_classroom,_topic,_actor,_key,_language,_duration,ctx,_prompt) on conflict(school_id,actor_id,request_key) do nothing;
 select * into r from public.lesson_generation_requests where school_id=_school and actor_id=_actor and request_key=_key;
 if r.classroom_id<>_classroom or r.topic_id<>_topic or r.language<>_language or r.duration<>_duration then raise exception 'Request key already used with different settings.' using errcode='23514'; end if;
 return r;
end $$;

create function public.claim_lesson_generation(_school uuid,_request uuid,_global_limit integer,_school_limit integer)
returns text language plpgsql security definer set search_path='' as $$
declare r public.lesson_generation_requests; d date:=(now() at time zone 'UTC')::date; total integer; local_total integer;
begin
 select * into r from public.lesson_generation_requests where school_id=_school and id=_request for update;
 if r.id is null then return 'missing'; end if;
 if r.lesson_id is not null then return 'complete'; end if;
 if not public.can_edit_classroom(_school,r.classroom_id,r.actor_id) then return 'forbidden'; end if;
 if r.lease_until>now() then return 'busy'; end if;
 if r.attempts>=3 then return 'exhausted'; end if;
 insert into public.lesson_ai_daily_usage(scope,day) values('global',d),(_school::text,d) on conflict do nothing;
 select requests into total from public.lesson_ai_daily_usage where scope='global' and day=d for update;
 select requests into local_total from public.lesson_ai_daily_usage where scope=_school::text and day=d for update;
 if total>=_global_limit or local_total>=_school_limit then return 'quota'; end if;
 update public.lesson_ai_daily_usage set requests=requests+1 where day=d and scope in ('global',_school::text);
 update public.lesson_generation_requests set attempts=attempts+1,lease_until=now()+interval '3 minutes' where id=r.id;
 return 'run';
end $$;

create function public.finish_lesson_generation(_school uuid,_request uuid,_document jsonb,_model text,_usage jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.lesson_generation_requests; l public.lessons;
begin
 select * into r from public.lesson_generation_requests where school_id=_school and id=_request for update;
 if r.id is null then raise exception 'Generation request missing.'; end if;
 if r.lesson_id is not null then return r.lesson_id; end if;
 select * into l from public.save_lesson_document(_school,null,r.classroom_id,'note',_document->>'title',_document->>'summary',_document-'title'-'summary',r.actor_id);
 update public.lesson_generation_requests set lesson_id=l.id,model=_model,usage=_usage,lease_until=null where id=r.id;
 return l.id;
end $$;
revoke all on function public.request_lesson_generation(uuid,uuid,uuid,uuid,uuid,text,integer,text),public.claim_lesson_generation(uuid,uuid,integer,integer),public.finish_lesson_generation(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.request_lesson_generation(uuid,uuid,uuid,uuid,uuid,text,integer,text),public.claim_lesson_generation(uuid,uuid,integer,integer),public.finish_lesson_generation(uuid,uuid,jsonb,text,jsonb) to service_role;
