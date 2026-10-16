-- Scoped notifications and audited, time-limited support access.
create table public.portal_notifications(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,
 recipient_account_id uuid not null references auth.users(id) on delete cascade,kind text not null,title text not null,body text not null,
 href text check(href is null or href like '/%'),resource_type text,resource_id text,read_at timestamptz,created_at timestamptz not null default now(),
 unique(school_id,id)
);
create index portal_notifications_recipient_idx on public.portal_notifications(school_id,recipient_account_id,read_at,created_at desc);
alter table public.portal_notifications enable row level security;
create policy portal_notifications_own_read on public.portal_notifications for select to authenticated using(recipient_account_id=auth.uid() and public.is_school_member(school_id));
create policy portal_notifications_own_update on public.portal_notifications for update to authenticated using(recipient_account_id=auth.uid() and public.is_school_member(school_id)) with check(recipient_account_id=auth.uid() and public.is_school_member(school_id));
grant select,update on public.portal_notifications to authenticated;grant select,insert,update,delete on public.portal_notifications to service_role;

create table public.support_access_sessions(
 id uuid primary key default gen_random_uuid(),school_id uuid not null references public.schools(id) on delete cascade,
 operator_account_id uuid not null references auth.users(id) on delete restrict,target_account_id uuid not null references auth.users(id) on delete restrict,
 target_membership_id uuid not null references public.tenant_memberships(id) on delete restrict,token_hash text not null unique,
 reason text not null check(char_length(trim(reason)) between 10 and 1000),status text not null default 'active' check(status in('active','ended','expired')),
 started_at timestamptz not null default now(),expires_at timestamptz not null,ended_at timestamptz,ended_by uuid references auth.users(id),
 check(expires_at>started_at and expires_at<=started_at+interval '2 hours'),check(operator_account_id<>target_account_id)
);
create index support_access_active_idx on public.support_access_sessions(operator_account_id,status,expires_at);
alter table public.support_access_sessions enable row level security;
grant select,insert,update on public.support_access_sessions to service_role;
