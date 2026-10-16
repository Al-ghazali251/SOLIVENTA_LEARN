-- Activating a period atomically returns the previous active period to planned.
-- Locking the school row serializes competing activation requests.
create or replace function public.activate_single_academic_period()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'active' then
    return new;
  end if;

  perform 1 from public.schools where id = new.school_id for update;
  if tg_table_name = 'academic_sessions' then
    update public.academic_sessions set status = 'planned'
    where school_id = new.school_id and status = 'active' and id <> new.id;
  elsif tg_table_name = 'academic_terms' then
    update public.academic_terms set status = 'planned'
    where school_id = new.school_id and status = 'active' and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger academic_sessions_single_active
before insert or update of status on public.academic_sessions
for each row execute function public.activate_single_academic_period();

create trigger academic_terms_single_active
before insert or update of status on public.academic_terms
for each row execute function public.activate_single_academic_period();

revoke all on function public.activate_single_academic_period() from public;
