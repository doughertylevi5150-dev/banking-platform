-- Newer Supabase projects no longer grant table privileges to service_role by
-- default, so the Edge Functions (which use the service role key) got
-- "permission denied" on every table. Grant only service_role; anon and
-- authenticated stay locked out (RLS is enabled with no policies anyway).
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
