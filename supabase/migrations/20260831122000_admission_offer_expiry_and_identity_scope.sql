-- A person may be a student in more than one tenant; student identity is tenant-scoped.
drop index if exists public.students_user_id_idx;
create unique index if not exists students_school_user_id_idx on public.students(school_id,user_id) where user_id is not null;

create or replace function public.respond_to_admission_offer(
  _school_id uuid, _application_id uuid, _response text, _note text, _actor_id uuid
) returns public.admission_offers
language plpgsql security definer set search_path='' as $$
declare _offer public.admission_offers; _status public.admission_offer_status;
begin
  if _response not in ('accept','decline') then raise exception 'Invalid offer response.' using errcode='22023'; end if;
  select * into _offer from public.admission_offers where school_id=_school_id and application_id=_application_id
    and status='issued' order by issued_at desc limit 1 for update;
  if not found then raise exception 'There is no issued offer awaiting a response.' using errcode='P0002'; end if;
  if _offer.expires_at is not null and _offer.expires_at<=now() then
    update public.admission_offers set status='expired' where id=_offer.id returning * into _offer;
    update public.admission_applications set status='accepted',last_status_changed_at=now()
      where id=_application_id and school_id=_school_id and status='offer_issued';
    insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
    values(_school_id,_actor_id,'admission.offer.expired','admission_offer',_offer.id::text,jsonb_build_object('applicationId',_application_id));
    return _offer;
  end if;
  _status:=case when _response='accept' then 'accepted'::public.admission_offer_status else 'declined'::public.admission_offer_status end;
  update public.admission_offers set status=_status,responded_by=_actor_id,responded_at=now(),response_note=nullif(trim(_note),'')
    where id=_offer.id returning * into _offer;
  update public.admission_applications set status=case when _response='accept' then 'offer_accepted'::public.admission_status else 'offer_declined'::public.admission_status end,
    last_status_changed_at=now() where id=_application_id and school_id=_school_id and status='offer_issued';
  if not found then raise exception 'The application is not awaiting an offer response.' using errcode='23514'; end if;
  update public.admission_status_events set actor_account_id=_actor_id
    where id=(select id from public.admission_status_events where application_id=_application_id order by occurred_at desc,id desc limit 1)
      and actor_account_id is null;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'admission.offer.'||_status::text,'admission_offer',_offer.id::text,jsonb_build_object('applicationId',_application_id));
  return _offer;
end $$;
revoke execute on function public.respond_to_admission_offer(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.respond_to_admission_offer(uuid,uuid,text,text,uuid) to service_role;
