create type public.job_status as enum ('queued','running','retrying','succeeded','failed','dead_lettered');

create table public.background_jobs(
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  operation text not null check(operation ~ '^[a-z][a-z0-9.-]{2,79}$'),
  idempotency_key text not null check(char_length(idempotency_key) between 16 and 128),
  status public.job_status not null default 'queued',
  attempt_count integer not null default 0 check(attempt_count between 0 and 20),
  resource_type text,
  resource_id text,
  payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(school_id,operation,idempotency_key), unique(school_id,id),
  check((status in ('succeeded','dead_lettered') and completed_at is not null) or status not in ('succeeded','dead_lettered'))
);
create table public.background_job_attempts(
  id bigint generated always as identity primary key,
  school_id uuid not null,
  job_id uuid not null,
  attempt integer not null check(attempt between 1 and 20),
  status text not null check(status in ('running','succeeded','retrying','failed','dead_lettered')),
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(job_id,attempt),
  foreign key(school_id,job_id) references public.background_jobs(school_id,id) on delete cascade
);
create index background_jobs_school_time_idx on public.background_jobs(school_id,created_at desc);
create index background_jobs_failures_idx on public.background_jobs(updated_at desc) where status in('failed','dead_lettered');
create index background_job_attempts_job_idx on public.background_job_attempts(job_id,attempt desc);
create trigger background_jobs_updated before update on public.background_jobs for each row execute function public.set_updated_at();
create trigger background_jobs_school_immutable before update on public.background_jobs for each row execute function public.prevent_school_id_change();
create trigger background_job_attempts_school_immutable before update on public.background_job_attempts for each row execute function public.prevent_school_id_change();
alter table public.background_jobs enable row level security;
alter table public.background_job_attempts enable row level security;
create policy background_jobs_read on public.background_jobs for select to authenticated using(public.can_manage_school(school_id) or actor_id=auth.uid() or public.is_platform_moderator());
create policy background_job_attempts_read on public.background_job_attempts for select to authenticated using(public.can_manage_school(school_id) or public.is_platform_moderator());
grant select on public.background_jobs,public.background_job_attempts to authenticated;
grant select,insert,update,delete on public.background_jobs,public.background_job_attempts to service_role;
grant usage,select on sequence public.background_job_attempts_id_seq to service_role;
