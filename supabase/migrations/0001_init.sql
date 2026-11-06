-- NetaNazar initial schema
create extension if not exists pgcrypto;

create table politicians (
  id uuid primary key default gen_random_uuid(),
  name_en text not null,
  name_hi text,
  name_variants text[] not null default '{}',
  house text not null check (house in ('Lok Sabha','Rajya Sabha','State Assembly')),
  state text,
  constituency text,
  party text,
  x_handle text,
  youtube_channel_id text,
  telegram_channel text,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null unique,
  name text,
  rss_urls text[] not null default '{}',
  sitemap_url text,
  min_delay_seconds int not null default 10,
  is_blocked boolean not null default false,
  last_fetched_at timestamptz,
  notes text
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  canonical_url text,
  source_id uuid references sources(id),
  title text,
  first_seen_at timestamptz not null default now(),
  published_at timestamptz,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  status text not null default 'active' check (status in ('active','deleted','unreachable')),
  deleted_at timestamptz,
  current_hash text,
  etag text,
  last_modified text,
  wayback_url text
);
create index articles_next_check_at_idx on articles(next_check_at);
create index articles_canonical_url_idx on articles(canonical_url);

create table article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  version_no int not null,
  title text,
  body_text text,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  diff_from_previous jsonb,
  unique (article_id, version_no)
);

create table mentions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  politician_id uuid not null references politicians(id) on delete cascade,
  matched_variant text,
  snippet text,
  verified_by_ai boolean,
  ai_confidence real,
  created_at timestamptz not null default now(),
  unique (article_id, politician_id)
);
create index mentions_politician_id_idx on mentions(politician_id);

create table fetch_log (
  id bigint generated always as identity primary key,
  source_id uuid references sources(id),
  url text not null,
  http_status int,
  bytes int,
  duration_ms int,
  fetched_at timestamptz not null default now()
);
create index fetch_log_source_time_idx on fetch_log(source_id, fetched_at);

-- RLS on; workers use the service key. Dashboard gets read-only access.
alter table politicians enable row level security;
alter table sources enable row level security;
alter table articles enable row level security;
alter table article_versions enable row level security;
alter table mentions enable row level security;
alter table fetch_log enable row level security;

create policy "read politicians" on politicians for select to authenticated using (true);
create policy "read sources" on sources for select to authenticated using (true);
create policy "read articles" on articles for select to authenticated using (true);
create policy "read versions" on article_versions for select to authenticated using (true);
create policy "read mentions" on mentions for select to authenticated using (true);
create policy "read fetch_log" on fetch_log for select to authenticated using (true);
