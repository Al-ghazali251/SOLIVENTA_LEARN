-- Complete identity links created by applicant conversion without mutating admission history.
create or replace function public.provision_guardian_membership_from_student_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare _account_id uuid; _display_name text; _membership_id uuid; _role_id uuid;
begin
  select user_id,display_name into _account_id,_display_name from public.guardians
  where school_id=new.school_id and id=new.guardian_id;
  if _account_id is null then return new; end if;
  insert into public.tenant_memberships(school_id,account_id,kind,status,lifecycle_state,display_name,joined_at)
  values(new.school_id,_account_id,'guardian','active','linked_to_student',_display_name,now())
  on conflict(school_id,account_id,kind) do update set status='active',lifecycle_state='linked_to_student',
    display_name=excluded.display_name,ended_at=null,updated_at=now() returning id into _membership_id;
  select id into _role_id from public.authorization_roles where school_id is null and code='parent';
  insert into public.membership_role_assignments(school_id,membership_id,role_id)
  values(new.school_id,_membership_id,_role_id) on conflict(membership_id,role_id) do nothing;
  insert into public.membership_entity_links(school_id,membership_id,entity_type,entity_id,is_primary)
  values(new.school_id,_membership_id,'guardian',new.guardian_id,true)
  on conflict(school_id,membership_id,entity_type,entity_id) do nothing;
  return new;
end $$;
create trigger guardian_student_membership after insert or update on public.guardian_student_links
for each row execute function public.provision_guardian_membership_from_student_link();

create or replace function public.record_applicant_membership_conversion()
returns trigger language plpgsql security definer set search_path='' as $$
declare _membership_id uuid;
begin
  if old.status is distinct from new.status and new.status='converted' and new.applicant_account_id is not null then
    select id into _membership_id from public.tenant_memberships
    where school_id=new.school_id and account_id=new.applicant_account_id and kind='applicant';
    if _membership_id is not null then
      insert into public.membership_lifecycle_events(school_id,membership_id,event_kind,from_state,to_state,reason,actor_account_id,metadata)
      values(new.school_id,_membership_id,'converted',old.status::text,'converted','Applicant enrolled as student.',new.reviewed_by,
        jsonb_build_object('applicationId',new.id,'studentId',new.converted_student_id));
    end if;
  end if;
  return new;
end $$;
create trigger applicant_membership_conversion_history after update of status on public.admission_applications
for each row execute function public.record_applicant_membership_conversion();
