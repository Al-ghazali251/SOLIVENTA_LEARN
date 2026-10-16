create table public.school_payment_settings (
  school_id uuid primary key references public.schools(id) on delete cascade,
  paystack_enabled boolean not null default false,
  manual_transfer_enabled boolean not null default false,
  bank_name text not null default '' check (char_length(bank_name) <= 120),
  account_name text not null default '' check (char_length(account_name) <= 160),
  account_number text not null default '' check (char_length(account_number) <= 40),
  transfer_instructions text not null default '' check (char_length(transfer_instructions) <= 1000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not manual_transfer_enabled or (char_length(trim(bank_name)) >= 2 and char_length(trim(account_name)) >= 2 and char_length(trim(account_number)) >= 5))
);
create trigger school_payment_settings_updated before update on public.school_payment_settings for each row execute function public.set_updated_at();
alter table public.school_payment_settings enable row level security;
create policy school_payment_settings_read on public.school_payment_settings for select to authenticated using (public.is_school_member(school_id));
create policy school_payment_settings_manage on public.school_payment_settings for all to authenticated using (public.account_has_permission(auth.uid(), school_id, 'fees.manage')) with check (public.account_has_permission(auth.uid(), school_id, 'fees.manage'));
grant select, insert, update on public.school_payment_settings to authenticated;
insert into public.school_payment_settings (school_id) select id from public.schools on conflict do nothing;
create or replace function public.audit_school_payment_settings() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.finance_audit_events(school_id,actor_id,action,entity_type,entity_id,before_state,after_state)
 values(new.school_id,new.updated_by,'payment.settings.updated','school_payment_settings',new.school_id,case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger school_payment_settings_audit after insert or update on public.school_payment_settings for each row execute function public.audit_school_payment_settings();
revoke all on function public.audit_school_payment_settings() from public,anon,authenticated;
