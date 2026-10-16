-- Resolve the guardians affected by a fee definition so the API can deliver
-- both portal and email notifications without exposing cross-tenant records.
create or replace function public.fee_guardian_notification_recipients(
  _school uuid,
  _fee uuid
)
returns table (
  guardian_id uuid,
  account_id uuid,
  email text,
  guardian_name text,
  student_names text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    guardian.id,
    guardian.user_id,
    account.primary_email::text,
    guardian.display_name,
    string_agg(distinct student.full_name, ', ' order by student.full_name)
  from public.guardians guardian
  join public.accounts account
    on account.id = guardian.user_id
   and account.status = 'active'
  join public.guardian_student_links link
    on link.school_id = guardian.school_id
   and link.guardian_id = guardian.id
  join public.students student
    on student.school_id = link.school_id
   and student.id = link.student_id
   and student.status = 'active'
  where guardian.school_id = _school
    and account.primary_email is not null
    and public.student_matches_fee_definition(_school, student.id, _fee)
  group by guardian.id, guardian.user_id, account.primary_email, guardian.display_name;
$$;

revoke all on function public.fee_guardian_notification_recipients(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.fee_guardian_notification_recipients(uuid, uuid)
to service_role;
