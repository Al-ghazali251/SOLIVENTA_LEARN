-- The API's trusted Supabase client uses service_role for server-side tenant and
-- platform operations. Cover tables added after the original tenancy baseline
-- and ensure future migrations inherit the same access.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
