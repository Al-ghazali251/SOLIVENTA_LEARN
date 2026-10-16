begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(13);

insert into public.academic_sessions(id,school_id,name,starts_on,ends_on) values('91000000-0000-4000-8000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','AI test session','2026-09-01','2027-07-31');
insert into public.classes(id,school_id,name,code) values('91000000-0000-4000-8000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','AI test class','AI_TEST');
insert into public.subjects(id,school_id,name,code) values('91000000-0000-4000-8000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','AI test subject','AI_TEST');
insert into public.learning_classrooms(id,school_id,session_id,class_id,subject_id,title) values('91000000-0000-4000-8000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','AI classroom');
insert into public.curriculum_topics(id,school_id,class_id,subject_id,curriculum,version,term,week,topic,objectives,source_excerpt,source_reference,created_by) values('91000000-0000-4000-8000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Test curriculum','1','First',1,'Fractions',array['Compare fractions'],repeat('Approved curriculum excerpt. ',4),'Edition 1, page 5','10000000-0000-0000-0000-000000000001');

select lives_ok($$select public.request_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000006','English',40,'lesson-note-v1')$$,'administrator can request a draft');
select lives_ok($$select public.request_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000006','English',40,'lesson-note-v1')$$,'repeated request is idempotent');
select is((select count(*)::integer from public.lesson_generation_requests where request_key='91000000-0000-4000-8000-000000000006'),1,'one durable request exists');
select throws_ok($$select public.request_lesson_generation('bbbbbbbb-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000007','English',40,'lesson-note-v1')$$,'23514',null,'another school cannot use this topic');
select throws_ok($$select public.request_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000007','English',40,'lesson-note-v1')$$,'42501',null,'unassigned teacher cannot generate');

create temporary table ai_request as select id from public.lesson_generation_requests where request_key='91000000-0000-4000-8000-000000000006';
-- Isolate counters within this rolled-back transaction.
delete from public.lesson_ai_daily_usage;
select is(public.claim_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001',(select id from ai_request),1,1),'run','first delivery claims quota');
select is(public.claim_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001',(select id from ai_request),1,1),'busy','concurrent delivery cannot call the model');
update public.lesson_generation_requests set lease_until=null where id=(select id from ai_request);
select is(public.claim_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001',(select id from ai_request),1,1),'quota','retry cannot exceed allowance');
select lives_ok($$select public.finish_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001',(select id from ai_request),'{"title":"Fractions","summary":"Draft","objectives":["Compare"],"sections":[{"id":"1","type":"paragraph","text":"Example"}],"teacherNotes":"Private answer key"}','test/free','{}')$$,'completion saves a draft');
select is((select l.status from public.lessons l join public.lesson_generation_requests r on r.lesson_id=l.id where r.id=(select id from ai_request)),'draft','AI never publishes');
select is(public.claim_lesson_generation('aaaaaaaa-0000-0000-0000-000000000001',(select id from ai_request),1,1),'complete','completed delivery skips inference');
select ok(not has_table_privilege('authenticated','public.lesson_revisions','SELECT'),'raw private revisions cannot be read directly');
select ok(not has_table_privilege('authenticated','public.lessons','SELECT'),'raw teacher content cannot bypass student projection');
select * from finish();
rollback;
