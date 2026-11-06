import hashlib, unicodedata, re
import trafilatura


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFC", text or "")
    lines = [re.sub(r"[ \t ]+", " ", l).strip() for l in text.splitlines()]
    return "\n".join(l for l in lines if l)


def extract(html: str) -> tuple[str, str]:
    """Return (title, body) of the main article content."""
    meta = trafilatura.extract_metadata(html)
    title = normalise(meta.title) if meta and meta.title else ""
    body = normalise(trafilatura.extract(html, include_comments=False, include_tables=False) or "")
    return title, body


def content_hash(title: str, body: str) -> str:
    return hashlib.sha256(f"{title}\n\n{body}".encode()).hexdigest()
