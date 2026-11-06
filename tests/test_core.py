from datetime import timedelta, datetime, timezone
from netanazar.versioning import line_diff, record_snapshot, handle_gone
from netanazar.extractor import normalise, content_hash
from netanazar.matcher import find_mentions
from netanazar.schedule_rules import next_interval
from netanazar.discovery.ingest import canonicalise
from netanazar.discovery.feeds import parse_sitemap
from netanazar.discovery.gdelt import build_query
from netanazar.fetcher import PoliteFetcher
import httpx


class FakeDB:
    def __init__(self): self.t = {"article_versions": []}; self.updates = []
    def select(self, table, **p): return sorted(self.t.get(table, []), key=lambda r: -r["version_no"])[:1]
    def insert(self, table, row, **k): self.t.setdefault(table, []).append(row); return [row]
    def update(self, table, vals, **f): self.updates.append(vals); return []


def test_hash_stable_and_normalised():
    assert normalise("a  b\n\n c ") == "a b\nc"
    assert content_hash("t", "b") == content_hash("t", "b") != content_hash("t", "b2")


def test_versions_and_diff():
    db, a = FakeDB(), {"id": "1", "current_hash": None}
    assert record_snapshot(db, a, "T", "line1\nline2", {}) == "new"
    a["current_hash"] = content_hash("T", "line1\nline2")
    assert record_snapshot(db, a, "T", "line1\nline2", {}) == "same"
    assert record_snapshot(db, a, "T", "line1\nline3", {}) == "changed"
    assert db.t["article_versions"][-1]["diff_from_previous"] == {"added": ["line3"], "removed": ["line2"]}


def test_deletion_needs_two_404s():
    db = FakeDB()
    assert handle_gone(db, {"id": "1"}, 404) == "gone_once"
    assert handle_gone(db, {"id": "1", "last_gone_at": "x"}, 410) == "deleted"
    assert handle_gone(db, {"id": "1"}, 503) == "unreachable"


def test_matcher_hindi_english():
    p = [{"id": "p", "variants": ["नरेंद्र मोदी", "Narendra Modi"]}]
    assert find_mentions("PM narendra modi said", p)[0]["matched_variant"] == "Narendra Modi"
    assert find_mentions("प्रधानमंत्री नरेंद्र मोदी ने", p)
    assert not find_mentions("Modiji", p)


def test_schedule():
    assert next_interval(timedelta(hours=5)) == timedelta(hours=1)
    assert next_interval(timedelta(days=3)) == timedelta(hours=6)
    assert next_interval(timedelta(days=10)) == timedelta(days=1)
    assert next_interval(timedelta(days=40)) == timedelta(days=7)
    assert next_interval(timedelta(days=91)) is None
    assert next_interval(timedelta(hours=5), True) == timedelta(minutes=30)


def test_canonical_and_sitemap_and_query():
    assert canonicalise("https://X.com/a/?utm_source=t&id=1#f") == "https://x.com/a?id=1"
    xml = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a/1</loc><lastmod>2026-01-01</lastmod></url></urlset>'
    assert parse_sitemap(xml) == [{"url": "https://a/1", "lastmod": "2026-01-01"}]
    assert 'sourcecountry:IN' in build_query(["A B", "C"])


def test_fetcher_politeness_robots_and_blocking():
    calls, sleeps = [], []
    def handler(req):
        calls.append(str(req.url))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /private")
        return httpx.Response(403 if "blk" in req.url.host else 200, text="ok")
    f = PoliteFetcher(client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=sleeps.append)
    assert f.get("https://a.com/private/x").skipped == "robots"
    assert f.get("https://a.com/p1").status == 200
    assert f.get("https://a.com/p2").status == 200
    assert any(s > 0 for s in sleeps)  # delay enforced between requests
    for i in range(3): f.get(f"https://blk.com/{i}")
    assert "blk.com" in f.blocked and f.get("https://blk.com/z").skipped == "blocked"
