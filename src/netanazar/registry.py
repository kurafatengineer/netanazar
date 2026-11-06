"""Politician registry: import from Wikidata (sent by the user's browser) and
cross-check against official pages the user opens and sends via the bookmarklet."""
import re, unicodedata

HONORIFICS = {"shri", "smt", "dr", "prof", "sri", "shrimati", "mr", "mrs", "ms", "adv", "capt", "col", "gen"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").lower()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", s)).strip()


def tokens(name: str) -> list[str]:
    return [t for t in norm(name).split() if t not in HONORIFICS and len(t) > 1]


def name_in_text(name_en, name_hi, text_norm: str, text_raw: str) -> bool:
    """English: tokens in order (one extra word allowed) or reversed ('Last, First').
    Hindi: exact substring."""
    if name_hi and norm(name_hi) in text_norm:
        return True
    t = tokens(name_en or "")
    if len(t) < 2:
        return False
    gap = r"\s+(?:\w+\s+)?"
    for order in (t, t[::-1]):
        if re.search(r"(?<!\w)" + gap.join(map(re.escape, order)) + r"(?!\w)", text_norm):
            return True
    return False


def check_page(politicians: list[dict], text: str) -> dict[str, bool]:
    n = norm(text)
    return {p["id"]: name_in_text(p["name_en"], p.get("name_hi"), n, text) for p in politicians}


def upsert_politicians(db, incoming: list[dict]) -> dict:
    """incoming: qid, name_en, name_hi, party, constituency, state, house, x_handle, youtube_channel_id."""
    existing = db.select("politicians")
    by_qid = {p["wikidata_id"]: p for p in existing if p.get("wikidata_id")}
    by_name = {norm(p["name_en"]): p for p in existing}
    new, updated = [], 0
    for r in incoming:
        row = {k: r.get(k) for k in ("name_en", "name_hi", "party", "constituency", "state", "house",
                                     "x_handle", "youtube_channel_id") if r.get(k)}
        row["wikidata_id"] = r["qid"]
        cur = by_qid.get(r["qid"]) or by_name.get(norm(r["name_en"]))
        if cur:
            db.update("politicians", row, id=f"eq.{cur['id']}")
            updated += 1
        else:
            row.setdefault("house", "Lok Sabha")
            new.append(row)
            by_name[norm(r["name_en"])] = row
    for i in range(0, len(new), 200):
        db.insert("politicians", new[i:i + 200], on_conflict="wikidata_id", ignore_duplicates=True)
    return {"inserted": len(new), "updated": updated}


def save_checks(db, source: str, results: dict[str, bool]):
    rows = [{"politician_id": pid, "source": source, "found": f} for pid, f in results.items()]
    for i in range(0, len(rows), 500):
        db.insert("registry_checks", rows[i:i + 500], on_conflict="politician_id,source")
