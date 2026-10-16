-- Shared finance: payer initiation, offline verification, receipts and immutable audit.
create type public.manual_transfer_status as enum ('submitted','verified','rejected');

alter table public.payment_transactions
  add column if not exists initiated_by_membership_id uuid references public.tenant_memberships(id) on delete set null,
  add column if not exists initiation_scope text not null default 'staff'
    check (initiation_scope in ('applicant','parent','student','staff'));

create table public.manual_transfer_submissions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  invoice_id uuid not null,
  student_id uuid not null,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'NGN' check (currency = upper(currency)),
  bank_name text not null check (char_length(trim(bank_name)) between 2 and 120),
  account_name text not null check (char_length(trim(account_name)) between 2 and 160),
  transfer_reference text not null check (char_length(trim(transfer_reference)) between 3 and 160),
  transferred_at timestamptz not null,
  evidence_path text,
  status public.manual_transfer_status not null default 'submitted',
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, transfer_reference),
  unique (school_id, id),
  foreign key (school_id, invoice_id, student_id)
    references public.fee_invoices(school_id, id, student_id) on delete restrict,
  check ((status = 'submitted' and reviewed_by is null and reviewed_at is null) or
         (status <> 'submitted' and reviewed_by is not null and reviewed_at is not null))
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  payment_id uuid not null references public.fee_payments(id) on delete restrict,
  invoice_id uuid not null references public.fee_invoices(id) on delete restrict,
  receipt_number text not null,
  issued_to text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  issued_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (school_id, receipt_number),
  unique (payment_id)
);

create table public.finance_audit_events (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 3 and 120),
  entity_type text not null check (char_length(entity_type) between 2 and 80),
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index manual_transfers_review_idx on public.manual_transfer_submissions(school_id,status,created_at);
create index payment_receipts_invoice_idx on public.payment_receipts(school_id,invoice_id,issued_at desc);
create index finance_audit_entity_idx on public.finance_audit_events(school_id,entity_type,entity_id,occurred_at desc);
create trigger manual_transfer_updated before update on public.manual_transfer_submissions for each row execute function public.set_updated_at();
create trigger manual_transfer_school_immutable before update on public.manual_transfer_submissions for each row execute function public.prevent_school_id_change();

create or replace function public.can_initiate_student_invoice(_school_id uuid, _student_id uuid, _user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.students s where s.school_id=_school_id and s.id=_student_id and s.user_id=_user_id)
    or public.is_linked_guardian(_school_id,_student_id)
    or public.is_school_staff(_school_id,_user_id);
$$;

alter table public.manual_transfer_submissions enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.finance_audit_events enable row level security;
create policy manual_transfer_read on public.manual_transfer_submissions for select to authenticated
  using (public.can_initiate_student_invoice(school_id,student_id) or public.is_school_staff(school_id));
create policy manual_transfer_submit on public.manual_transfer_submissions for insert to authenticated
  with check (submitted_by=auth.uid() and public.can_initiate_student_invoice(school_id,student_id));
create policy manual_transfer_verify on public.manual_transfer_submissions for update to authenticated
  using (public.account_has_permission(auth.uid(),school_id,'payments.verify'))
  with check (public.account_has_permission(auth.uid(),school_id,'payments.verify'));
create policy receipts_read on public.payment_receipts for select to authenticated using (
  public.is_school_staff(school_id) or exists (
    select 1 from public.fee_invoices i where i.id=invoice_id and i.school_id=school_id
      and public.can_initiate_student_invoice(i.school_id,i.student_id)
  )
);
create policy finance_audit_staff_read on public.finance_audit_events for select to authenticated
  using (public.account_has_permission(auth.uid(),school_id,'audit.read') or public.account_has_permission(auth.uid(),school_id,'payments.verify'));

grant select,insert on public.manual_transfer_submissions to authenticated;
grant update(status,review_note,reviewed_by,reviewed_at) on public.manual_transfer_submissions to authenticated;
grant select on public.payment_receipts,public.finance_audit_events to authenticated;
grant execute on function public.can_initiate_student_invoice(uuid,uuid,uuid) to authenticated;
