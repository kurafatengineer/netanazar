from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from datetime import datetime, timedelta, timezone

TRACKING = ("utm_", "fbclid", "gclid", "ref")


def canonicalise(url: str) -> str:
    p = urlparse(url.strip())
    q = [(k, v) for k, v in parse_qsl(p.query) if not k.startswith(TRACKING)]
    return urlunparse((p.scheme, p.netloc.lower(), p.path.rstrip("/") or "/", "", urlencode(q), ""))


def add_articles(db, items, source_id=None):
    """Insert new URLs (dedupe by canonical url), queue them for first snapshot."""
    rows, seen = [], set()
    for it in items:
        c = canonicalise(it["url"])
        if c in seen:
            continue
        seen.add(c)
        rows.append({"url": c, "canonical_url": c, "source_id": source_id, "title": it.get("title"),
                     "next_check_at": datetime.now(timezone.utc).isoformat()})
    if not rows:
        return 0
    return len(db.insert("articles", rows, on_conflict="url", ignore_duplicates=True))
