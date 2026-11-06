-- Daily automatic update: pg_cron calls the worker function every morning (06:00 IST = 00:30 UTC).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A separate secret that can only START an update (it cannot read or change anything). Not readable by anon/authenticated.
create table if not exists public.cron_auth (id int primary key default 1 check (id = 1), secret text not null);
alter table public.cron_auth enable row level security;
revoke all on public.cron_auth from anon, authenticated;
insert into public.cron_auth (id, secret) values (1, encode(gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

create or replace function public.run_daily_update() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare s text; req bigint;
begin
  select secret into s from public.cron_auth where id = 1;
  select net.http_post(
    url := 'https://qajsvaeamujtpdsutzgo.supabase.co/functions/v1/worker',
    headers := jsonb_build_object('content-type','application/json','x-cron', s),
    body := '{"action":"start","stages":["members","attendance","positions","news"]}'::jsonb,
    timeout_milliseconds := 30000) into req;
  return req;
end $$;
revoke all on function public.run_daily_update() from public, anon, authenticated;

select cron.unschedule('netanazar-daily') where exists (select 1 from cron.job where jobname = 'netanazar-daily');
select cron.schedule('netanazar-daily', '30 0 * * *', $$select public.run_daily_update()$$);

grant select on public.cron_auth to service_role;   -- the worker function reads the schedule secret
