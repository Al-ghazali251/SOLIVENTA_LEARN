-- A fee can be removed only while no money has been recorded or is awaiting
-- confirmation. Failed/abandoned attempts and invoice-only bookkeeping are
-- removed with it; financial evidence is never deleted.
create or replace function public.delete_unpaid_fee_definition(
  _school uuid,
  _fee uuid,
  _actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _fee_row public.fee_definitions;
  _invoice_ids uuid[];
begin
  if not public.account_has_permission(_actor, _school, 'fees.manage') then
    raise exception 'Fee management permission required.' using errcode = '42501';
  end if;

  select * into _fee_row
  from public.fee_definitions
  where school_id = _school and id = _fee
  for update;
  if _fee_row.id is null then
    raise exception 'Fee definition not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.fee_invoices
  where school_id = _school and fee_definition_id = _fee
  for update;

  select coalesce(array_agg(id), '{}'::uuid[]) into _invoice_ids
  from public.fee_invoices
  where school_id = _school and fee_definition_id = _fee;

  if exists (
    select 1 from public.fee_payments
    where school_id = _school and invoice_id = any(_invoice_ids)
  ) then
    raise exception 'This fee cannot be deleted because a payment has been recorded.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.payment_transactions
    where school_id = _school and invoice_id = any(_invoice_ids)
      and status in ('initialized', 'successful')
  ) then
    raise exception 'Resolve the active online payment before deleting this fee.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.manual_transfer_submissions
    where school_id = _school and invoice_id = any(_invoice_ids)
      and status in ('submitted', 'verified')
  ) then
    raise exception 'Resolve the bank transfer before deleting this fee.'
      using errcode = '23514';
  end if;

  delete from public.payment_transactions
  where school_id = _school and invoice_id = any(_invoice_ids);
  delete from public.manual_transfer_submissions
  where school_id = _school and invoice_id = any(_invoice_ids);
  delete from public.invoice_adjustments
  where school_id = _school and invoice_id = any(_invoice_ids);
  delete from public.fee_invoices
  where school_id = _school and fee_definition_id = _fee;
  delete from public.portal_notifications
  where school_id = _school
    and resource_type = 'fee_definition'
    and resource_id = _fee::text;
  delete from public.fee_definitions
  where school_id = _school and id = _fee;

  insert into public.audit_events(school_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _school,
    _actor,
    'fee.deleted',
    'fee_definition',
    _fee,
    jsonb_build_object('name', _fee_row.name, 'amountMinor', _fee_row.amount_minor)
  );

  return jsonb_build_object('id', _fee, 'deleted', true);
end;
$$;

revoke all on function public.delete_unpaid_fee_definition(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.delete_unpaid_fee_definition(uuid, uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
