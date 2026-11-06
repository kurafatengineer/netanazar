alter table articles drop constraint if exists articles_status_check;
alter table articles add constraint articles_status_check check (status in ('active','deleted','unreachable','irrelevant'));
create index if not exists articles_published_idx on articles(published_at);
create index if not exists mentions_article_idx on mentions(article_id);

-- Public, read-only views: only public facts. No article text, no private details.
create or replace view v_members as
  select id, name_en, name_hi, name_variants, party, house, constituency, state, photo_url, gender,
         terms_count, lok_sabha_terms, term_label, term_start, term_end, minister_position,
         elected_current, is_current, official_id, imported_at
  from politicians;

create or replace view v_member_detail as
  select id, positions_held, details_fetched_at from politicians;

create or replace view v_attendance as
  select politician_id, loksabha, session_no, session_period, sitting_days, signed_days from attendance;

create or replace view v_news_timeline as
  select m.politician_id, a.id as article_id, a.url, coalesce(a.title, '') as title,
         s.name as source_name, s.domain as source_domain,
         ((coalesce(a.published_at, a.first_seen_at)) at time zone 'Asia/Kolkata')::date as day,
         coalesce(a.published_at, a.first_seen_at) as at, a.status
  from mentions m
  join articles a on a.id = m.article_id
  left join sources s on s.id = a.source_id
  where a.status <> 'irrelevant';

create or replace view v_trending as
  select politician_id, count(distinct article_id)::int as stories
  from v_news_timeline
  where at >= now() - interval '7 days'
  group by politician_id;

grant select on v_members, v_member_detail, v_attendance, v_news_timeline, v_trending to anon, authenticated;
