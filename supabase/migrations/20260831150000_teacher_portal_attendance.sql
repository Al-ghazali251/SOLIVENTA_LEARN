-- Teacher class scope and auditable attendance capture/correction.
insert into public.authorization_permissions(code,resource,action,description,sensitive)
values('attendance.manage','attendance','manage','Correct attendance and view school-wide reports',true)
on conflict(code) do nothing;
insert into public.authorization_role_permissions(role_id,permission_id)
select r.id,p.id from public.authorization_roles r cross join public.authorization_permissions p
where r.school_id is null and r.code in ('school_admin','registrar') and p.code='attendance.manage'
on conflict do nothing;

create table public.attendance_corrections(
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 attendance_id uuid not null, previous_status public.attendance_status not null, corrected_status public.attendance_status not null,
 previous_note text, corrected_note text, reason text not null check(char_length(trim(reason)) between 3 and 500),
 corrected_by uuid not null references auth.users(id) on delete restrict, corrected_at timestamptz not null default now(),
 unique(school_id,id), foreign key(school_id,attendance_id) references public.attendance_records(school_id,id) on delete cascade
);
create index attendance_corrections_record_idx on public.attendance_corrections(school_id,attendance_id,corrected_at desc);
alter table public.attendance_corrections enable row level security;
create policy attendance_corrections_read on public.attendance_corrections for select to authenticated using(public.can_manage_school(school_id));
grant select on public.attendance_corrections to authenticated,service_role;
grant insert on public.attendance_corrections to service_role;

create or replace function public.capture_class_attendance(_school_id uuid,_class_id uuid,_term_id uuid,_date date,_entries jsonb,_actor_id uuid)
returns setof public.attendance_records language plpgsql security definer set search_path='' as $$
declare _entry jsonb; _student uuid; _is_manager boolean; _saved public.attendance_records;
begin
 _is_manager:=public.can_manage_school(_school_id,_actor_id);
 if not _is_manager and not exists(select 1 from public.class_teacher_assignments where school_id=_school_id and class_id=_class_id and teacher_user_id=_actor_id)
   and not exists(select 1 from public.teacher_class_subject_assignments where school_id=_school_id and class_id=_class_id and teacher_user_id=_actor_id)
 then raise exception 'Teacher is not assigned to this class.' using errcode='42501'; end if;
 if not exists(select 1 from public.academic_terms where school_id=_school_id and id=_term_id and _date between starts_on and ends_on)
 then raise exception 'Attendance date is outside the selected term.' using errcode='23514'; end if;
 for _entry in select * from jsonb_array_elements(_entries) loop
   _student:=(_entry->>'studentId')::uuid;
   if not exists(select 1 from public.students where school_id=_school_id and id=_student and class_id=_class_id and status='active')
   then raise exception 'Student is not active in the selected class.' using errcode='23514'; end if;
   insert into public.attendance_records(school_id,student_id,class_id,term_id,attendance_date,status,note,recorded_by)
   values(_school_id,_student,_class_id,_term_id,_date,(_entry->>'status')::public.attendance_status,nullif(trim(_entry->>'note'),''),_actor_id)
   on conflict(student_id,attendance_date) do update set status=excluded.status,note=excluded.note,term_id=excluded.term_id,class_id=excluded.class_id,recorded_by=excluded.recorded_by
   returning * into _saved;
   return next _saved;
 end loop;
 insert into public.audit_events(school_id,actor_id,action,entity_type,metadata) values(_school_id,_actor_id,'attendance.class.captured','attendance',jsonb_build_object('classId',_class_id,'termId',_term_id,'date',_date,'count',jsonb_array_length(_entries)));
end $$;

create or replace function public.correct_attendance(_school_id uuid,_attendance_id uuid,_status public.attendance_status,_note text,_reason text,_actor_id uuid)
returns public.attendance_records language plpgsql security definer set search_path='' as $$
declare _old public.attendance_records; _row public.attendance_records;
begin
 if not public.can_manage_school(_school_id,_actor_id) then raise exception 'Administrative attendance access required.' using errcode='42501'; end if;
 if char_length(trim(_reason))<3 then raise exception 'A correction reason is required.' using errcode='23514'; end if;
 select * into _old from public.attendance_records where school_id=_school_id and id=_attendance_id for update;
 if _old.id is null then raise exception 'Attendance record not found.' using errcode='P0002'; end if;
 update public.attendance_records set status=_status,note=nullif(trim(_note),'') where id=_attendance_id returning * into _row;
 insert into public.attendance_corrections(school_id,attendance_id,previous_status,corrected_status,previous_note,corrected_note,reason,corrected_by)
 values(_school_id,_attendance_id,_old.status,_status,_old.note,_row.note,trim(_reason),_actor_id);
 insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata) values(_school_id,_actor_id,'attendance.corrected','attendance',_attendance_id,jsonb_build_object('from',_old.status,'to',_status,'reason',trim(_reason)));
 return _row;
end $$;
revoke all on function public.capture_class_attendance(uuid,uuid,uuid,date,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.correct_attendance(uuid,uuid,public.attendance_status,text,text,uuid) from public,anon,authenticated;
grant execute on function public.capture_class_attendance(uuid,uuid,uuid,date,jsonb,uuid) to service_role;
grant execute on function public.correct_attendance(uuid,uuid,public.attendance_status,text,text,uuid) to service_role;
