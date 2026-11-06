alter table mentions add column if not exists party_at_mention text;
alter table articles add column if not exists last_gone_at timestamptz;
create index if not exists articles_status_idx on articles(status);
