alter table public.politicians add column if not exists seat_history jsonb;
grant select (seat_history) on public.politicians to anon;
create or replace view public.v_member_detail with (security_invoker = true) as
  select id, positions_held, details_fetched_at, seat_history from public.politicians;
grant select on public.v_member_detail to anon;
