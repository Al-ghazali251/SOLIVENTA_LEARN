alter table public.fee_definitions
  add column class_ids uuid[] not null default '{}',
  add column student_audience text not null default 'all'
    check (student_audience in ('all', 'new', 'returning'));

update public.fee_definitions
set class_ids = array[class_id]
where class_id is not null and cardinality(class_ids) = 0;

create or replace function public.validate_fee_definition_audience()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.class_ids := coalesce((select array_agg(distinct value order by value) from unnest(new.class_ids) value), '{}');
  if exists (
    select 1 from unnest(new.class_ids) class_id
    where not exists (
      select 1 from public.classes c where c.school_id = new.school_id and c.id = class_id and c.active
    )
  ) then
    raise exception 'A selected fee class is unavailable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger fee_definitions_validate_audience
before insert or update of school_id, class_ids on public.fee_definitions
for each row execute function public.validate_fee_definition_audience();

create or replace function public.student_matches_fee_definition(_school uuid, _student uuid, _fee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.fee_definitions f
    join public.students s on s.school_id = f.school_id and s.id = _student and s.status = 'active'
    join public.student_enrollments e on e.school_id = s.school_id and e.student_id = s.id
      and e.session_id = f.session_id and e.active
    where f.school_id = _school and f.id = _fee and f.active
      and (cardinality(f.class_ids) = 0 or e.class_id = any(f.class_ids))
      and (
        f.student_audience = 'all'
        or (f.student_audience = 'new' and not exists (
          select 1 from public.student_enrollments prior
          where prior.school_id = s.school_id and prior.student_id = s.id and prior.session_id <> f.session_id
        ))
        or (f.student_audience = 'returning' and exists (
          select 1 from public.student_enrollments prior
          where prior.school_id = s.school_id and prior.student_id = s.id and prior.session_id <> f.session_id
        ))
      )
  );
$$;

create or replace function public.validate_invoice_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.student_matches_fee_definition(new.school_id, new.student_id, new.fee_definition_id) then
    raise exception 'Student is not eligible for this fee.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.issue_fee_to_eligible_students(
  _school uuid, _fee uuid, _due_on date, _actor uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare _count integer;
begin
  if not public.can_manage_school(_school, _actor) then
    raise exception 'Fee management permission required.' using errcode = '42501';
  end if;
  insert into public.fee_invoices (
    school_id, student_id, fee_definition_id, amount_minor, discount_minor, due_on, created_by
  )
  select f.school_id, s.id, f.id, f.amount_minor, 0, _due_on, _actor
  from public.fee_definitions f
  join public.students s on s.school_id = f.school_id and s.status = 'active'
  where f.school_id = _school and f.id = _fee and f.active
    and public.student_matches_fee_definition(_school, s.id, f.id)
  on conflict (student_id, fee_definition_id) do nothing;
  get diagnostics _count = row_count;
  insert into public.audit_events (school_id, actor_id, action, entity_type, entity_id, metadata)
  values (_school, _actor, 'fee.issued.bulk', 'fee_definition', _fee,
    jsonb_build_object('invoiceCount', _count, 'dueOn', _due_on));
  return _count;
end;
$$;

revoke all on function public.validate_fee_definition_audience() from public, anon, authenticated;
revoke all on function public.student_matches_fee_definition(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.issue_fee_to_eligible_students(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.issue_fee_to_eligible_students(uuid, uuid, date, uuid) to service_role;

create index fee_definitions_class_ids_idx on public.fee_definitions using gin (class_ids);
