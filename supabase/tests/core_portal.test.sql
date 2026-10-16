begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into public.academic_sessions(id,school_id,name,starts_on,ends_on,status) values
('31000000-0000-4000-8000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','2026/27','2026-09-01','2027-07-31','active'),
('32000000-0000-4000-8000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','2026/27','2026-09-01','2027-07-31','active');
insert into public.academic_terms(id,school_id,session_id,name,position,starts_on,ends_on,status) values
('31000000-0000-4000-8000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000001','First',1,'2026-09-01','2026-12-15','active');
insert into public.classes(id,school_id,name,code) values
('31000000-0000-4000-8000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Primary One','P1'),
('32000000-0000-4000-8000-000000000003','bbbbbbbb-0000-0000-0000-000000000001','JSS One','J1');
insert into public.subjects(id,school_id,name,code) values
('31000000-0000-4000-8000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Mathematics','MATH');

insert into public.staff_profiles(school_id,user_id,employee_number,full_name,email) values
('aaaaaaaa-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','EMP-1','School A Teacher','teacher-a@local.soliventa.test');
insert into public.attendance_records(school_id,student_id,class_id,term_id,attendance_date,status,recorded_by) values
('aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000002','2026-09-02','present','10000000-0000-0000-0000-000000000002');
insert into public.assessment_definitions(id,school_id,term_id,class_id,subject_id,name,maximum_score,weight_percent,created_by) values
('31000000-0000-4000-8000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000004','CA 1',20,20,'10000000-0000-0000-0000-000000000002');
insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by) values
('aaaaaaaa-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000005','a1000000-0000-0000-0000-000000000001',18,'10000000-0000-0000-0000-000000000002');
insert into public.fee_definitions(id,school_id,session_id,name,amount_minor) values
('31000000-0000-4000-8000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000001','Tuition',1000000);
insert into public.fee_invoices(id,school_id,student_id,fee_definition_id,amount_minor,created_by) values
('31000000-0000-4000-8000-000000000007','aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000006',1000000,'10000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.staff_profiles),1,'School A admin sees its staff');
select is((select count(*)::integer from public.attendance_records),1,'School A admin sees attendance');
select is((select count(*)::integer from public.result_scores),1,'School A admin sees scores');
select is((select count(*)::integer from public.fee_invoices),1,'School A admin sees invoices');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from public.staff_profiles),0,'School B admin cannot see School A staff');
select is((select count(*)::integer from public.attendance_records),0,'School B admin cannot see School A attendance');
select is((select count(*)::integer from public.result_scores),0,'School B admin cannot see School A scores');
select is((select count(*)::integer from public.fee_invoices),0,'School B admin cannot see School A invoices');

reset role;
select throws_ok($$insert into public.attendance_records(school_id,student_id,class_id,term_id,attendance_date,status,recorded_by) values('aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','32000000-0000-4000-8000-000000000003','31000000-0000-4000-8000-000000000002','2026-09-03','present','10000000-0000-0000-0000-000000000002')$$,'23503',null,'cross-school attendance class rejected');
select throws_ok($$update public.staff_profiles set school_id='bbbbbbbb-0000-0000-0000-000000000001'$$,'23514','school_id is immutable','staff school is immutable');
select throws_ok($$insert into public.result_scores(school_id,assessment_id,student_id,score,recorded_by) values('aaaaaaaa-0000-0000-0000-000000000001','31000000-0000-4000-8000-000000000005','a1000000-0000-0000-0000-000000000002',21,'10000000-0000-0000-0000-000000000002')$$,'23514','score exceeds assessment maximum','score maximum enforced');
select throws_ok($$insert into public.fee_invoices(school_id,student_id,fee_definition_id,amount_minor,discount_minor,created_by) values('aaaaaaaa-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','31000000-0000-4000-8000-000000000006',1000,1001,'10000000-0000-0000-0000-000000000001')$$,'23514',null,'invoice discount cannot exceed amount');

select * from finish();
rollback;
