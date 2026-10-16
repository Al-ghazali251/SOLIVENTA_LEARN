create table public.school_identifier_settings (
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null check (kind in ('admission','guardian')),
  format text not null,
  next_number bigint not null default 1 check (next_number > 0),
  padding smallint not null default 4 check (padding between 1 and 12),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (school_id, kind),
  check (format like '%{NUMBER}%')
);

insert into public.school_identifier_settings(school_id,kind,format,next_number,padding)
select id,'admission','STU-{YEAR}-{NUMBER}-{NAME}',1,4 from public.schools
on conflict do nothing;
insert into public.school_identifier_settings(school_id,kind,format,next_number,padding)
select id,'guardian','PAR-{NUMBER}-{NAME}',1,4 from public.schools
on conflict do nothing;

alter table public.guardians add column guardian_number text;
create unique index guardians_school_guardian_number_key on public.guardians(school_id,guardian_number) where guardian_number is not null;

create or replace function public.next_school_identifier(_school_id uuid,_kind text,_name text)
returns text language plpgsql security definer set search_path=public as $$
declare _setting public.school_identifier_settings%rowtype; _number bigint; _slug text; _value text;
begin
  if _kind not in ('admission','guardian') then raise exception 'unsupported identifier kind'; end if;
  insert into public.school_identifier_settings(school_id,kind,format)
  values(_school_id,_kind,case when _kind='admission' then 'STU-{YEAR}-{NUMBER}-{NAME}' else 'PAR-{NUMBER}-{NAME}' end)
  on conflict do nothing;
  select * into _setting from public.school_identifier_settings where school_id=_school_id and kind=_kind for update;
  _number:=_setting.next_number;
  update public.school_identifier_settings set next_number=next_number+1,updated_at=now() where school_id=_school_id and kind=_kind;
  _slug:=upper(regexp_replace(trim(_name),'[^a-zA-Z0-9]+','','g'));
  _slug:=left(coalesce(nullif(_slug,''),'PERSON'),12);
  _value:=replace(_setting.format,'{PREFIX}',case when _kind='admission' then 'STU' else 'PAR' end);
  _value:=replace(_value,'{YEAR}',extract(year from current_date)::text);
  _value:=replace(_value,'{NUMBER}',lpad(_number::text,_setting.padding,'0'));
  _value:=replace(_value,'{NAME}',_slug);
  return left(_value,80);
end $$;

update public.guardians g set guardian_number='PAR-'||upper(left(regexp_replace(g.display_name,'[^a-zA-Z0-9]+','','g'),12))||'-'||right(g.id::text,4)
where guardian_number is null;

alter table public.school_identifier_settings enable row level security;
create policy school_identifier_settings_staff_read on public.school_identifier_settings for select to authenticated using(public.is_school_staff(school_id));
create policy school_identifier_settings_staff_write on public.school_identifier_settings for all to authenticated using(public.is_school_staff(school_id)) with check(public.is_school_staff(school_id));
grant select,insert,update on public.school_identifier_settings to authenticated,service_role;
grant execute on function public.next_school_identifier(uuid,text,text) to service_role;
