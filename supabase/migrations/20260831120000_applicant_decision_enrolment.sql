-- Auditable admission offers and atomic applicant-to-student conversion.
create type public.admission_offer_status as enum ('issued','accepted','declined','expired','withdrawn');

create table public.admission_offers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null,
  offer_number text not null,
  offered_class_id uuid,
  conditions jsonb not null default '[]'::jsonb check(jsonb_typeof(conditions)='array'),
  status public.admission_offer_status not null default 'issued',
  issued_by uuid references public.accounts(id) on delete set null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  responded_by uuid references public.accounts(id) on delete set null,
  responded_at timestamptz,
  response_note text check(response_note is null or char_length(response_note)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,id),
  unique(school_id,offer_number),
  foreign key(school_id,application_id) references public.admission_applications(school_id,id),
  foreign key(school_id,offered_class_id) references public.classes(school_id,id),
  check(expires_at is null or expires_at>issued_at)
);
create unique index admission_offers_current_idx on public.admission_offers(application_id)
  where status='issued';
create index admission_offers_application_idx on public.admission_offers(school_id,application_id,issued_at desc);
create trigger admission_offers_updated_at before update on public.admission_offers
  for each row execute function public.set_updated_at();

alter table public.admission_offers enable row level security;
create policy admission_offers_staff_read on public.admission_offers for select to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'admissions.read'));
create policy admission_offers_staff_manage on public.admission_offers for all to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'admissions.manage'))
  with check(public.account_has_permission(auth.uid(),school_id,'admissions.manage'));
create policy admission_offers_applicant_read on public.admission_offers for select to authenticated
  using(public.is_application_account(school_id,application_id));
grant select,insert,update,delete on public.admission_offers to authenticated,service_role;

create or replace function public.issue_admission_offer(
  _school_id uuid, _application_id uuid, _offer_number text, _class_id uuid,
  _conditions jsonb, _expires_at timestamptz, _actor_id uuid
) returns public.admission_offers
language plpgsql security definer set search_path='' as $$
declare _application public.admission_applications; _offer public.admission_offers;
begin
  select * into _application from public.admission_applications
  where school_id=_school_id and id=_application_id for update;
  if not found then raise exception 'Application not found.' using errcode='P0002'; end if;
  if _application.status not in ('accepted','waitlisted') then
    raise exception 'Only an accepted or waitlisted application can receive an offer.' using errcode='23514';
  end if;
  if _class_id is not null and not exists(select 1 from public.classes where school_id=_school_id and id=_class_id) then
    raise exception 'Offered class is outside the school.' using errcode='23503';
  end if;
  insert into public.admission_offers(school_id,application_id,offer_number,offered_class_id,conditions,expires_at,issued_by)
  values(_school_id,_application_id,trim(_offer_number),coalesce(_class_id,_application.desired_class_id),coalesce(_conditions,'[]'),_expires_at,_actor_id)
  returning * into _offer;
  update public.admission_applications set status='offer_issued',decision_at=coalesce(decision_at,now()),
    last_status_changed_at=now(),reviewed_by=_actor_id where id=_application_id and school_id=_school_id;
  update public.admission_status_events set actor_account_id=_actor_id
    where id=(select id from public.admission_status_events where application_id=_application_id order by occurred_at desc,id desc limit 1)
      and actor_account_id is null;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'admission.offer.issued','admission_offer',_offer.id::text,
    jsonb_build_object('applicationId',_application_id,'offerNumber',_offer.offer_number));
  return _offer;
end $$;

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
    update public.admission_offers set status='expired' where id=_offer.id;
    raise exception 'The admission offer has expired.' using errcode='23514';
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
  values(_school_id,_actor_id,'admission.offer.'||_status::text,'admission_offer',_offer.id::text,
    jsonb_build_object('applicationId',_application_id));
  return _offer;
end $$;

create or replace function public.convert_admission_to_student(
  _school_id uuid, _application_id uuid, _admission_number text, _class_id uuid,
  _session_id uuid, _actor_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  _application public.admission_applications; _student public.students; _membership_id uuid; _role_id uuid;
  _target_class uuid; _name_parts text[];
begin
  select * into _application from public.admission_applications
  where school_id=_school_id and id=_application_id for update;
  if not found then raise exception 'Application not found.' using errcode='P0002'; end if;
  if _application.converted_student_id is not null then
    select * into _student from public.students where school_id=_school_id and id=_application.converted_student_id;
    return jsonb_build_object('applicationId',_application.id,'studentId',_student.id,'admissionNumber',_student.admission_number,'alreadyConverted',true);
  end if;
  if _application.status<>'offer_accepted' then
    raise exception 'Only an applicant who accepted an active offer can be enrolled.' using errcode='23514';
  end if;
  if not exists(select 1 from public.admission_offers where school_id=_school_id and application_id=_application_id and status='accepted') then
    raise exception 'An accepted admission offer is required.' using errcode='23514';
  end if;
  _target_class:=coalesce(_class_id,(select offered_class_id from public.admission_offers where school_id=_school_id and application_id=_application_id and status='accepted' order by responded_at desc limit 1),_application.desired_class_id);
  if _target_class is null then raise exception 'A class is required for enrolment.' using errcode='23502'; end if;
  if not exists(select 1 from public.classes where school_id=_school_id and id=_target_class) then raise exception 'Class is outside the school.' using errcode='23503'; end if;
  if not exists(select 1 from public.academic_sessions where school_id=_school_id and id=_session_id) then raise exception 'Academic session is outside the school.' using errcode='23503'; end if;

  _name_parts:=regexp_split_to_array(trim(_application.applicant_name),'\s+');
  insert into public.students(school_id,user_id,admission_number,full_name,first_name,last_name,class_id)
  values(_school_id,_application.applicant_account_id,trim(_admission_number),_application.applicant_name,_name_parts[1],
    case when array_length(_name_parts,1)>1 then array_to_string(_name_parts[2:array_length(_name_parts,1)],' ') else 'Student' end,_target_class)
  returning * into _student;
  insert into public.student_enrollments(school_id,student_id,class_id,session_id)
  values(_school_id,_student.id,_target_class,_session_id) on conflict(student_id,session_id) do nothing;

  if _application.applicant_account_id is not null then
    insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,external_reference,display_name,joined_at,created_by)
    values(_school_id,_application.applicant_account_id,'student','active','enrolled',_student.admission_number,_student.full_name,now(),_actor_id)
    on conflict(school_id,account_id,kind) do update set status='active',lifecycle_state='enrolled',external_reference=excluded.external_reference,
      display_name=excluded.display_name,ended_at=null,updated_at=now() returning id into _membership_id;
    select id into _role_id from public.authorization_roles where school_id is null and code='student';
    insert into public.membership_role_assignments(school_id,membership_id,role_id,assigned_by)
    values(_school_id,_membership_id,_role_id,_actor_id) on conflict(membership_id,role_id) do nothing;
    insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
    values(_school_id,_membership_id,'student',_student.id) on conflict(school_id,membership_id,entity_type,entity_id) do nothing;
    update public.tenant_memberships set lifecycle_state='converted',updated_at=now()
      where school_id=_school_id and account_id=_application.applicant_account_id and kind='applicant';
    insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,from_state,to_state,reason,actor_account_id,metadata)
    values(_school_id,_membership_id,'converted',null,'enrolled','Applicant converted after accepted offer.',_actor_id,
      jsonb_build_object('applicationId',_application_id,'studentId',_student.id));
  end if;

  insert into public.guardians(school_id,user_id,display_name)
  select g.school_id,g.account_id,g.full_name from public.applicant_guardians g
  where g.school_id=_school_id and g.application_id=_application_id and g.account_id is not null
  on conflict(school_id,user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into public.guardian_student_links(school_id,guardian_id,student_id,relationship)
  select g.school_id,guardian.id,_student.id,g.relationship from public.applicant_guardians g
  join public.guardians guardian on guardian.school_id=g.school_id and guardian.user_id=g.account_id
  where g.school_id=_school_id and g.application_id=_application_id and g.account_id is not null
  on conflict(guardian_id,student_id) do update set relationship=excluded.relationship;

  update public.admission_applications set status='converted',converted_student_id=_student.id,reviewed_by=_actor_id,last_status_changed_at=now()
  where school_id=_school_id and id=_application_id;
  update public.admission_status_events set actor_account_id=_actor_id
    where id=(select id from public.admission_status_events where application_id=_application_id order by occurred_at desc,id desc limit 1)
      and actor_account_id is null;
  insert into public.audit_events(school_id,actor_id,action,entity_type,entity_id,metadata)
  values(_school_id,_actor_id,'admission.converted','admission_application',_application_id::text,
    jsonb_build_object('studentId',_student.id,'sessionId',_session_id,'classId',_target_class));
  return jsonb_build_object('applicationId',_application.id,'studentId',_student.id,'admissionNumber',_student.admission_number,'alreadyConverted',false);
end $$;

revoke execute on function public.issue_admission_offer(uuid,uuid,text,uuid,jsonb,timestamptz,uuid) from public,anon,authenticated;
revoke execute on function public.respond_to_admission_offer(uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.convert_admission_to_student(uuid,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.issue_admission_offer(uuid,uuid,text,uuid,jsonb,timestamptz,uuid) to service_role;
grant execute on function public.respond_to_admission_offer(uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.convert_admission_to_student(uuid,uuid,text,uuid,uuid,uuid) to service_role;
