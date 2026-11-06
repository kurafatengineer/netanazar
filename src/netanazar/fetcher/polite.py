"""Polite fetcher: one request at a time per domain, min delay, robots.txt, backoff.
No proxies, no CAPTCHA solving, no evasion. Persistent blocking => domain is marked blocked."""
import threading, time
from dataclasses import dataclass, field
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
import httpx
from .. import config

ROBOTS_TTL = 24 * 3600
BLOCK_THRESHOLD = 3


@dataclass
class FetchResult:
    url: str
    status: int | None
    text: str = ""
    headers: dict = field(default_factory=dict)
    bytes: int = 0
    duration_ms: int = 0
    skipped: str | None = None  # "robots" | "blocked" | None


class PoliteFetcher:
    def __init__(self, db=None, client=None, sleep=time.sleep, clock=time.monotonic):
        self.db = db
        self.client = client or httpx.Client(headers={"User-Agent": config.USER_AGENT},
                                             timeout=30, follow_redirects=True)
        self.sleep, self.clock = sleep, clock
        self._locks: dict[str, threading.Lock] = {}
        self._last: dict[str, float] = {}
        self._robots: dict[str, tuple[float, RobotFileParser]] = {}
        self._block_count: dict[str, int] = {}
        self.blocked: set[str] = set()
        self.delays: dict[str, float] = {}
        self._glock = threading.Lock()

    def set_delay(self, domain, seconds):
        self.delays[domain] = seconds

    def _lock(self, domain):
        with self._glock:
            return self._locks.setdefault(domain, threading.Lock())

    def _allowed(self, url, domain):
        now = self.clock()
        cached = self._robots.get(domain)
        if not cached or now - cached[0] > ROBOTS_TTL:
            rp = RobotFileParser()
            scheme = urlparse(url).scheme
            try:
                r = self.client.get(f"{scheme}://{domain}/robots.txt")
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                else:
                    rp.parse([])  # no robots.txt => allowed
            except httpx.HTTPError:
                rp.parse([])
            self._robots[domain] = cached = (now, rp)
        return cached[1].can_fetch(config.USER_AGENT, url)

    def get(self, url, etag=None, last_modified=None, source_id=None, max_retries=3) -> FetchResult:
        domain = urlparse(url).netloc
        if domain in self.blocked:
            return FetchResult(url, None, skipped="blocked")
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        with self._lock(domain):
            if not self._allowed(url, domain):
                return FetchResult(url, None, skipped="robots")
            res = None
            for attempt in range(max_retries + 1):
                wait = self.delays.get(domain, 10) - (self.clock() - self._last.get(domain, -1e9))
                if wait > 0:
                    self.sleep(wait)
                t0 = self.clock()
                try:
                    r = self.client.get(url, headers=headers)
                    status, body, rh = r.status_code, r.text, dict(r.headers)
                except httpx.HTTPError:
                    status, body, rh = None, "", {}
                self._last[domain] = self.clock()
                res = FetchResult(url, status, body, rh, len(body.encode()), int((self._last[domain] - t0) * 1000))
                self._log(source_id, res)
                if status in (429, 503):
                    ra = rh.get("retry-after", "")
                    delay = float(ra) if ra.isdigit() else 2 ** attempt * 30
                    self.sleep(min(delay, 600))
                    continue
                break
            self._track_block(domain, res.status)
            return res

    def _track_block(self, domain, status):
        if status in (403, 429, 503):
            self._block_count[domain] = self._block_count.get(domain, 0) + 1
            if self._block_count[domain] >= BLOCK_THRESHOLD:
                self.blocked.add(domain)
                if self.db:
                    self.db.update("sources", {"is_blocked": True}, domain=f"eq.{domain}")
        elif status and status < 400:
            self._block_count[domain] = 0

    def _log(self, source_id, res):
        if self.db:
            try:
                self.db.insert("fetch_log", {"source_id": source_id, "url": res.url,
                                             "http_status": res.status, "bytes": res.bytes,
                                             "duration_ms": res.duration_ms})
            except httpx.HTTPError:
                pass
