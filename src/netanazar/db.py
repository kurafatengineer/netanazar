"""Thin PostgREST client for Supabase (service key, server-side only)."""
import httpx
from . import config


class DB:
    def __init__(self, url=None, key=None):
        url = url or config.SUPABASE_URL
        key = key or config.SUPABASE_SERVICE_KEY
        self.c = httpx.Client(
            base_url=f"{url}/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"},
            timeout=30,
        )

    def select(self, table, **params):
        r = self.c.get(f"/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def insert(self, table, rows, on_conflict=None, ignore_duplicates=False):
        headers, params = {}, {}
        if on_conflict:
            params["on_conflict"] = on_conflict
            headers["Prefer"] = "return=representation,resolution=" + (
                "ignore-duplicates" if ignore_duplicates else "merge-duplicates")
        r = self.c.post(f"/{table}", json=rows, params=params, headers=headers)
        r.raise_for_status()
        return r.json()

    def update(self, table, values, **filters):
        r = self.c.patch(f"/{table}", json=values, params=filters)
        r.raise_for_status()
        return r.json()
