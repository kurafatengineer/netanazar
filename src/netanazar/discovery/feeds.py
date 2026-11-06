import xml.etree.ElementTree as ET
import feedparser


def parse_rss(text: str) -> list[dict]:
    d = feedparser.parse(text)
    return [{"url": e.get("link"), "title": e.get("title"), "published": e.get("published")}
            for e in d.entries if e.get("link")]


def parse_sitemap(text: str) -> list[dict]:
    """Works for news sitemaps and plain sitemaps; returns url + lastmod when present."""
    root = ET.fromstring(text)
    out = []
    for u in root.iter():
        if u.tag.endswith("}url") or u.tag == "url":
            item = {}
            for c in u:
                tag = c.tag.split("}")[-1]
                if tag == "loc":
                    item["url"] = (c.text or "").strip()
                elif tag == "lastmod":
                    item["lastmod"] = (c.text or "").strip()
                elif tag == "news":
                    for n in c:
                        if n.tag.split("}")[-1] == "title":
                            item["title"] = n.text
            if item.get("url"):
                out.append(item)
    return out
