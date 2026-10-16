create table public.public_contact_enquiries(id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,name text not null check(char_length(trim(name)) between 2 and 120),email extensions.citext not null,message text not null check(char_length(trim(message)) between 10 and 2000),status text not null default 'new' check(status in('new','responded','closed')),created_at timestamptz not null default now(),unique(school_id,id));
create index public_contact_enquiries_school_created_idx on public.public_contact_enquiries(school_id,created_at desc);
alter table public.public_contact_enquiries enable row level security;
create policy public_contact_enquiries_staff_read on public.public_contact_enquiries for select to authenticated using(public.account_has_permission(auth.uid(),school_id,'messages.read'));
grant select on public.public_contact_enquiries to authenticated;
