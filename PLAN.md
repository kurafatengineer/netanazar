# NetaNazar – proposed structure

```
supabase/migrations/   SQL migrations (0001_init.sql)
src/netanazar/
  config.py            .env loading
  discovery/           gdelt.py, rss.py, sitemap.py
  fetcher/             polite per-domain queue, robots cache, backoff
  extractor.py         trafilatura + normalisation + SHA-256
  versioning.py        snapshots, difflib line diffs, deletion detection
  scheduler.py         APScheduler jobs + adaptive re-check intervals
  matcher.py           name-variant matching, optional LLM verification
dashboard/             Next.js app (search, diff view, deleted badge, timeline)
seed/seed.py           10 politicians + 10 news sources
tests/
README.md
```

Build order: migrations -> fetcher -> extractor/versioning -> discovery -> scheduler -> matcher -> dashboard, each tested on 2-3 real politicians.
