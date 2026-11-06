grant usage on schema public to service_role, authenticated;
grant all on all tables in schema public to service_role;
grant select on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to service_role;
