create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'update_all',
  status text not null default 'running' check (status in ('running','stopping','done','stopped','failed')),
  options jsonb,
  summary jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.job_tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null,
  grp text not null,
  label text not null,
  params jsonb,
  deps text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','queued','running','done','failed','skipped','stopped')),
  detail text,
  progress int not null default 0,
  state jsonb,
  sort int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists job_tasks_job_idx on public.job_tasks(job_id);
alter table public.jobs enable row level security;
alter table public.job_tasks enable row level security;
grant all on public.jobs, public.job_tasks to service_role;
