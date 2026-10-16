-- Keep specialist duties explicit and aligned with the application permission catalog.
insert into public.authorization_role_permissions(role_id, permission_id)
select role.id, permission.id
from public.authorization_roles role
join public.authorization_permissions permission on permission.code in ('attendance.manage','membership.read')
where role.school_id is null and role.code='registrar'
on conflict(role_id,permission_id) do nothing;
