alter table politicians add column if not exists wikidata_id text unique;

create table if not exists registry_checks (
  id uuid primary key default gen_random_uuid(),
  politician_id uuid not null references politicians(id) on delete cascade,
  source text not null,
  found boolean not null,
  checked_at timestamptz not null default now(),
  unique (politician_id, source)
);
alter table registry_checks enable row level security;
create policy "read registry_checks" on registry_checks for select to authenticated using (true);
grant all on registry_checks to service_role;
grant select on registry_checks to authenticated;
