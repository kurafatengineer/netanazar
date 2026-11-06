alter table articles add column if not exists last_gone_at timestamptz;
alter table articles add column if not exists change_count int not null default 0;
