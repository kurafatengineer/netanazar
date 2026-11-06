# NetaNazar

Tracks Indian MPs/MLAs in the news: every article is snapshotted, every later edit is versioned with timestamps, and deletions are flagged. Polite by design (robots.txt, one request at a time per domain, honest User-Agent, no evasion).

Supabase project: **Neta Nazar** (`qajsvaeamujtpdsutzgo`, schema applied via `supabase/migrations/`).

## Setup
```bash
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env     # fill SUPABASE_SERVICE_KEY and CONTACT_EMAIL
python seed/seed.py      # 10 sample politicians + 10 sources
python -m netanazar.worker                 # discovery + re-check scheduler
flask --app netanazar.dashboard run        # dashboard on :5000
pytest
```
Deploy the worker on a small VPS (ideally in India) with systemd/cron — not GitHub Actions (datacenter IPs get blocked).

## Add a politician / source
Insert a row in `politicians` (put Hindi/English spelling variants in `name_variants`) or `sources` (`domain`, `rss_urls`, optional `sitemap_url`, `min_delay_seconds`) via the Supabase dashboard or `seed/seed.py`.

## Layout
`src/netanazar/`: `fetcher/` (polite queue), `extractor.py`, `versioning.py`, `discovery/` (GDELT, RSS, sitemaps), `schedule_rules.py`, `matcher.py`, `worker.py`, `dashboard.py`.

## Notes
- Dashboard reads with the service key server-side; keep it behind auth/private network. RLS blocks anonymous access.
- Blocked domains (repeated 403/429/503) get `sources.is_blocked = true`; we rely on GDELT metadata for them.
- Phase 2 (X, YouTube): schema is ready for extra source types; not built yet.

## Pages (GitHub Pages, folder `/docs`)
- `index.html` — **public site**: search any MP/MLA (name, party, constituency, state) with suggestions; profile with photo, status (green sitting / red former), attendance by session, positions held, and a date-wise "road" of news mentions; click a day for a source -> story flow, click a story for its edit history and a link to the original.
- `admin.html` — **admin panel**: one click "Update everything" (members, attendance, positions, news). Needs the admin token (`REGISTRY_TOKEN`).

The public site only reads read-only views (`v_members`, `v_attendance`, `v_news_timeline`, `v_article_changes`, `v_trending`, `v_member_detail`) with the publishable key. See `supabase/migrations/0009_*` and `0010_*`.

## Edge functions (Supabase)
`registry` (members, attendance, positions from sansad.in) and `news` (feeds -> politely fetch -> keep only stories that name a member). Sources are in `supabase/functions/`.

## Notes
- Only public information is stored. Article text is never shown publicly; the public site shows headlines, sources, times and a summary of edits.
- Sites that block our server are paused automatically; we never try to bypass a block.
- Facebook / Instagram / X are not collected yet; the timeline already has slots and icons for them.
