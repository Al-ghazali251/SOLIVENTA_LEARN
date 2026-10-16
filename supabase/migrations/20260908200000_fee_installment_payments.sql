-- Installment policy is configured per school and snapshotted onto invoices.
-- Confirmed payments are guarded under an invoice row lock so concurrent
-- provider callbacks and staff verification cannot exceed the balance/limit.
alter table public.school_payment_settings
  add column installments_enabled boolean not null default false,
  add column minimum_installment_percent numeric(5,2) not null default 25
    check (minimum_installment_percent > 0 and minimum_installment_percent <= 100),
  add column maximum_installments integer not null default 1
    check (maximum_installments between 1 and 24),
  add constraint school_payment_settings_installment_policy_check
    check (installments_enabled or maximum_installments = 1);

alter table public.fee_invoices
  add column installments_allowed boolean not null default false,
  add column minimum_installment_percent numeric(5,2) not null default 100
    check (minimum_installment_percent > 0 and minimum_installment_percent <= 100),
  add column maximum_installments integer not null default 1
    check (maximum_installments between 1 and 24);

alter table public.fee_payments
  add column installment_number integer check (installment_number is null or installment_number > 0),
  add column balance_after_minor bigint check (balance_after_minor is null or balance_after_minor >= 0);

create or replace function public.snapshot_invoice_installment_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare _settings public.school_payment_settings;
begin
  select * into _settings from public.school_payment_settings where school_id = new.school_id;
  new.installments_allowed := coalesce(_settings.installments_enabled, false);
  new.minimum_installment_percent := case when new.installments_allowed then _settings.minimum_installment_percent else 100 end;
  new.maximum_installments := case when new.installments_allowed then _settings.maximum_installments else 1 end;
  return new;
end $$;

create trigger fee_invoice_installment_policy
before insert on public.fee_invoices
for each row execute function public.snapshot_invoice_installment_policy();

create or replace function public.enforce_fee_payment_installment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _invoice public.fee_invoices;
  _paid bigint;
  _count integer;
  _net bigint;
  _remaining bigint;
  _minimum bigint;
begin
  if new.invoice_id is null then return new; end if;
  select * into _invoice from public.fee_invoices
  where school_id = new.school_id and id = new.invoice_id for update;
  if _invoice.id is null then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  select coalesce(sum(amount_minor), 0), count(*) into _paid, _count
  from public.fee_payments where school_id = new.school_id and invoice_id = new.invoice_id;
  _net := _invoice.amount_minor - _invoice.discount_minor;
  _remaining := _net - _paid;
  _minimum := ceil(_net * _invoice.minimum_installment_percent / 100.0);
  if _remaining <= 0 then raise exception 'The invoice has no outstanding balance.' using errcode = '23514'; end if;
  if new.amount_minor > _remaining then raise exception 'Payment exceeds the outstanding balance.' using errcode = '23514'; end if;
  if not _invoice.installments_allowed and new.amount_minor <> _remaining then
    raise exception 'This invoice must be paid in full.' using errcode = '23514';
  end if;
  if _invoice.installments_allowed and _count + 1 >= _invoice.maximum_installments and new.amount_minor <> _remaining then
    raise exception 'The final installment must clear the remaining balance.' using errcode = '23514';
  end if;
  if _invoice.installments_allowed and new.amount_minor <> _remaining and new.amount_minor < _minimum then
    raise exception 'Payment is below the minimum installment amount.' using errcode = '23514';
  end if;
  new.installment_number := _count + 1;
  new.balance_after_minor := _remaining - new.amount_minor;
  return new;
end $$;

create or replace function public.update_invoice_after_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.invoice_id is not null then
    update public.fee_invoices set status = case when new.balance_after_minor = 0 then 'paid'::public.invoice_status else 'partial'::public.invoice_status end
    where school_id = new.school_id and id = new.invoice_id;
  end if;
  return new;
end $$;

create trigger fee_payment_installment_guard
before insert on public.fee_payments
for each row execute function public.enforce_fee_payment_installment();
create trigger fee_payment_invoice_status
after insert on public.fee_payments
for each row execute function public.update_invoice_after_payment();

create or replace function public.prevent_concurrent_invoice_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.fee_invoices where id = new.invoice_id and school_id = new.school_id for update;
  if tg_table_name = 'payment_transactions' and exists (
    select 1 from public.payment_transactions where invoice_id = new.invoice_id and status = 'initialized'
  ) then raise exception 'A Paystack payment is already open for this invoice.' using errcode = '23514'; end if;
  if tg_table_name = 'payment_transactions' and exists (
    select 1 from public.manual_transfer_submissions where invoice_id = new.invoice_id and status = 'submitted'
  ) then raise exception 'A bank transfer is awaiting review for this invoice.' using errcode = '23514'; end if;
  if tg_table_name = 'manual_transfer_submissions' and exists (
    select 1 from public.manual_transfer_submissions where invoice_id = new.invoice_id and status = 'submitted'
  ) then raise exception 'A bank transfer is already awaiting review for this invoice.' using errcode = '23514'; end if;
  if tg_table_name = 'manual_transfer_submissions' and exists (
    select 1 from public.payment_transactions where invoice_id = new.invoice_id and status = 'initialized'
  ) then raise exception 'A Paystack payment is already open for this invoice.' using errcode = '23514'; end if;
  return new;
end $$;

create trigger payment_transaction_one_open
before insert on public.payment_transactions
for each row execute function public.prevent_concurrent_invoice_payment();
create trigger manual_transfer_one_open
before insert on public.manual_transfer_submissions
for each row execute function public.prevent_concurrent_invoice_payment();

revoke all on function public.snapshot_invoice_installment_policy(), public.enforce_fee_payment_installment(), public.update_invoice_after_payment(), public.prevent_concurrent_invoice_payment()
from public, anon, authenticated;
