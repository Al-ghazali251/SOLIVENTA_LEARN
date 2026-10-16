-- Milestone 3: tenant-safe core portal records.

create type public.staff_status as enum ('active', 'inactive');
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');
create type public.invoice_status as enum ('unpaid', 'partial', 'paid', 'void');
create type public.result_release_status as enum ('draft', 'released');

alter table public.students
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists class_id uuid,
  add column if not exists date_of_birth date,
  add column if not exists guardian_phone text;

alter table public.students
  add constraint students_school_class_fk
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete restrict;

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_number text not null,
  full_name text not null check (char_length(trim(full_name)) between 2 and 200),
  email extensions.citext not null,
  status public.staff_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  unique (school_id, employee_number),
  unique (school_id, email)
);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  class_id uuid not null,
  session_id uuid not null,
  enrolled_at date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (student_id, session_id),
  foreign key (school_id, student_id) references public.students(school_id, id) on delete cascade,
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, session_id) references public.academic_sessions(school_id, id) on delete restrict
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  class_id uuid not null,
  term_id uuid not null,
  attendance_date date not null,
  status public.attendance_status not null,
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, attendance_date),
  unique (school_id, id),
  foreign key (school_id, student_id) references public.students(school_id, id) on delete cascade,
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete restrict,
  foreign key (school_id, term_id) references public.academic_terms(school_id, id) on delete restrict
);

create table public.assessment_definitions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null,
  class_id uuid not null,
  subject_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  maximum_score numeric(7,2) not null check (maximum_score > 0),
  weight_percent numeric(5,2) not null check (weight_percent > 0 and weight_percent <= 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (school_id, id),
  unique (term_id, class_id, subject_id, name),
  foreign key (school_id, term_id) references public.academic_terms(school_id, id) on delete cascade,
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete cascade,
  foreign key (school_id, subject_id) references public.subjects(school_id, id) on delete cascade
);

create table public.result_scores (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  assessment_id uuid not null,
  student_id uuid not null,
  score numeric(7,2) not null check (score >= 0),
  remark text check (remark is null or char_length(remark) <= 500),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  unique (school_id, id),
  foreign key (school_id, assessment_id) references public.assessment_definitions(school_id, id) on delete cascade,
  foreign key (school_id, student_id) references public.students(school_id, id) on delete cascade
);

create or replace function public.validate_result_score()
returns trigger language plpgsql set search_path = '' as $$
declare maximum numeric(7,2);
begin
  select maximum_score into maximum from public.assessment_definitions
  where id = new.assessment_id and school_id = new.school_id;
  if maximum is null or new.score > maximum then
    raise exception 'score exceeds assessment maximum' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger result_scores_validate before insert or update on public.result_scores
for each row execute function public.validate_result_score();

create table public.result_releases (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null,
  class_id uuid not null,
  status public.result_release_status not null default 'draft',
  released_by uuid references auth.users(id) on delete restrict,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, class_id),
  unique (school_id, id),
  foreign key (school_id, term_id) references public.academic_terms(school_id, id) on delete cascade,
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete cascade,
  check ((status = 'draft' and released_by is null and released_at is null) or
         (status = 'released' and released_by is not null and released_at is not null))
);

create table public.fee_definitions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  session_id uuid not null,
  term_id uuid,
  class_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN' check (currency = upper(currency)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, id),
  foreign key (school_id, session_id) references public.academic_sessions(school_id, id) on delete restrict,
  foreign key (school_id, term_id) references public.academic_terms(school_id, id) on delete restrict,
  foreign key (school_id, class_id) references public.classes(school_id, id) on delete restrict
);

create table public.fee_invoices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  fee_definition_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0 and discount_minor <= amount_minor),
  status public.invoice_status not null default 'unpaid',
  due_on date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, fee_definition_id),
  unique (school_id, id),
  foreign key (school_id, student_id) references public.students(school_id, id) on delete restrict,
  foreign key (school_id, fee_definition_id) references public.fee_definitions(school_id, id) on delete restrict
);

alter table public.fee_payments add column if not exists invoice_id uuid;
alter table public.fee_payments add constraint fee_payments_school_invoice_fk
foreign key (school_id, invoice_id) references public.fee_invoices(school_id, id) on delete restrict;

create index staff_profiles_school_status_idx on public.staff_profiles(school_id, status);
create index student_enrollments_school_class_idx on public.student_enrollments(school_id, class_id) where active;
create index attendance_school_date_class_idx on public.attendance_records(school_id, attendance_date, class_id);
create index assessments_school_term_class_idx on public.assessment_definitions(school_id, term_id, class_id);
create index result_scores_school_student_idx_v2 on public.result_scores(school_id, student_id);
create index result_releases_school_term_idx on public.result_releases(school_id, term_id, status);
create index fee_definitions_school_session_idx on public.fee_definitions(school_id, session_id);
create index fee_invoices_school_student_status_idx on public.fee_invoices(school_id, student_id, status);
create index fee_payments_school_invoice_idx on public.fee_payments(school_id, invoice_id);

create trigger staff_profiles_updated before update on public.staff_profiles for each row execute function public.set_updated_at();
create trigger attendance_records_updated before update on public.attendance_records for each row execute function public.set_updated_at();
create trigger result_scores_updated before update on public.result_scores for each row execute function public.set_updated_at();
create trigger result_releases_updated before update on public.result_releases for each row execute function public.set_updated_at();
create trigger fee_definitions_updated before update on public.fee_definitions for each row execute function public.set_updated_at();
create trigger fee_invoices_updated before update on public.fee_invoices for each row execute function public.set_updated_at();

create trigger staff_profiles_school_immutable before update on public.staff_profiles for each row execute function public.prevent_school_id_change();
create trigger student_enrollments_school_immutable before update on public.student_enrollments for each row execute function public.prevent_school_id_change();
create trigger attendance_records_school_immutable before update on public.attendance_records for each row execute function public.prevent_school_id_change();
create trigger assessment_definitions_school_immutable before update on public.assessment_definitions for each row execute function public.prevent_school_id_change();
create trigger result_scores_school_immutable before update on public.result_scores for each row execute function public.prevent_school_id_change();
create trigger result_releases_school_immutable before update on public.result_releases for each row execute function public.prevent_school_id_change();
create trigger fee_definitions_school_immutable before update on public.fee_definitions for each row execute function public.prevent_school_id_change();
create trigger fee_invoices_school_immutable before update on public.fee_invoices for each row execute function public.prevent_school_id_change();

alter table public.staff_profiles enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.attendance_records enable row level security;
alter table public.assessment_definitions enable row level security;
alter table public.result_scores enable row level security;
alter table public.result_releases enable row level security;
alter table public.fee_definitions enable row level security;
alter table public.fee_invoices enable row level security;

create or replace function public.is_school_staff(_school_id uuid, _user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_school_role(
    _school_id,
    array['super_admin','school_admin','teacher','bursar','librarian','exam_officer']::public.school_role[],
    _user_id
  );
$$;

create policy staff_read on public.staff_profiles for select to authenticated using (public.is_school_member(school_id));
create policy staff_manage on public.staff_profiles for all to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy enrollments_read on public.student_enrollments for select to authenticated using (public.is_school_member(school_id));
create policy enrollments_manage on public.student_enrollments for all to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy attendance_read on public.attendance_records for select to authenticated using (
  public.is_school_staff(school_id) or exists(select 1 from public.students s where s.id=student_id and s.user_id=auth.uid()) or public.is_linked_guardian(school_id, student_id)
);
create policy attendance_write on public.attendance_records for all to authenticated using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));
create policy assessment_definitions_read on public.assessment_definitions for select to authenticated using (public.is_school_member(school_id));
create policy assessment_definitions_write on public.assessment_definitions for all to authenticated using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));
create policy result_scores_read on public.result_scores for select to authenticated using (
  public.is_school_staff(school_id) or (
    exists(select 1 from public.students s where s.id=student_id and s.user_id=auth.uid()) or public.is_linked_guardian(school_id, student_id)
  ) and exists (
    select 1 from public.assessment_definitions a join public.result_releases r
      on r.school_id=a.school_id and r.term_id=a.term_id and r.class_id=a.class_id
    where a.id=assessment_id and r.status='released'
  )
);
create policy result_scores_write on public.result_scores for all to authenticated using (public.is_school_staff(school_id)) with check (public.is_school_staff(school_id));
create policy result_releases_read on public.result_releases for select to authenticated using (public.is_school_member(school_id));
create policy result_releases_write on public.result_releases for all to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy fee_definitions_read on public.fee_definitions for select to authenticated using (public.is_school_member(school_id));
create policy fee_definitions_manage on public.fee_definitions for all to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));
create policy fee_invoices_read on public.fee_invoices for select to authenticated using (
  public.is_school_staff(school_id) or exists(select 1 from public.students s where s.id=student_id and s.user_id=auth.uid()) or public.is_linked_guardian(school_id, student_id)
);
create policy fee_invoices_manage on public.fee_invoices for all to authenticated using (public.can_manage_school(school_id)) with check (public.can_manage_school(school_id));

grant select, insert, update, delete on public.staff_profiles, public.student_enrollments,
  public.attendance_records, public.assessment_definitions, public.result_scores,
  public.result_releases, public.fee_definitions, public.fee_invoices to authenticated;
revoke all on function public.validate_result_score() from public;
revoke all on function public.is_school_staff(uuid, uuid) from public;
grant execute on function public.is_school_staff(uuid, uuid) to authenticated;
