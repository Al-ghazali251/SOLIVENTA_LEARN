do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classes'::regclass and conname = 'classes_id_school_id_key'
  ) then
    alter table public.classes add constraint classes_id_school_id_key unique (id, school_id);
  end if;
end $$;

create table public.school_identifier_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  class_id uuid not null,
  format text not null check (format like '%{NUMBER}%'),
  next_number bigint not null default 1 check (next_number > 0),
  padding smallint not null default 4 check (padding between 1 and 12),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (school_id, class_id),
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade
);

alter table public.school_identifier_profiles enable row level security;
create policy school_identifier_profiles_staff_read on public.school_identifier_profiles
  for select to authenticated using (public.is_school_staff(school_id));
create policy school_identifier_profiles_staff_write on public.school_identifier_profiles
  for all to authenticated using (public.is_school_staff(school_id))
  with check (public.is_school_staff(school_id));
grant select, insert, update, delete on public.school_identifier_profiles to authenticated, service_role;

create or replace function public.next_scoped_school_identifier(
  _school_id uuid, _kind text, _name text, _class_id uuid default null
) returns text language plpgsql security definer set search_path=public as $$
declare
  _format text; _padding smallint; _number bigint; _slug text; _value text; _profile_id uuid;
begin
  if _kind not in ('admission','guardian') then raise exception 'unsupported identifier kind'; end if;

  if _kind='admission' and _class_id is not null then
    select id, format, padding, next_number into _profile_id, _format, _padding, _number
    from public.school_identifier_profiles
    where school_id=_school_id and class_id=_class_id for update;
  end if;

  if _profile_id is not null then
    update public.school_identifier_profiles
      set next_number=next_number+1, updated_at=now() where id=_profile_id;
  else
    insert into public.school_identifier_settings(school_id,kind,format)
    values(_school_id,_kind,case when _kind='admission' then 'STU-{YEAR}-{NUMBER}-{NAME}' else 'PAR-{NUMBER}-{NAME}' end)
    on conflict do nothing;
    select format,padding,next_number into _format,_padding,_number
      from public.school_identifier_settings where school_id=_school_id and kind=_kind for update;
    update public.school_identifier_settings set next_number=next_number+1,updated_at=now()
      where school_id=_school_id and kind=_kind;
  end if;

  _slug:=upper(regexp_replace(trim(_name),'[^a-zA-Z0-9]+','','g'));
  _slug:=left(coalesce(nullif(_slug,''),'PERSON'),12);
  _value:=replace(_format,'{PREFIX}',case when _kind='admission' then 'STU' else 'PAR' end);
  _value:=replace(_value,'{YEAR}',extract(year from current_date)::text);
  _value:=replace(_value,'{NUMBER}',lpad(_number::text,_padding,'0'));
  _value:=replace(_value,'{NAME}',_slug);
  return left(_value,80);
end $$;

grant execute on function public.next_scoped_school_identifier(uuid,text,text,uuid) to service_role;
