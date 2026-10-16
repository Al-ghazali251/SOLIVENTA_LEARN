begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

select is((select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(array['academic_sessions','academic_terms','classes','subjects','class_subjects','class_teacher_assignments','teacher_class_subject_assignments']) and c.relkind='r'), 7, 'all academic structure tables exist');
select is((select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(array['academic_sessions','academic_terms','classes','subjects','class_subjects','class_teacher_assignments','teacher_class_subject_assignments']) and not c.relrowsecurity), 0, 'RLS protects all academic structure tables');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select throws_ok($$insert into public.classes(school_id,name,code) values('bbbbbbbb-0000-0000-0000-000000000001','Forbidden','FORBIDDEN')$$, '42501', null, 'teacher cannot create a class in another school');

reset role;
insert into public.academic_sessions(id,school_id,name,starts_on,ends_on) values('a0000000-0000-4000-8000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','2026/2027','2026-09-01','2027-07-31');
select throws_ok($$insert into public.academic_terms(school_id,session_id,name,position,starts_on,ends_on) values('aaaaaaaa-0000-0000-0000-000000000001','a0000000-0000-4000-8000-000000000001','Invalid term',1,'2026-08-01','2026-12-15')$$, '23514', 'term dates must fall within the academic session', 'term dates remain within their session');
select throws_ok($$update public.academic_sessions set school_id='bbbbbbbb-0000-0000-0000-000000000001' where id='a0000000-0000-4000-8000-000000000001'$$, '23514', 'school_id is immutable', 'academic session tenancy cannot change');

select * from finish();
rollback;
