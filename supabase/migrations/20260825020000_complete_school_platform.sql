create type public.admission_status as enum ('draft','submitted','under_review','accepted','rejected','converted');
create type public.exam_status as enum ('draft','scheduled','active','closed','graded','released');
create type public.attempt_status as enum ('in_progress','submitted','graded','cancelled');

create table public.admission_applications (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  application_number text not null, applicant_name text not null check(char_length(trim(applicant_name)) between 2 and 200),
  email text, phone text, desired_class_id uuid, status public.admission_status not null default 'draft',
  form_data jsonb not null default '{}'::jsonb, submitted_at timestamptz, reviewed_by uuid references auth.users(id),
  converted_student_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(school_id,application_number), unique(school_id,id),
  foreign key(school_id,desired_class_id) references public.classes(school_id,id),
  foreign key(school_id,converted_student_id) references public.students(school_id,id)
);
create table public.guardian_invitations (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null, email text not null, relationship text not null, status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
  token_hash text not null unique, invited_by uuid not null references auth.users(id), expires_at timestamptz not null,
  accepted_at timestamptz, created_at timestamptz not null default now(), unique(school_id,id),
  foreign key(school_id,student_id) references public.students(school_id,id)
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  subject text not null check(char_length(trim(subject)) between 1 and 200), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id)
);
create table public.conversation_participants (
  school_id uuid not null references public.schools(id) on delete cascade, conversation_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz, created_at timestamptz not null default now(), primary key(conversation_id,user_id),
  foreign key(school_id,conversation_id) references public.conversations(school_id,id) on delete cascade
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  conversation_id uuid not null, sender_id uuid not null references auth.users(id), body text not null check(char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(), unique(school_id,id),
  foreign key(school_id,conversation_id) references public.conversations(school_id,id) on delete cascade
);
create table public.exams (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  term_id uuid not null, class_id uuid not null, subject_id uuid not null, title text not null,
  status public.exam_status not null default 'draft', starts_at timestamptz, ends_at timestamptz, duration_minutes integer not null check(duration_minutes between 1 and 600),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id),
  foreign key(school_id,term_id) references public.academic_terms(school_id,id), foreign key(school_id,class_id) references public.classes(school_id,id), foreign key(school_id,subject_id) references public.subjects(school_id,id),
  check(ends_at is null or starts_at is null or ends_at > starts_at)
);
create table public.exam_questions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, exam_id uuid not null,
  position integer not null check(position >= 0), kind text not null check(kind in ('objective','text')), prompt text not null,
  options jsonb, correct_answer jsonb, marks numeric(7,2) not null check(marks > 0), created_at timestamptz not null default now(), unique(exam_id,position), unique(school_id,id),
  foreign key(school_id,exam_id) references public.exams(school_id,id) on delete cascade
);
create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, exam_id uuid not null, student_id uuid not null,
  status public.attempt_status not null default 'in_progress', started_at timestamptz not null default now(), submitted_at timestamptz,
  score numeric(8,2), last_saved_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(exam_id,student_id), unique(school_id,id), foreign key(school_id,exam_id) references public.exams(school_id,id), foreign key(school_id,student_id) references public.students(school_id,id)
);
create table public.exam_answers (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, attempt_id uuid not null, question_id uuid not null,
  answer jsonb not null, awarded_marks numeric(7,2), graded_by uuid references auth.users(id), updated_at timestamptz not null default now(),
  unique(attempt_id,question_id), foreign key(school_id,attempt_id) references public.exam_attempts(school_id,id), foreign key(school_id,question_id) references public.exam_questions(school_id,id)
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null, subject_id uuid not null, title text not null, summary text, content jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check(status in ('draft','published','archived')), published_at timestamptz, created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id), foreign key(school_id,class_id) references public.classes(school_id,id), foreign key(school_id,subject_id) references public.subjects(school_id,id)
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null, subject_id uuid not null, lesson_id uuid, title text not null, instructions text not null, due_at timestamptz, maximum_score numeric(7,2) not null check(maximum_score > 0),
  status text not null default 'draft' check(status in ('draft','published','closed')), created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id), foreign key(school_id,class_id) references public.classes(school_id,id), foreign key(school_id,subject_id) references public.subjects(school_id,id), foreign key(school_id,lesson_id) references public.lessons(school_id,id)
);
create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, assignment_id uuid not null, student_id uuid not null,
  response jsonb not null default '{}'::jsonb, status text not null default 'draft' check(status in ('draft','submitted','graded','returned')), submitted_at timestamptz,
  score numeric(7,2), feedback text, graded_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(assignment_id,student_id), unique(school_id,id), foreign key(school_id,assignment_id) references public.assignments(school_id,id), foreign key(school_id,student_id) references public.students(school_id,id)
);
create table public.library_books (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  accession_number text not null, isbn text, title text not null, author text not null, total_copies integer not null default 1 check(total_copies >= 0), available_copies integer not null default 1 check(available_copies between 0 and total_copies),
  status text not null default 'active' check(status in ('active','archived')), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,accession_number), unique(school_id,id)
);
create table public.library_loans (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, book_id uuid not null, borrower_user_id uuid not null references auth.users(id),
  borrowed_at timestamptz not null default now(), due_at timestamptz not null, returned_at timestamptz, status text not null default 'borrowed' check(status in ('borrowed','returned','lost')),
  issued_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(school_id,id), foreign key(school_id,book_id) references public.library_books(school_id,id), check(due_at > borrowed_at)
);

do $$ declare table_name text; begin foreach table_name in array array['admission_applications','guardian_invitations','conversations','conversation_participants','messages','exams','exam_questions','exam_attempts','exam_answers','lessons','assignments','assignment_submissions','library_books','library_loans'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('create policy %I on public.%I for select to authenticated using (public.is_school_member(school_id) or public.is_platform_moderator())',table_name||'_read',table_name);
end loop; end $$;

create policy admissions_manage on public.admission_applications for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy guardian_invitations_manage on public.guardian_invitations for all to authenticated using(public.can_manage_school(school_id)) with check(public.can_manage_school(school_id));
create policy conversations_create on public.conversations for insert to authenticated with check(public.is_school_member(school_id) and created_by=auth.uid());
create policy participants_manage on public.conversation_participants for all to authenticated using(public.is_school_member(school_id)) with check(public.is_school_member(school_id));
create policy messages_create on public.messages for insert to authenticated with check(public.is_school_member(school_id) and sender_id=auth.uid());
create policy exams_manage on public.exams for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]));
create policy exam_questions_manage on public.exam_questions for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]));
create policy exam_attempts_manage on public.exam_attempts for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]) or exists(select 1 from public.students where students.school_id=exam_attempts.school_id and students.id=exam_attempts.student_id and students.user_id=auth.uid())) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]) or exists(select 1 from public.students where students.school_id=exam_attempts.school_id and students.id=exam_attempts.student_id and students.user_id=auth.uid()));
create policy exam_answers_manage on public.exam_answers for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]) or exists(select 1 from public.exam_attempts join public.students on students.school_id=exam_attempts.school_id and students.id=exam_attempts.student_id where exam_attempts.school_id=exam_answers.school_id and exam_attempts.id=exam_answers.attempt_id and students.user_id=auth.uid())) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher','exam_officer']::public.school_role[]) or exists(select 1 from public.exam_attempts join public.students on students.school_id=exam_attempts.school_id and students.id=exam_attempts.student_id where exam_attempts.school_id=exam_answers.school_id and exam_attempts.id=exam_answers.attempt_id and students.user_id=auth.uid()));
create policy lessons_manage on public.lessons for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[]));
create policy assignments_manage on public.assignments for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[]));
create policy assignment_submissions_manage on public.assignment_submissions for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[]) or exists(select 1 from public.students where students.school_id=assignment_submissions.school_id and students.id=assignment_submissions.student_id and students.user_id=auth.uid())) with check(public.has_school_role(school_id,array['super_admin','school_admin','teacher']::public.school_role[]) or exists(select 1 from public.students where students.school_id=assignment_submissions.school_id and students.id=assignment_submissions.student_id and students.user_id=auth.uid()));
create policy library_books_manage on public.library_books for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','librarian']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','librarian']::public.school_role[]));
create policy library_loans_manage on public.library_loans for all to authenticated using(public.has_school_role(school_id,array['super_admin','school_admin','librarian']::public.school_role[])) with check(public.has_school_role(school_id,array['super_admin','school_admin','librarian']::public.school_role[]));

do $$ declare table_name text; begin foreach table_name in array array['admission_applications','conversations','exams','exam_attempts','lessons','assignments','assignment_submissions','library_books','library_loans'] loop
 execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',table_name||'_updated_at',table_name);
 execute format('create trigger %I before update on public.%I for each row execute function public.prevent_school_id_change()',table_name||'_school_immutable',table_name);
end loop; end $$;
create index admissions_school_status_idx on public.admission_applications(school_id,status,created_at desc);
create index messages_conversation_idx on public.messages(school_id,conversation_id,created_at);
create index exams_school_schedule_idx on public.exams(school_id,status,starts_at);
create index assignments_class_due_idx on public.assignments(school_id,class_id,due_at);
create index library_loans_due_idx on public.library_loans(school_id,status,due_at);

insert into public.platform_features(feature_key,available) values
('portal.admissions',true),('portal.parents',true),('portal.messages',true),('portal.exams',true),('portal.assignments',true),('portal.lessons',true),('portal.library',true)
on conflict(feature_key) do update set available=excluded.available;

grant select,insert,update,delete on public.admission_applications,public.guardian_invitations,public.conversations,public.conversation_participants,public.messages,public.exams,public.exam_questions,public.exam_attempts,public.exam_answers,public.lessons,public.assignments,public.assignment_submissions,public.library_books,public.library_loans to authenticated,service_role;
