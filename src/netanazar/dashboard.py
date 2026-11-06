"""Simple dashboard. Run: flask --app netanazar.dashboard run"""
import difflib, html
from flask import Flask, request, render_template_string
from .db import DB

app = Flask(__name__)
db = DB()

BASE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>NetaNazar</title><style>
body{font:15px system-ui;max-width:960px;margin:1rem auto;padding:0 1rem}
.del{background:#b00020;color:#fff;padding:2px 8px;border-radius:4px}
ins{background:#c8f7c5;text-decoration:none}del{background:#f9c0c0}
.v{border-top:1px solid #ccc;margin-top:1rem;padding-top:.5rem}
table{border-collapse:collapse;width:100%}td,th{padding:4px 8px;border-bottom:1px solid #eee;text-align:left}
</style><h1><a href="/">NetaNazar</a> · <a href="/stats">Fetch stats</a></h1>{{ body|safe }}"""


def page(body):
    return render_template_string(BASE, body=body)


def inline_diff(old, new):
    a, b = old.split(), new.split()
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if op == "equal":
            out.append(html.escape(" ".join(a[i1:i2])))
        else:
            if i2 > i1:
                out.append("<del>" + html.escape(" ".join(a[i1:i2])) + "</del>")
            if j2 > j1:
                out.append("<ins>" + html.escape(" ".join(b[j1:j2])) + "</ins>")
    return " ".join(out)


@app.get("/")
def index():
    pols = db.select("politicians", order="name_en.asc")
    f = {"order": "first_seen_at.desc", "limit": 100, "select": "id,title,url,status,first_seen_at,deleted_at"}
    pid = request.args.get("politician")
    if request.args.get("status"):
        f["status"] = "eq." + request.args["status"]
    if request.args.get("q"):
        f["title"] = "ilike.*" + request.args["q"] + "*"
    if pid:
        ids = [m["article_id"] for m in db.select("mentions", politician_id=f"eq.{pid}", select="article_id")]
        f["id"] = "in.(" + ",".join(ids) + ")" if ids else "eq.00000000-0000-0000-0000-000000000000"
    arts = db.select("articles", **f)
    opts = "".join(f'<option value="{p["id"]}"{" selected" if p["id"]==pid else ""}>{html.escape(p["name_en"])}</option>' for p in pols)
    rows = "".join(
        f'<tr><td><a href="/article/{a["id"]}">{html.escape(a["title"] or a["url"])}</a></td>'
        f'<td>{a["first_seen_at"][:16]}</td><td>{"<span class=del>DELETED</span>" if a["status"]=="deleted" else a["status"]}</td></tr>'
        for a in arts)
    return page(f'<form><select name=politician><option value="">All politicians</option>{opts}</select> '
                f'<select name=status><option value="">Any status</option><option>active</option><option>deleted</option><option>unreachable</option></select> '
                f'<input name=q placeholder="title contains" value="{html.escape(request.args.get("q",""))}"> <button>Filter</button></form>'
                f'<table><tr><th>Article<th>First seen<th>Status</tr>{rows}</table>')


@app.get("/article/<aid>")
def article(aid):
    a = db.select("articles", id=f"eq.{aid}")[0]
    vs = db.select("article_versions", article_id=f"eq.{aid}", order="version_no.asc")
    badge = f' <span class=del>DELETED on {a["deleted_at"][:19].replace("T"," ")} UTC</span>' if a["status"] == "deleted" else ""
    out = f'<h2>{html.escape(a["title"] or "")}{badge}</h2><p><a href="{html.escape(a["url"])}">{html.escape(a["url"])}</a>'
    if a.get("wayback_url"):
        out += f' · <a href="{html.escape(a["wayback_url"])}">Wayback</a>'
    out += "</p>"
    for i, v in enumerate(vs):
        when = v["captured_at"][:19].replace("T", " ") + " UTC"
        if i == 0:
            out += f'<div class=v><b>Original (v1) · {when}</b><p>{html.escape(v["body_text"] or "").replace(chr(10),"<br>")}</p></div>'
        else:
            out += f'<div class=v><b>v{v["version_no"]} · changed {when}</b><p>{inline_diff(vs[i-1]["body_text"] or "", v["body_text"] or "")}</p></div>'
    return page(out)


@app.get("/politician/<pid>")
def timeline(pid):
    ms = db.select("mentions", politician_id=f"eq.{pid}", order="created_at.desc", limit=200,
                   select="snippet,created_at,articles(id,title,status)")
    rows = "".join(f'<tr><td>{m["created_at"][:16]}<td><a href="/article/{m["articles"]["id"]}">{html.escape(m["articles"]["title"] or "")}</a>'
                   f'<br><small>{html.escape(m["snippet"] or "")}</small></tr>' for m in ms)
    return page(f"<h2>Timeline</h2><table>{rows}</table>")


@app.get("/stats")
def stats():
    logs = db.select("fetch_log", order="fetched_at.desc", limit=5000, select="source_id,fetched_at,url")
    from collections import Counter
    from urllib.parse import urlparse
    c = Counter((l["fetched_at"][:10], urlparse(l["url"]).netloc) for l in logs)
    rows = "".join(f"<tr><td>{d}<td>{dom}<td>{n}</tr>" for (d, dom), n in sorted(c.items(), reverse=True))
    return page(f"<h2>Daily requests per domain</h2><table><tr><th>Date<th>Domain<th>Requests</tr>{rows}</table>")
