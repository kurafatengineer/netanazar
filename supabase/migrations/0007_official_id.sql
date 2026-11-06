alter table politicians add column if not exists official_id text;
create unique index if not exists politicians_official_id_key on politicians(official_id) where official_id is not null;
