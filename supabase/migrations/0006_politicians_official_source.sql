alter table politicians add column if not exists source text;
alter table politicians add column if not exists is_current boolean not null default true;
alter table politicians add column if not exists official_status text;
alter table politicians add column if not exists imported_at timestamptz;
create index if not exists politicians_house_idx on politicians(house);
