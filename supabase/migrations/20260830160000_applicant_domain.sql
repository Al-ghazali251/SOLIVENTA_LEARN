-- Applicant domain: pre-enrolment identity, relationships, documents and workflow history.
create type public.admission_status_v2 as enum (
  'draft','submitted','under_review','needs_information','waitlisted','offer_issued',
  'offer_accepted','offer_declined','accepted','rejected','converted'
);
alter table public.admission_applications alter column status drop default;
alter table public.admission_applications alter column status type public.admission_status_v2
  using status::text::public.admission_status_v2;
drop type public.admission_status;
alter type public.admission_status_v2 rename to admission_status;
alter table public.admission_applications alter column status set default 'draft';

alter table public.admission_applications
  add column if not exists applicant_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists decision_reason text,
  add column if not exists decision_at timestamptz,
  add column if not exists last_status_changed_at timestamptz not null default now();

create unique index if not exists admission_applicant_account_idx
  on public.admission_applications(school_id, applicant_account_id)
  where applicant_account_id is not null and status <> 'converted';

update public.admission_applications a set applicant_account_id=account.id
from public.accounts account
where a.applicant_account_id is null and a.email is not null
  and account.primary_email=a.email
  and not exists(select 1 from public.admission_applications other
    where other.school_id=a.school_id and other.applicant_account_id=account.id and other.status<>'converted');

create or replace function public.resolve_admission_account()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.applicant_account_id is null and new.email is not null then
    select id into new.applicant_account_id from public.accounts where primary_email=new.email limit 1;
  end if;
  return new;
end;
$$;
create trigger admission_account_resolver before insert or update of email on public.admission_applications
for each row execute function public.resolve_admission_account();

create or replace function public.provision_applicant_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare _membership_id uuid; _role_id uuid;
begin
  if new.applicant_account_id is null then return new; end if;
  insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,external_reference,display_name,joined_at)
  values(new.school_id,new.applicant_account_id,'applicant','active',new.status::text,new.application_number,new.applicant_name,now())
  on conflict(school_id,account_id,kind) do update set lifecycle_state=excluded.lifecycle_state,
    external_reference=excluded.external_reference,display_name=excluded.display_name,updated_at=now()
  returning id into _membership_id;
  select id into _role_id from public.authorization_roles where school_id is null and code='applicant';
  insert into public.membership_role_assignments(school_id,membership_id,role_id)
  values(new.school_id,_membership_id,_role_id) on conflict(membership_id,role_id) do nothing;
  insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
  values(new.school_id,_membership_id,'admission_application',new.id)
  on conflict(school_id,membership_id,entity_type,entity_id) do nothing;
  return new;
end;
$$;
create trigger admission_applicant_membership after insert or update of applicant_account_id,status on public.admission_applications
for each row execute function public.provision_applicant_membership();

create or replace function public.link_account_to_admission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.primary_email is not null then
    update public.admission_applications a set applicant_account_id=new.id,updated_at=now()
    where a.applicant_account_id is null and a.email=new.primary_email
      and not exists(select 1 from public.admission_applications linked
        where linked.school_id=a.school_id and linked.applicant_account_id=new.id and linked.status<>'converted');
  end if;
  return new;
end;
$$;
create trigger account_admission_link after insert or update of primary_email on public.accounts
for each row execute function public.link_account_to_admission();

insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,external_reference,display_name,joined_at)
select a.school_id,a.applicant_account_id,'applicant','active',a.status::text,a.application_number,a.applicant_name,coalesce(a.submitted_at,a.created_at)
from public.admission_applications a where a.applicant_account_id is not null
on conflict(school_id,account_id,kind) do update set lifecycle_state=excluded.lifecycle_state,
  external_reference=excluded.external_reference,display_name=excluded.display_name,updated_at=now();
insert into public.membership_role_assignments(school_id,membership_id,role_id)
select tm.school_id,tm.id,ar.id from public.tenant_memberships tm
cross join public.authorization_roles ar
where tm.kind='applicant' and ar.school_id is null and ar.code='applicant'
on conflict(membership_id,role_id) do nothing;
insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id)
select a.school_id,tm.id,'admission_application',a.id
from public.admission_applications a join public.tenant_memberships tm
  on tm.school_id=a.school_id and tm.account_id=a.applicant_account_id and tm.kind='applicant'
where a.applicant_account_id is not null
on conflict(school_id,membership_id,entity_type,entity_id) do nothing;

create table public.applicant_guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null,
  account_id uuid references public.accounts(id) on delete set null,
  full_name text not null check(char_length(trim(full_name)) between 2 and 160),
  relationship text not null check(char_length(trim(relationship)) between 2 and 60),
  email extensions.citext,
  phone text,
  is_primary boolean not null default false,
  can_receive_updates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,id),
  foreign key(school_id,application_id) references public.admission_applications(school_id,id) on delete cascade
);
create unique index applicant_guardian_primary_idx on public.applicant_guardians(application_id) where is_primary;
create index applicant_guardians_application_idx on public.applicant_guardians(school_id,application_id);

create type public.admission_document_status as enum ('received','under_review','accepted','replacement_requested','rejected');
create table public.admission_documents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null,
  document_type text not null check(document_type ~ '^[a-z][a-z0-9_]{1,79}$'),
  original_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer check(size_bytes is null or size_bytes between 1 and 5242880),
  status public.admission_document_status not null default 'received',
  review_note text,
  uploaded_by uuid references public.accounts(id) on delete set null,
  reviewed_by uuid references public.accounts(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id,id),
  unique(application_id,document_type),
  foreign key(school_id,application_id) references public.admission_applications(school_id,id) on delete cascade
);
create index admission_documents_application_idx on public.admission_documents(school_id,application_id);

create table public.admission_status_events (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null,
  from_status public.admission_status,
  to_status public.admission_status not null,
  public_message text,
  internal_note text,
  actor_account_id uuid references public.accounts(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key(school_id,application_id) references public.admission_applications(school_id,id) on delete cascade
);
create index admission_status_history_idx on public.admission_status_events(school_id,application_id,occurred_at desc);

create or replace function public.record_admission_status_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.admission_status_events(school_id,application_id,to_status,public_message,actor_account_id)
    values(new.school_id,new.id,new.status,'Application created',auth.uid());
  elsif old.status is distinct from new.status then
    insert into public.admission_status_events(school_id,application_id,from_status,to_status,public_message,internal_note,actor_account_id)
    values(new.school_id,new.id,old.status,new.status,
      case new.status
        when 'under_review' then 'Your application is under review.'
        when 'needs_information' then 'The admissions team needs more information.'
        when 'waitlisted' then 'Your application has been added to the waitlist.'
        when 'offer_issued' then 'An admission offer has been issued.'
        when 'offer_accepted' then 'Your admission offer was accepted.'
        when 'offer_declined' then 'The admission offer was declined.'
        when 'accepted' then 'Your application was successful.'
        when 'rejected' then 'The admissions team has completed its decision.'
        when 'converted' then 'Enrolment has been completed.'
        else 'Your application status was updated.' end,
      new.decision_reason,auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists admission_status_history on public.admission_applications;
create trigger admission_status_history after insert or update of status on public.admission_applications
for each row execute function public.record_admission_status_change();

insert into public.admission_status_events(school_id,application_id,to_status,public_message,occurred_at)
select a.school_id,a.id,a.status,'Application imported into the applicant portal.',a.created_at
from public.admission_applications a
where not exists(select 1 from public.admission_status_events e where e.application_id=a.id);

create or replace function public.is_application_account(_school_id uuid,_application_id uuid,_account_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admission_applications a
    where a.school_id=_school_id and a.id=_application_id and a.applicant_account_id=_account_id)
  or exists(select 1 from public.applicant_guardians g
    where g.school_id=_school_id and g.application_id=_application_id and g.account_id=_account_id);
$$;

alter table public.applicant_guardians enable row level security;
alter table public.admission_documents enable row level security;
alter table public.admission_status_events enable row level security;

create policy applicant_guardians_self_read on public.applicant_guardians for select to authenticated
  using(public.is_application_account(school_id,application_id));
create policy applicant_guardians_self_write on public.applicant_guardians for all to authenticated
  using(public.is_application_account(school_id,application_id))
  with check(public.is_application_account(school_id,application_id));
create policy applicant_guardians_staff_manage on public.applicant_guardians for all to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'admissions.manage'))
  with check(public.account_has_permission(auth.uid(),school_id,'admissions.manage'));
create policy admission_documents_self_read on public.admission_documents for select to authenticated
  using(public.is_application_account(school_id,application_id));
create policy admission_documents_staff_manage on public.admission_documents for all to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'admissions.manage'))
  with check(public.account_has_permission(auth.uid(),school_id,'admissions.manage'));
create policy admission_status_self_read on public.admission_status_events for select to authenticated
  using(public.is_application_account(school_id,application_id));
create policy admission_status_staff_read on public.admission_status_events for select to authenticated
  using(public.account_has_permission(auth.uid(),school_id,'admissions.read'));

create trigger applicant_guardians_updated_at before update on public.applicant_guardians for each row execute function public.set_updated_at();
create trigger admission_documents_updated_at before update on public.admission_documents for each row execute function public.set_updated_at();

grant execute on function public.is_application_account(uuid,uuid,uuid) to authenticated,service_role;
grant select,insert,update,delete on public.applicant_guardians to authenticated,service_role;
grant select,insert,update,delete on public.admission_documents to authenticated,service_role;
grant select on public.admission_status_events to authenticated,service_role;
grant usage,select on sequence public.admission_status_events_id_seq to service_role;
