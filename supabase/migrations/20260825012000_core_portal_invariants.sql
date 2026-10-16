alter table public.fee_invoices add constraint fee_invoices_school_id_id_student_unique
unique (school_id, id, student_id);
alter table public.fee_payments drop constraint fee_payments_school_invoice_fk;
alter table public.fee_payments add constraint fee_payments_invoice_student_fk
foreign key (school_id, invoice_id, student_id)
references public.fee_invoices(school_id, id, student_id) on delete restrict;

create or replace function public.validate_attendance_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.students
    where id=new.student_id and school_id=new.school_id and class_id=new.class_id
  ) then raise exception 'student is not assigned to the attendance class' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger attendance_records_validate_scope before insert or update on public.attendance_records
for each row execute function public.validate_attendance_scope();

create or replace function public.validate_result_score()
returns trigger language plpgsql set search_path = '' as $$
declare maximum numeric(7,2); assessment_class uuid;
begin
  select maximum_score,class_id into maximum,assessment_class from public.assessment_definitions
  where id=new.assessment_id and school_id=new.school_id;
  if maximum is null or new.score > maximum then
    raise exception 'score exceeds assessment maximum' using errcode='23514';
  end if;
  if not exists (
    select 1 from public.students where id=new.student_id and school_id=new.school_id and class_id=assessment_class
  ) then raise exception 'student is not assigned to the assessment class' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.validate_invoice_scope()
returns trigger language plpgsql set search_path = '' as $$
declare target_class uuid;
begin
  select class_id into target_class from public.fee_definitions
  where id=new.fee_definition_id and school_id=new.school_id;
  if target_class is not null and not exists (
    select 1 from public.students where id=new.student_id and school_id=new.school_id and class_id=target_class
  ) then raise exception 'student is not assigned to the fee class' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger fee_invoices_validate_scope before insert or update on public.fee_invoices
for each row execute function public.validate_invoice_scope();

revoke all on function public.validate_attendance_scope() from public;
revoke all on function public.validate_result_score() from public;
revoke all on function public.validate_invoice_scope() from public;
