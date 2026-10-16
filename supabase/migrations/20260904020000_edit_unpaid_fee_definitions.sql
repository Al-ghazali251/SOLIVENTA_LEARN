-- Fee definitions may be corrected until money has been recorded against them.
-- The fee and its invoices are locked together so edits cannot race payment writes.
create or replace function public.update_unpaid_fee_definition(
  _school uuid,
  _fee uuid,
  _session uuid,
  _term uuid,
  _class_ids uuid[],
  _student_audience text,
  _name text,
  _amount_minor bigint,
  _actor uuid
) returns public.fee_definitions
language plpgsql security definer set search_path = '' as $$
declare
  _updated public.fee_definitions;
begin
  if not public.account_has_permission(_actor, _school, 'fees.manage') then
    raise exception 'Fee management permission required.' using errcode = '42501';
  end if;

  perform 1
  from public.fee_definitions
  where school_id = _school and id = _fee
  for update;
  if not found then
    raise exception 'Fee definition not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.fee_invoices
  where school_id = _school and fee_definition_id = _fee
  for update;

  if exists (
    select 1
    from public.fee_payments payment
    join public.fee_invoices invoice
      on invoice.school_id = payment.school_id and invoice.id = payment.invoice_id
    where invoice.school_id = _school and invoice.fee_definition_id = _fee
  ) then
    raise exception 'This fee cannot be edited because a student payment has already been recorded.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.manual_transfer_submissions transfer
    join public.fee_invoices invoice
      on invoice.school_id = transfer.school_id and invoice.id = transfer.invoice_id
    where invoice.school_id = _school
      and invoice.fee_definition_id = _fee
      and transfer.status = 'submitted'
  ) then
    raise exception 'Review the pending bank transfer before editing this fee.'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.fee_invoices
    where school_id = _school
      and fee_definition_id = _fee
      and discount_minor > _amount_minor
  ) then
    raise exception 'The new amount cannot be lower than an existing invoice discount.'
      using errcode = '23514';
  end if;

  update public.payment_transactions transaction
  set status = 'abandoned'
  from public.fee_invoices invoice
  where invoice.school_id = _school
    and invoice.fee_definition_id = _fee
    and transaction.school_id = invoice.school_id
    and transaction.invoice_id = invoice.id
    and transaction.status = 'initialized';

  update public.fee_invoices
  set amount_minor = _amount_minor
  where school_id = _school and fee_definition_id = _fee;

  update public.fee_definitions
  set session_id = _session,
      term_id = _term,
      class_id = null,
      class_ids = coalesce(_class_ids, '{}'::uuid[]),
      student_audience = _student_audience,
      name = trim(_name),
      amount_minor = _amount_minor
  where school_id = _school and id = _fee
  returning * into _updated;

  insert into public.audit_events (school_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    _school,
    _actor,
    'fee.updated',
    'fee_definition',
    _fee,
    jsonb_build_object('name', _updated.name, 'amountMinor', _updated.amount_minor)
  );

  return _updated;
end;
$$;

revoke all on function public.update_unpaid_fee_definition(
  uuid, uuid, uuid, uuid, uuid[], text, text, bigint, uuid
) from public, anon, authenticated;
grant execute on function public.update_unpaid_fee_definition(
  uuid, uuid, uuid, uuid, uuid[], text, text, bigint, uuid
) to service_role;

notify pgrst, 'reload schema';
