alter table public.background_jobs add column trace_id text;

update public.background_jobs
set trace_id = 'req_legacy_' || replace(id::text, '-', '')
where trace_id is null;

alter table public.background_jobs
  alter column trace_id set not null,
  add constraint background_jobs_trace_id_valid
    check(trace_id ~ '^req_[a-zA-Z0-9_-]{6,128}$');

create index background_jobs_trace_id_idx on public.background_jobs(trace_id);
