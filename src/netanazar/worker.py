"""Jobs: discovery (GDELT + feeds) and re-check of due articles. Run: python -m netanazar.worker"""
import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.blocking import BlockingScheduler
from . import config
from .db import DB
from .fetcher import PoliteFetcher
from .discovery import gdelt, feeds, ingest
from .extractor import extract
from .versioning import record_snapshot, handle_gone
from .schedule_rules import next_check
from .matcher import find_mentions, verify_with_llm

log = logging.getLogger("netanazar")
db = DB()
fetcher = PoliteFetcher(db)


def politicians():
    rows = db.select("politicians")
    for r in rows:
        r["variants"] = [v for v in [r["name_en"], r.get("name_hi"), *(r.get("name_variants") or [])] if v]
    return rows


def sync_delays():
    for s in db.select("sources"):
        fetcher.set_delay(s["domain"], s["min_delay_seconds"])
        if s["is_blocked"]:
            fetcher.blocked.add(s["domain"])


def discover_gdelt():
    for group in gdelt.batches(politicians()):
        arts = gdelt.search(group, timespan="1h")
        n = ingest.add_articles(db, [{"url": a["url"], "title": a.get("title")} for a in arts])
        log.info("gdelt: %d new", n)


def discover_feeds():
    sync_delays()
    for s in db.select("sources", is_blocked="eq.false"):
        items = []
        for u in s["rss_urls"] or []:
            r = fetcher.get(u, source_id=s["id"])
            if r.status == 200:
                items += feeds.parse_rss(r.text)
        if s.get("sitemap_url"):
            r = fetcher.get(s["sitemap_url"], source_id=s["id"])
            if r.status == 200:
                items += feeds.parse_sitemap(r.text)
        log.info("%s: %d new", s["domain"], ingest.add_articles(db, items, s["id"]))


def recheck_due(limit=50):
    sync_delays()
    now = datetime.now(timezone.utc)
    pols = politicians()
    due = db.select("articles", next_check_at=f"lte.{now.isoformat()}", status="neq.deleted",
                    order="next_check_at.asc", limit=limit)
    for a in due:
        r = fetcher.get(a["url"], etag=a.get("etag"), last_modified=a.get("last_modified"),
                        source_id=a.get("source_id"))
        changed = False
        if r.skipped:
            db.update("articles", {"next_check_at": (now + timedelta(days=1)).isoformat()}, id=f"eq.{a['id']}")
            continue
        if r.status == 304:
            db.update("articles", {"last_checked_at": now.isoformat()}, id=f"eq.{a['id']}")
        elif r.status == 200:
            title, body = extract(r.text)
            result = record_snapshot(db, a, title, body, r.headers)
            changed = result == "changed"
            if result != "same":
                store_mentions(a, title, body, pols)
        else:
            handle_gone(db, a, r.status)
        nxt = next_check(datetime.fromisoformat(a["first_seen_at"]), changed)
        db.update("articles", {"next_check_at": nxt.isoformat() if nxt else None}, id=f"eq.{a['id']}")


def store_mentions(article, title, body, pols):
    rows = []
    for m in find_mentions(f"{title}\n{body}", pols):
        row = {"article_id": article["id"], **m}
        if config.ANTHROPIC_API_KEY:
            p = next(x for x in pols if x["id"] == m["politician_id"])
            try:
                row["verified_by_ai"], row["ai_confidence"] = verify_with_llm(
                    title, m["snippet"], p, config.ANTHROPIC_API_KEY)
            except Exception as e:  # verification is optional
                log.warning("verify failed: %s", e)
        rows.append(row)
    if rows:
        db.insert("mentions", rows, on_conflict="article_id,politician_id", ignore_duplicates=True)


def main():
    logging.basicConfig(level=logging.INFO)
    s = BlockingScheduler()
    s.add_job(discover_gdelt, "interval", minutes=15, max_instances=1)
    s.add_job(discover_feeds, "interval", minutes=10, max_instances=1)
    s.add_job(recheck_due, "interval", minutes=5, max_instances=1)
    s.start()


if __name__ == "__main__":
    main()
