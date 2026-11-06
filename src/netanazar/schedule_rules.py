from datetime import datetime, timedelta, timezone


def next_interval(age: timedelta, recently_changed: bool = False) -> timedelta | None:
    """Adaptive re-check interval; None => stop tracking (older than 90 days)."""
    h = age.total_seconds() / 3600
    if h < 48:
        iv = timedelta(hours=1)
    elif h < 24 * 7:
        iv = timedelta(hours=6)
    elif h < 24 * 30:
        iv = timedelta(days=1)
    elif h < 24 * 90:
        iv = timedelta(days=7)
    else:
        return None
    if recently_changed:
        iv = max(iv / 2, timedelta(minutes=30))
    return iv


def next_check(first_seen: datetime, changed: bool, now: datetime | None = None):
    now = now or datetime.now(timezone.utc)
    iv = next_interval(now - first_seen, changed)
    return None if iv is None else now + iv
