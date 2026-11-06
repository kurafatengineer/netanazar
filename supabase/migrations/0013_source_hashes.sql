create table if not exists public.source_hashes (
  key text primary key,
  hash text not null,
  item_count int,
  meta jsonb,
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);
alter table public.source_hashes enable row level security;
grant all on public.source_hashes to service_role;
alter table public.politicians add column if not exists official_hash text;
alter table public.politicians add column if not exists positions_hash text;
