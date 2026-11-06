"""Simple dashboard. Run: flask --app netanazar.dashboard run"""
import difflib, html
import os
from flask import Flask, request, render_template_string, jsonify, abort
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
</style><h1><a href="/">NetaNazar</a> · <a href="/stats">Fetch stats</a> · <a href="/registry">Registry</a></h1>{{ body|safe }}"""


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


# ---------------- Registry (human-click data refresh) ----------------
from . import registry

SOURCES = {
    "loksabha": ("Lok Sabha (sansad.in)", "https://sansad.in/ls/members"),
    "loksabha_nic": ("Lok Sabha (loksabha.nic.in)", "https://loksabha.nic.in/Members/AlphabeticalList.aspx"),
    "rajyasabha": ("Rajya Sabha (rajyasabha.nic.in)", "https://rajyasabha.nic.in/Members/Alphabetical"),
    "eci": ("ECI results", "https://results.eci.gov.in/"),
    "myneta": ("MyNeta", "https://www.myneta.info/"),
    "prs": ("PRS India MP Track", "https://prsindia.org/mptrack"),
    "delhi": ("Delhi Assembly", "https://delhiassembly.delhi.gov.in/"),
}


def need_token():
    tok = os.environ.get("REGISTRY_TOKEN", "")
    given = request.headers.get("X-Token") or request.form.get("token", "")
    if not tok or given != tok:
        abort(403)


@app.post("/api/registry/wikidata")
def api_wikidata():
    need_token()
    return jsonify(registry.upsert_politicians(db, request.get_json()["rows"]))


@app.post("/api/registry/page")
def api_page():
    """Receives page text from the bookmarklet (a normal form POST, so no CORS needed)."""
    need_token()
    src = request.form["source"]
    if src not in SOURCES:
        abort(400)
    pols = db.select("politicians", select="id,name_en,name_hi")
    res = registry.check_page(pols, request.form["text"][:3_000_000])
    registry.save_checks(db, src, res)
    found = sum(res.values())
    return page(f"<h2>{html.escape(SOURCES[src][0])}</h2><p>Matched <b>{found}</b> of {len(res)} politicians "
                f'on this page.</p><p><a href="/registry">Back to Registry</a></p>')


@app.get("/registry")
def registry_page():
    pols = db.select("politicians", select="id,name_en,party,house,wikidata_id", order="name_en.asc", limit=2000)
    checks = db.select("registry_checks", select="politician_id,source,found", limit=20000)
    got = {(c["politician_id"], c["source"]): c["found"] for c in checks}
    head = "".join(f"<th>{html.escape(v[0])}" for v in SOURCES.values())
    rows = "".join(
        f"<tr><td>{html.escape(p['name_en'])}<td>{html.escape(p.get('party') or '')}<td>{p['house']}"
        + "".join("<td>" + {True: "✅", False: "❌", None: "–"}[got.get((p["id"], k))] for k in SOURCES)
        + "</tr>" for p in pols[:500])
    links = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{html.escape(n)}</a> ({k})</li>'
                    for k, (n, u) in SOURCES.items())
    return page(REGISTRY_HTML.replace("{{LINKS}}", links).replace("{{HEAD}}", head).replace("{{ROWS}}", rows)
                .replace("{{COUNT}}", str(len(pols))))


REGISTRY_HTML = """
<h2>Registry</h2><p>Token: <input id=tok type=password placeholder="REGISTRY_TOKEN"> (saved in this browser only)</p>
<h3>1. Wikidata (runs in your browser)</h3>
<button onclick="wd()">Fetch MPs / MLAs from Wikidata</button> <span id=wdst></span>
<h3>2. Official pages (you open them, then click the bookmarklet)</h3>
<p>Drag this to your bookmarks bar: <a id=bm href="#">Send to NetaNazar</a>. Open a source page below, wait for it to load fully,
click the bookmark, pick the source key. The page text is sent here and matched against {{COUNT}} politicians.</p><ul>{{LINKS}}</ul>
<h3>3. Match results</h3>
<table><tr><th>Name<th>Party<th>House{{HEAD}}</tr>{{ROWS}}</table>
<script>
const tok=document.getElementById('tok'); tok.value=localStorage.getItem('nn_tok')||'';
tok.onchange=()=>{localStorage.setItem('nn_tok',tok.value);bm()};
function bm(){const o=location.origin;
 const js="javascript:(function(){var s=prompt('Source key (loksabha, loksabha_nic, rajyasabha, eci, myneta, prs, delhi):');if(!s)return;"+
 "var f=document.createElement('form');f.method='POST';f.action='"+o+"/api/registry/page';f.target='_blank';"+
 "[['source',s],['token','"+tok.value+"'],['text',document.body.innerText]].forEach(function(p){var i=document.createElement('textarea');i.name=p[0];i.value=p[1];f.appendChild(i)});"+
 "document.body.appendChild(f);f.submit();})()";
 document.getElementById('bm').href=js;}
bm();
const Q={ // position labels as on Wikidata; adjust here if a count looks wrong
 'Lok Sabha':['member of the 18th Lok Sabha'],
 'Rajya Sabha':['member of the Rajya Sabha'],
 'State Assembly':['member of the Delhi Legislative Assembly']};
async function wd(){
 const st=document.getElementById('wdst'); let all=[];
 for(const [house,labels] of Object.entries(Q)){
  st.textContent='Fetching '+house+'…';
  const vals=labels.map(l=>'"'+l+'"@en').join(' ');
  const q=`SELECT ?p ?en ?hi ?partyL ?distL ?stateL ?x ?yt WHERE{
   VALUES ?pl {${vals}} ?pos rdfs:label ?pl .
   ?p p:P39 ?st . ?st ps:P39 ?pos . FILTER NOT EXISTS{?st pq:P582 ?end}
   ?p rdfs:label ?en FILTER(LANG(?en)="en")
   OPTIONAL{?p rdfs:label ?hi FILTER(LANG(?hi)="hi")}
   OPTIONAL{?p wdt:P102 ?party . ?party rdfs:label ?partyL FILTER(LANG(?partyL)="en")}
   OPTIONAL{?st pq:P768 ?d . ?d rdfs:label ?distL FILTER(LANG(?distL)="en")}
   OPTIONAL{?p wdt:P2002 ?x} OPTIONAL{?p wdt:P2397 ?yt}}`;
  const r=await fetch('https://query.wikidata.org/sparql?format=json&query='+encodeURIComponent(q));
  if(!r.ok){st.textContent='Wikidata error '+r.status;return}
  const j=await r.json();
  for(const b of j.results.bindings) all.push({qid:b.p.value.split('/').pop(),name_en:b.en.value,
   name_hi:b.hi&&b.hi.value,party:b.partyL&&b.partyL.value,constituency:b.distL&&b.distL.value,
   house,x_handle:b.x&&b.x.value,youtube_channel_id:b.yt&&b.yt.value});
 }
 st.textContent='Saving '+all.length+' rows…';
 const r2=await fetch('/api/registry/wikidata',{method:'POST',headers:{'Content-Type':'application/json','X-Token':tok.value},body:JSON.stringify({rows:all})});
 st.textContent=r2.ok?('Done: '+JSON.stringify(await r2.json())+' — reload to see results'):('Save failed '+r2.status);
}
</script>"""
