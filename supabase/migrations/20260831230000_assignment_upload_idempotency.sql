alter table public.assignment_attachments
  add column if not exists client_request_id uuid;

create unique index if not exists assignment_attachments_idempotency_idx
  on public.assignment_attachments(school_id, owner_id, client_request_id)
  where client_request_id is not null;
