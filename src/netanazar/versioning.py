import difflib
from datetime import datetime, timezone
from .extractor import content_hash


def line_diff(old: str, new: str) -> dict:
    added, removed = [], []
    for l in difflib.ndiff(old.splitlines(), new.splitlines()):
        if l.startswith("+ "):
            added.append(l[2:])
        elif l.startswith("- "):
            removed.append(l[2:])
    return {"added": added, "removed": removed}


def now():
    return datetime.now(timezone.utc)


def record_snapshot(db, article, title, body, headers):
    """Save v1 or a new version when the hash changed. Returns 'new'|'changed'|'same'."""
    h = content_hash(title, body)
    base = {"last_checked_at": now().isoformat(), "etag": headers.get("etag"),
            "last_modified": headers.get("last-modified"), "status": "active", "deleted_at": None, "last_gone_at": None}
    if article.get("current_hash") == h:
        db.update("articles", base, id=f"eq.{article['id']}")
        return "same"
    prev = db.select("article_versions", article_id=f"eq.{article['id']}",
                     order="version_no.desc", limit=1)
    version_no = prev[0]["version_no"] + 1 if prev else 1
    diff = line_diff(prev[0]["body_text"] or "", body) if prev else None
    db.insert("article_versions", {"article_id": article["id"], "version_no": version_no,
                                   "title": title, "body_text": body, "content_hash": h,
                                   "diff_from_previous": diff})
    db.update("articles", {**base, "title": title, "current_hash": h}, id=f"eq.{article['id']}")
    return "new" if version_no == 1 else "changed"


def handle_gone(db, article, status):
    """404/410 seen twice (on separate checks) => deleted. 5xx/timeouts => unreachable, never deleted."""
    ts = now().isoformat()
    if status in (404, 410):
        if article.get("last_gone_at"):
            db.update("articles", {"status": "deleted", "deleted_at": ts, "last_checked_at": ts},
                      id=f"eq.{article['id']}")
            return "deleted"
        db.update("articles", {"last_gone_at": ts, "last_checked_at": ts}, id=f"eq.{article['id']}")
        return "gone_once"
    db.update("articles", {"status": "unreachable", "last_checked_at": ts}, id=f"eq.{article['id']}")
    return "unreachable"
