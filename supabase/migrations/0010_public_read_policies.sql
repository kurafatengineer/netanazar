alter view public.v_members set (security_invoker = true);
alter view public.v_member_detail set (security_invoker = true);
alter view public.v_attendance set (security_invoker = true);
alter view public.v_news_timeline set (security_invoker = true);
alter view public.v_trending set (security_invoker = true);

grant usage on schema public to anon;
grant select on public.v_members, public.v_member_detail, public.v_attendance, public.v_news_timeline, public.v_trending to anon;

-- Column-level public access: only public facts. article text (article_versions) and snippets stay private.
grant select (id, name_en, name_hi, name_variants, party, house, constituency, state, photo_url, gender, terms_count, lok_sabha_terms, term_label, term_start, term_end, minister_position, elected_current, is_current, official_id, imported_at, positions_held, details_fetched_at) on public.politicians to anon;
grant select (politician_id, loksabha, session_no, session_period, sitting_days, signed_days) on public.attendance to anon;
grant select (politician_id, article_id, created_at) on public.mentions to anon;
grant select (id, url, title, source_id, first_seen_at, published_at, status, deleted_at) on public.articles to anon;
grant select (id, name, domain) on public.sources to anon;

drop policy if exists "public read politicians" on public.politicians;
create policy "public read politicians" on public.politicians for select to anon using (true);
drop policy if exists "public read attendance" on public.attendance;
create policy "public read attendance" on public.attendance for select to anon using (true);
drop policy if exists "public read mentions" on public.mentions;
create policy "public read mentions" on public.mentions for select to anon using (true);
drop policy if exists "public read articles" on public.articles;
create policy "public read articles" on public.articles for select to anon using (status <> 'irrelevant');
drop policy if exists "public read sources" on public.sources;
create policy "public read sources" on public.sources for select to anon using (true);

-- Change history of articles (what changed and when), without the article text itself.
alter table public.article_versions add column if not exists added_lines int;
alter table public.article_versions add column if not exists removed_lines int;
grant select (article_id, version_no, title, captured_at, added_lines, removed_lines) on public.article_versions to anon;
drop policy if exists "public read article changes" on public.article_versions;
create policy "public read article changes" on public.article_versions for select to anon using (true);
create or replace view public.v_article_changes with (security_invoker = true) as
  select article_id, version_no, title, captured_at, added_lines, removed_lines from public.article_versions;
grant select on public.v_article_changes to anon;
