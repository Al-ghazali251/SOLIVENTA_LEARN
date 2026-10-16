-- Fee claims run through the service-role API, so auth.uid() is not the payer.
-- Always pass the explicit actor through the guardian authorization check.
create or replace function public.can_initiate_student_invoice(
  _school_id uuid,
  _student_id uuid,
  _user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.students s
    where s.school_id = _school_id
      and s.id = _student_id
      and s.user_id = _user_id
  )
  or public.is_linked_guardian(_school_id, _student_id, _user_id)
  or public.is_school_staff(_school_id, _user_id);
$$;

notify pgrst, 'reload schema';
