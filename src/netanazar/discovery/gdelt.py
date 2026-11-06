import time
import httpx
from .. import config

URL = "https://api.gdeltproject.org/api/v2/doc/doc"


def build_query(variants: list[str], lang: str | None = None) -> str:
    terms = " OR ".join(f'"{v}"' for v in variants)
    q = f"({terms}) sourcecountry:IN"
    return q + (f" sourcelang:{lang}" if lang else "")


def search(variants, timespan="1h", lang=None, client=None, retries=3):
    client = client or httpx.Client(headers={"User-Agent": config.USER_AGENT}, timeout=30)
    params = {"query": build_query(variants, lang), "mode": "artlist", "format": "json",
              "timespan": timespan, "maxrecords": 100}
    for i in range(retries):
        r = client.get(URL, params=params)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(5 * 2 ** i)
            continue
        try:
            return r.json().get("articles", [])
        except ValueError:
            return []
    return []


def batches(politicians, size=5):
    """Group several politicians' variants into one OR query (fewer API calls)."""
    for i in range(0, len(politicians), size):
        chunk = politicians[i:i + size]
        yield [v for p in chunk for v in p["variants"]]
