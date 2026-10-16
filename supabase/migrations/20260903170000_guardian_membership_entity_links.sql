-- Keep the canonical guardian record connected to the identity membership.
-- Earlier guardian rows were backfilled once, but guardians created later were not linked.
create or replace function public.sync_guardian_membership_entity_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare _membership_id uuid;
begin
  select id into _membership_id
  from public.tenant_memberships
  where school_id = new.school_id
    and account_id = new.user_id
    and kind = 'guardian';

  if _membership_id is not null then
    insert into public.membership_entity_links (
      school_id, membership_id, entity_type, entity_id
    ) values (
      new.school_id, _membership_id, 'guardian', new.id
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;

insert into public.membership_entity_links (school_id, membership_id, entity_type, entity_id)
select g.school_id, tm.id, 'guardian', g.id
from public.guardians g
join public.tenant_memberships tm
  on tm.school_id = g.school_id
 and tm.account_id = g.user_id
 and tm.kind = 'guardian'
on conflict do nothing;

create trigger guardians_membership_entity_link
after insert or update of school_id, user_id on public.guardians
for each row execute function public.sync_guardian_membership_entity_link();

revoke all on function public.sync_guardian_membership_entity_link() from public, anon, authenticated;
