create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  invoice_id uuid not null references public.fee_invoices(id),
  student_id uuid not null references public.students(id),
  provider text not null default 'paystack' check (provider = 'paystack'),
  provider_reference text not null unique,
  customer_email text not null,
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  currency text not null default 'NGN',
  status text not null default 'initialized' check (status in ('initialized','successful','failed','abandoned')),
  authorization_url text,
  initialized_by uuid not null references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, provider_reference),
  unique (school_id, id)
);

create index payment_transactions_school_invoice_idx on public.payment_transactions (school_id, invoice_id);
alter table public.payment_transactions enable row level security;
create policy payment_transactions_staff_read on public.payment_transactions for select to authenticated
  using (public.is_school_staff(school_id));
create trigger payment_transactions_school_immutable before update on public.payment_transactions
  for each row execute function public.prevent_school_id_change();
create trigger payment_transactions_updated_at before update on public.payment_transactions
  for each row execute function public.set_updated_at();

create or replace function public.validate_payment_transaction_scope() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.fee_invoices where id = new.invoice_id and school_id = new.school_id and student_id = new.student_id) then
    raise exception 'payment transaction invoice and student must belong to the same school';
  end if;
  return new;
end $$;
create trigger payment_transactions_scope before insert or update on public.payment_transactions
  for each row execute function public.validate_payment_transaction_scope();
