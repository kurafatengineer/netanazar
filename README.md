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
