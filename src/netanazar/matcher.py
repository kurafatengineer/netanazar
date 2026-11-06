import re

SNIP = 120


def find_mentions(text: str, politicians: list[dict]) -> list[dict]:
    """politicians: dicts with id, variants (list of names, Hindi+English)."""
    out = []
    for p in politicians:
        for v in sorted(p["variants"], key=len, reverse=True):
            m = re.search(rf"(?<!\w){re.escape(v)}(?!\w)", text, re.IGNORECASE)
            if m:
                s = max(0, m.start() - SNIP)
                out.append({"politician_id": p["id"], "matched_variant": v,
                            "snippet": text[s:m.end() + SNIP].replace("\n", " ")})
                break
    return out


def verify_with_llm(title, snippet, politician, api_key):
    """Optional: ask an LLM whether the snippet refers to this specific politician."""
    import httpx, json
    prompt = (f"Does this news text refer to the Indian politician {politician['name_en']} "
              f"({politician.get('party')}, {politician.get('constituency')}, {politician.get('state')})? "
              f"Title: {title}\nSnippet: {snippet}\nAnswer JSON: {{\"match\": true/false, \"confidence\": 0-1}}")
    r = httpx.post("https://api.anthropic.com/v1/messages",
                   headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                   json={"model": "claude-haiku-5-5", "max_tokens": 100,
                         "messages": [{"role": "user", "content": prompt}]}, timeout=30)
    r.raise_for_status()
    txt = r.json()["content"][0]["text"]
    d = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    return bool(d["match"]), float(d["confidence"])
