alter table politicians add column if not exists photo_url text;
alter table politicians add column if not exists gender text;
alter table politicians add column if not exists terms_count int;
alter table politicians add column if not exists lok_sabha_terms int[];
alter table politicians add column if not exists term_label text;
alter table politicians add column if not exists term_start date;
alter table politicians add column if not exists term_end date;
alter table politicians add column if not exists minister_position text;
alter table politicians add column if not exists positions_held jsonb;
alter table politicians add column if not exists elected_current text;
alter table politicians add column if not exists details_fetched_at timestamptz;

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  politician_id uuid not null references politicians(id) on delete cascade,
  house text not null,
  loksabha int not null,
  session_no int not null,
  session_period text,
  sitting_days int,
  signed_days int,
  fetched_at timestamptz not null default now(),
  unique (politician_id, loksabha, session_no)
);
create index if not exists attendance_politician_idx on attendance(politician_id);
alter table attendance enable row level security;
create policy "read attendance" on attendance for select to authenticated using (true);
grant all on attendance to service_role;
grant select on attendance to authenticated;
