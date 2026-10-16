create type public.entrance_exam_version_status as enum ('draft','published','archived');
create type public.entrance_assignment_status as enum ('assigned','available','started','submitted','reviewed','expired','cancelled');

create table public.entrance_exams (
 id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
 title text not null, description text, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id)
);
create table public.entrance_exam_versions (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, exam_id uuid not null, version integer not null,
 status public.entrance_exam_version_status not null default 'draft', instructions text, duration_minutes integer not null check(duration_minutes between 1 and 600),
 pass_mark numeric(7,2) not null default 50, randomize_questions boolean not null default false, randomize_options boolean not null default false,
 source_format text check(source_format in ('authoring','markdown','yaml')), source_document text, published_by uuid references auth.users(id), published_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(exam_id,version), unique(school_id,id), foreign key(school_id,exam_id) references public.entrance_exams(school_id,id) on delete cascade
);
create table public.entrance_questions (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, version_id uuid not null, position integer not null,
 kind text not null check(kind in ('single_choice','multiple_choice','true_false','short_text','long_text','number')),
 prompt text not null, options jsonb, correct_answer jsonb, marks numeric(7,2) not null check(marks>0), explanation text, metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), unique(version_id,position), unique(school_id,id), foreign key(school_id,version_id) references public.entrance_exam_versions(school_id,id) on delete cascade
);
create table public.entrance_exam_schedules (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, version_id uuid not null, opens_at timestamptz not null, closes_at timestamptz not null,
 timezone text not null default 'Africa/Lagos', max_attempts integer not null default 1 check(max_attempts between 1 and 10), access_code_hash text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(school_id,id), foreign key(school_id,version_id) references public.entrance_exam_versions(school_id,id), check(closes_at>opens_at)
);
create table public.entrance_exam_assignments (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, schedule_id uuid not null, application_id uuid not null,
 status public.entrance_assignment_status not null default 'assigned', assigned_by uuid not null references auth.users(id), assigned_at timestamptz not null default now(), unique(schedule_id,application_id), unique(school_id,id),
 foreign key(school_id,schedule_id) references public.entrance_exam_schedules(school_id,id) on delete cascade, foreign key(school_id,application_id) references public.admission_applications(school_id,id) on delete cascade
);
create table public.entrance_exam_accommodations (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, assignment_id uuid not null, extra_time_minutes integer not null default 0 check(extra_time_minutes between 0 and 600),
 additional_attempts integer not null default 0 check(additional_attempts between 0 and 10), read_aloud boolean not null default false, reduced_motion boolean not null default false,
 note text, approved_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(assignment_id), foreign key(school_id,assignment_id) references public.entrance_exam_assignments(school_id,id) on delete cascade
);
create table public.entrance_exam_attempts (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, assignment_id uuid not null, attempt_number integer not null,
 status text not null default 'in_progress' check(status in ('in_progress','submitted','auto_submitted','reviewed','invalidated')),
 started_at timestamptz not null default now(), expires_at timestamptz not null, last_saved_at timestamptz not null default now(), submitted_at timestamptz,
 score numeric(9,2), maximum_score numeric(9,2), reviewed_by uuid references auth.users(id), reviewed_at timestamptz, review_note text,
 unique(assignment_id,attempt_number), unique(school_id,id), foreign key(school_id,assignment_id) references public.entrance_exam_assignments(school_id,id) on delete cascade
);
create table public.entrance_exam_answers (
 id uuid primary key default gen_random_uuid(), school_id uuid not null, attempt_id uuid not null, question_id uuid not null, answer jsonb not null,
 awarded_marks numeric(7,2), marker_note text, saved_at timestamptz not null default now(), unique(attempt_id,question_id),
 foreign key(school_id,attempt_id) references public.entrance_exam_attempts(school_id,id) on delete cascade, foreign key(school_id,question_id) references public.entrance_questions(school_id,id)
);
create table public.entrance_exam_integrity_signals (
 id bigint generated always as identity primary key, school_id uuid not null, attempt_id uuid not null,
 signal_type text not null check(signal_type in ('tab_hidden','window_blur','fullscreen_exit','copy','paste','network_offline','clock_drift','multiple_session','other')),
 severity text not null default 'info' check(severity in ('info','warning','critical')), client_occurred_at timestamptz not null, metadata jsonb not null default '{}', received_at timestamptz not null default now(),
 foreign key(school_id,attempt_id) references public.entrance_exam_attempts(school_id,id) on delete cascade
);
create index entrance_assignments_application_idx on public.entrance_exam_assignments(school_id,application_id,status);
create index entrance_attempts_assignment_idx on public.entrance_exam_attempts(school_id,assignment_id,attempt_number);
create index entrance_integrity_attempt_idx on public.entrance_exam_integrity_signals(school_id,attempt_id,received_at);
do $$ declare t text; begin foreach t in array array['entrance_exams','entrance_exam_versions','entrance_questions','entrance_exam_schedules','entrance_exam_assignments','entrance_exam_accommodations','entrance_exam_attempts','entrance_exam_answers','entrance_exam_integrity_signals'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy %I_staff on public.%I for all to authenticated using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id))',t||'_staff',t); end loop; end $$;
create policy entrance_assignments_applicant_read on public.entrance_exam_assignments for select to authenticated using(public.is_application_account(school_id,application_id));
create policy entrance_attempts_applicant on public.entrance_exam_attempts for select to authenticated using(exists(select 1 from public.entrance_exam_assignments a where a.id=assignment_id and public.is_application_account(a.school_id,a.application_id)));
create policy entrance_answers_applicant on public.entrance_exam_answers for select to authenticated using(exists(select 1 from public.entrance_exam_attempts t join public.entrance_exam_assignments a on a.id=t.assignment_id where t.id=attempt_id and public.is_application_account(a.school_id,a.application_id)));
grant select,insert,update,delete on public.entrance_exams,public.entrance_exam_versions,public.entrance_questions,public.entrance_exam_schedules,public.entrance_exam_assignments,public.entrance_exam_accommodations,public.entrance_exam_attempts,public.entrance_exam_answers,public.entrance_exam_integrity_signals to authenticated,service_role;
