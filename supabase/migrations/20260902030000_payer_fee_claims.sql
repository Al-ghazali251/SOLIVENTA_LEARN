create or replace function public.claim_fee_invoice(_school uuid, _student uuid, _fee uuid, _actor uuid)
returns public.fee_invoices language plpgsql security definer set search_path = '' as $$
declare _definition public.fee_definitions; _invoice public.fee_invoices;
begin
  if not public.can_initiate_student_invoice(_school,_student,_actor) then
    raise exception 'You cannot pay fees for this student.' using errcode='42501';
  end if;
  if not public.student_matches_fee_definition(_school,_student,_fee) then
    raise exception 'This fee does not apply to the selected student.' using errcode='23514';
  end if;
  select * into _definition from public.fee_definitions where school_id=_school and id=_fee and active;
  insert into public.fee_invoices(school_id,student_id,fee_definition_id,amount_minor,discount_minor,created_by)
  values(_school,_student,_fee,_definition.amount_minor,0,_actor)
  on conflict(student_id,fee_definition_id) do update set updated_at=public.fee_invoices.updated_at
  returning * into _invoice;
  return _invoice;
end $$;
revoke all on function public.claim_fee_invoice(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_fee_invoice(uuid,uuid,uuid,uuid) to service_role;
