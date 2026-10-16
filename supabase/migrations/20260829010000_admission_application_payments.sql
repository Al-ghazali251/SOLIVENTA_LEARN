create table public.admission_application_payments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  application_id uuid not null references public.admission_applications(id) on delete cascade,
  method text not null check (method in ('paystack','bank_transfer')),
  provider_reference text not null,
  expected_amount_minor bigint not null check (expected_amount_minor >= 0),
  currency char(3) not null default 'NGN',
  status text not null check (status in ('initialized','pending_verification','successful','failed','abandoned')),
  authorization_url text,
  customer_reference text,
  paid_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, provider_reference)
);
create index admission_application_payments_application_idx on public.admission_application_payments(school_id, application_id, created_at desc);
alter table public.admission_application_payments enable row level security;
create policy admission_application_payments_staff_read on public.admission_application_payments for select to authenticated using (public.is_school_staff(school_id));
create trigger admission_application_payments_school_immutable before update on public.admission_application_payments for each row execute function public.prevent_school_id_change();
create trigger admission_application_payments_updated_at before update on public.admission_application_payments for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('admission-documents', 'admission-documents', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
