-- Schools may create sessions and terms before their calendar dates are confirmed.
alter table public.academic_sessions
  alter column starts_on drop not null,
  alter column ends_on drop not null;

alter table public.academic_terms
  alter column starts_on drop not null,
  alter column ends_on drop not null;

create or replace function public.validate_academic_term_dates()
returns trigger language plpgsql set search_path = '' as $$
declare session_start date; session_end date;
begin
  select starts_on, ends_on into session_start, session_end
  from public.academic_sessions where school_id = new.school_id and id = new.session_id;

  if (new.starts_on is not null and session_start is not null and new.starts_on < session_start)
     or (new.ends_on is not null and session_end is not null and new.ends_on > session_end) then
    raise exception 'term dates must fall within the academic session' using errcode = '23514';
  end if;
  return new;
end;
$$;
