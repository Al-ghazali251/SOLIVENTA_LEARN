create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 40), starts_on date not null, ends_on date not null,
  status text not null default 'planned' check (status in ('planned','active','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,name), unique(school_id,id), check(starts_on < ends_on)
);
create unique index academic_sessions_one_active_idx on public.academic_sessions(school_id) where status='active';

create table public.academic_terms (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, session_id uuid not null,
  name text not null check (char_length(trim(name)) between 2 and 40), position smallint not null check(position between 1 and 6),
  starts_on date not null, ends_on date not null, status text not null default 'planned' check(status in ('planned','active','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(session_id,position), unique(school_id,id), foreign key(school_id,session_id) references public.academic_sessions(school_id,id) on delete cascade,
  check(starts_on < ends_on)
);
create unique index academic_terms_one_active_idx on public.academic_terms(school_id) where status='active';

create table public.classes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 80), code text not null check(code ~ '^[A-Z0-9_-]{1,30}$'), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name), unique(school_id,code), unique(school_id,id)
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 100), code text not null check(code ~ '^[A-Z0-9_-]{1,30}$'), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,name), unique(school_id,code), unique(school_id,id)
);
create table public.class_subjects (
  school_id uuid not null, class_id uuid not null, subject_id uuid not null, created_at timestamptz not null default now(),
  primary key(class_id,subject_id), foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  foreign key(school_id,subject_id) references public.subjects(school_id,id) on delete cascade
);
create table public.class_teacher_assignments (
  school_id uuid not null, class_id uuid not null, teacher_user_id uuid not null references auth.users(id) on delete cascade,
  teacher_role public.school_role not null default 'teacher' check (teacher_role = 'teacher'), created_at timestamptz not null default now(),
  primary key(class_id), foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  foreign key(school_id,teacher_user_id,teacher_role) references public.school_memberships(school_id,user_id,role) on delete cascade
);
create table public.teacher_class_subject_assignments (
  school_id uuid not null, teacher_user_id uuid not null references auth.users(id) on delete cascade, class_id uuid not null, subject_id uuid not null,
  teacher_role public.school_role not null default 'teacher' check (teacher_role = 'teacher'),
  created_at timestamptz not null default now(), primary key(teacher_user_id,class_id,subject_id),
  foreign key(school_id,class_id) references public.classes(school_id,id) on delete cascade,
  foreign key(school_id,subject_id) references public.subjects(school_id,id) on delete cascade,
  foreign key(class_id,subject_id) references public.class_subjects(class_id,subject_id) on delete cascade,
  foreign key(school_id,teacher_user_id,teacher_role) references public.school_memberships(school_id,user_id,role) on delete cascade
);

create index academic_terms_school_session_idx on public.academic_terms(school_id,session_id);
create index class_subjects_school_idx on public.class_subjects(school_id);
create index class_teacher_assignments_teacher_idx on public.class_teacher_assignments(school_id,teacher_user_id);
create index teacher_assignments_scope_idx on public.teacher_class_subject_assignments(school_id,teacher_user_id,class_id);

create or replace function public.validate_academic_term_dates()
returns trigger language plpgsql set search_path = '' as $$
declare session_start date; session_end date;
begin
  select starts_on, ends_on into session_start, session_end
  from public.academic_sessions where school_id = new.school_id and id = new.session_id;
  if session_start is null or new.starts_on < session_start or new.ends_on > session_end then
    raise exception 'term dates must fall within the academic session' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger academic_terms_validate_dates before insert or update on public.academic_terms
for each row execute function public.validate_academic_term_dates();

create trigger academic_sessions_updated before update on public.academic_sessions for each row execute function public.set_updated_at();
create trigger academic_terms_updated before update on public.academic_terms for each row execute function public.set_updated_at();
create trigger classes_updated before update on public.classes for each row execute function public.set_updated_at();
create trigger subjects_updated before update on public.subjects for each row execute function public.set_updated_at();
create trigger academic_sessions_school_immutable before update on public.academic_sessions for each row execute function public.prevent_school_id_change();
create trigger academic_terms_school_immutable before update on public.academic_terms for each row execute function public.prevent_school_id_change();
create trigger classes_school_immutable before update on public.classes for each row execute function public.prevent_school_id_change();
create trigger subjects_school_immutable before update on public.subjects for each row execute function public.prevent_school_id_change();

alter table public.academic_sessions enable row level security; alter table public.academic_terms enable row level security;
alter table public.classes enable row level security; alter table public.subjects enable row level security;
alter table public.class_subjects enable row level security; alter table public.class_teacher_assignments enable row level security;
alter table public.teacher_class_subject_assignments enable row level security;

create policy academic_sessions_read on public.academic_sessions for select to authenticated using(public.is_school_member(school_id));
create policy academic_terms_read on public.academic_terms for select to authenticated using(public.is_school_member(school_id));
create policy classes_read on public.classes for select to authenticated using(public.is_school_member(school_id));
create policy subjects_read on public.subjects for select to authenticated using(public.is_school_member(school_id));
create policy class_subjects_read on public.class_subjects for select to authenticated using(public.is_school_member(school_id));
create policy class_teachers_read on public.class_teacher_assignments for select to authenticated using(public.is_school_member(school_id));
create policy teacher_assignments_read on public.teacher_class_subject_assignments for select to authenticated using(public.is_school_member(school_id));
create policy academic_sessions_manage on public.academic_sessions for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy academic_terms_manage on public.academic_terms for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy classes_manage on public.classes for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy subjects_manage on public.subjects for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy class_subjects_manage on public.class_subjects for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy class_teachers_manage on public.class_teacher_assignments for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy teacher_assignments_manage on public.teacher_class_subject_assignments for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));

revoke all on function public.validate_academic_term_dates() from public;
grant select, insert, update, delete on public.academic_sessions, public.academic_terms, public.classes, public.subjects,
  public.class_subjects, public.class_teacher_assignments, public.teacher_class_subject_assignments to authenticated, service_role;
