-- The API resolves a user's workspaces with its service-role client after the
-- bearer token has been verified. Keep browser access authenticated-only while
-- allowing that trusted server-side lookup.
grant execute on function public.get_account_workspaces(uuid) to service_role;
