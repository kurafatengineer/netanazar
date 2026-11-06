// NetaNazar "news" function: ingest article URLs, fetch pages politely, version them, match politicians.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseHTML } from 'npm:linkedom@0.18.5';
import { Readability } from 'npm:@mozilla/readability@0.5.0';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const UA = 'NetaNazarBot/1.0 (+contact: projectnetanazar@gmail.com)';
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const norm = (s: string) => (s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const HON = new Set('shri smt dr prof sri shrimati mr mrs ms adv capt col gen'.split(' '));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function canonical(u: string): string {
  try {
    const p = new URL(u.trim()); p.hash = '';
    for (const k of [...p.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref)/.test(k)) p.searchParams.delete(k);
    p.hostname = p.hostname.toLowerCase();
    if (p.pathname.length > 1) p.pathname = p.pathname.replace(/\/+$/, '');
    return p.toString();
  } catch { return u.trim(); }
}

// ---- adaptive schedule (same rules as the Python worker) ----
function nextCheck(firstSeen: string, changed: boolean): string | null {
  const h = (Date.now() - new Date(firstSeen).getTime()) / 3.6e6;
  let iv = h < 48 ? 1 : h < 168 ? 6 : h < 720 ? 24 : h < 2160 ? 168 : null;
  if (iv === null) return null;
  if (changed) iv = Math.max(iv / 2, 0.5);
  return new Date(Date.now() + iv * 3.6e6).toISOString();
}

// ---- polite per-domain fetching ----
const lastHit = new Map<string, number>();
const robots = new Map<string, { at: number; rules: string[]; delay: number }>();
const failCount = new Map<string, number>();

async function allowed(url: string): Promise<boolean> {
  const u = new URL(url); const host = u.host;
  let r = robots.get(host);
  if (!r || Date.now() - r.at > 864e5) {
    const rules: string[] = []; let delay = 0;
    try {
      const res = await fetch(`${u.protocol}//${host}/robots.txt`, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        let applies = false;
        for (const line of (await res.text()).split(/\r?\n/)) {
          const m = line.match(/^\s*(user-agent|disallow|crawl-delay)\s*:\s*(.*?)\s*(#.*)?$/i); if (!m) continue;
          const k = m[1].toLowerCase();
          if (k === 'user-agent') applies = m[2] === '*' || /netanazar/i.test(m[2]);
          else if (applies && k === 'crawl-delay') delay = Math.max(delay, Math.min(60, parseFloat(m[2]) || 0));
          else if (applies && k === 'disallow' && m[2]) rules.push(m[2]);
        }
      }
    } catch { /* no robots => allowed */ }
    r = { at: Date.now(), rules, delay }; robots.set(host, r);
  }
  const path = u.pathname + u.search;
  return !r.rules.some((p) => path.startsWith(p.replace(/\*.*$/, '')));
}

async function politeGet(url: string, source: any, headers: Record<string, string> = {}) {
  const host = new URL(url).host;
  if (source?.is_blocked) return { skipped: 'blocked' as const };
  if (!(await allowed(url))) return { skipped: 'robots' as const };
  const delay = Math.max(source?.min_delay_seconds ?? 10, robots.get(host)?.delay ?? 0) * 1000;
  const wait = delay - (Date.now() - (lastHit.get(host) ?? 0));
  if (wait > 0) await sleep(wait);
  const t0 = Date.now(); let status: number | null = null; let text = ''; let h = new Headers();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
    status = r.status; h = r.headers; if (status !== 304) text = await r.text();
  } catch { /* timeout / network */ }
  lastHit.set(host, Date.now());
  await db.from('fetch_log').insert({ source_id: source?.id ?? null, url, http_status: status, bytes: text.length, duration_ms: Date.now() - t0 });
  if (status === 400 || status === 401 || status === 403 || status === 429 || status === 503) {
    const n = (failCount.get(host) ?? 0) + 1; failCount.set(host, n);
    if (n >= 3 && source?.id) { await db.from('sources').update({ is_blocked: true }).eq('id', source.id); if (source) source.is_blocked = true; }
  } else if (status && status < 400) failCount.set(host, 0);
  return { status, text, headers: h };
}

// ---- extraction / matching ----
function extract(html: string): { title: string; body: string } {
  const { document } = parseHTML(html);
  const art = new Readability(document as any).parse();
  const body = (art?.textContent ?? '').split(/\r?\n/).map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title: (art?.title ?? document.title ?? '').trim(), body };
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function lineDiff(a: string, b: string) {
  const A = a.split('\n'), B = b.split('\n'); const cnt = new Map<string, number>();
  for (const l of A) cnt.set(l, (cnt.get(l) ?? 0) + 1);
  const added: string[] = []; for (const l of B) { const c = cnt.get(l) ?? 0; if (c > 0) cnt.set(l, c - 1); else added.push(l); }
  const rem = new Map<string, number>(); for (const l of B) rem.set(l, (rem.get(l) ?? 0) + 1);
  const removed: string[] = []; for (const l of A) { const c = rem.get(l) ?? 0; if (c > 0) rem.set(l, c - 1); else removed.push(l); }
  return { added, removed };
}

let polCache: { at: number; rows: any[] } | null = null;
async function politicians() {
  if (polCache && Date.now() - polCache.at < 60000) return polCache.rows;
  const data: any[] = [];
  for (let from = 0; ; from += 1000) {   // Supabase returns at most 1000 rows per request
    const { data: part } = await db.from('politicians').select('id,name_en,name_hi,name_variants,party,constituency,state').neq('is_current', false).order('id').range(from, from + 999);
    data.push(...(part ?? [])); if (!part || part.length < 1000) break;
  }
  const rows = (data ?? []).map((p: any) => ({ ...p,
    variants: [p.name_en, p.name_hi, ...(p.name_variants ?? [])].filter(Boolean) }));
  polCache = { at: Date.now(), rows }; return rows;
}
let nameCount: Map<string, number> | null = null; let nameCountFor: any[] | null = null;
function countNames(pols: any[]) {
  if (nameCountFor === pols && nameCount) return nameCount;
  const m = new Map<string, number>();
  for (const p of pols) { const seen = new Set<string>(); for (const v of p.variants as string[]) { const k = norm(v).split(' ').filter((x) => !HON.has(x)).sort().join(' '); if (k && !seen.has(k)) { seen.add(k); m.set(k, (m.get(k) ?? 0) + 1); } } }
  nameCount = m; nameCountFor = pols; return m;
}
// Mentions: full-name match. When several members share the same name, the article must also mention that member's seat or state.
function findMentions(text: string, pols: any[]) {
  const t = norm(text); const words = new Set(t.split(' ')); const out: any[] = []; const counts = countNames(pols);
  for (const p of pols) {
    for (const v of p.variants as string[]) {
      const nv = norm(v); if (!nv) continue; let hit = false;
      if (/[^\u0000-\u024f\s]/.test(nv)) hit = t.includes(nv);
      else {
        const w = nv.split(' ').filter((x) => !HON.has(x) && x.length > 1);
        if (w.length < 2 || !w.every((x) => words.has(x))) continue;
        for (const o of [w, [...w].reverse()])
          if (new RegExp('(?<![\\p{L}\\p{N}_])' + o.map(esc).join('\\s+(?:[\\p{L}\\p{N}_]+\\s+)?') + '(?![\\p{L}\\p{N}_])', 'u').test(t)) { hit = true; break; }
        if (hit && (counts.get(nv.split(' ').filter((x) => !HON.has(x)).sort().join(' ')) ?? 1) > 1) {
          const seat = norm(String(p.constituency ?? '').replace(/\((sc|st)\)/gi, '')); const st = norm(String(p.state ?? ''));
          hit = (seat.length > 2 && t.includes(seat)) || (st.length > 2 && t.includes(st));
        }
      }
      if (hit) { out.push({ politician_id: p.id, matched_variant: v, party_at_mention: p.party ?? null }); break; }
    }
  }
  return out;
}

function parseFeed(xml: string) {
  const items: { url: string; title?: string; published?: string }[] = [];
  const dateOf = (blk: string) => {
    const raw = blk.match(/<(?:pubDate|published|updated|dc:date)[^>]*>\s*([^<]+?)\s*<\/(?:pubDate|published|updated|dc:date)>/i)?.[1];
    const d = raw ? new Date(raw) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : undefined;
  };
  for (const m of xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)) {
    const blk = m[0];
    const link = blk.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? blk.match(/<link[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\s]+)/i)?.[1];
    const title = blk.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/i)?.[1];
    if (link) items.push({ url: link, title: title?.trim(), published: dateOf(blk) });
  }
  for (const m of xml.matchAll(/<url>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>[\s\S]*?<\/url>/gi)) {
    const lm = m[0].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1]; const d = lm ? new Date(lm) : null;
    items.push({ url: m[1], published: d && !isNaN(d.getTime()) ? d.toISOString() : undefined });
  }
  return items;
}
async function ingest(items: { url: string; title?: string; published?: string }[], sourceId: string | null) {
  const seen = new Set<string>(); const rows: any[] = [];
  for (const it of items) { if (!/^https?:/i.test(it.url)) continue; const c = canonical(it.url); if (seen.has(c)) continue; seen.add(c);
    const pd = it.published ? new Date(it.published) : null;
    rows.push({ url: c, canonical_url: c, source_id: sourceId, title: it.title ?? null, published_at: pd && !isNaN(pd.getTime()) ? pd.toISOString() : null, next_check_at: nowIso() }); }
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await db.from('articles').upsert(rows.slice(i, i + 200), { onConflict: 'url', ignoreDuplicates: true }).select('id');
    added += data?.length ?? 0;
  }
  return added;
}

// ---- process due articles within a time budget ----
async function processDue(limit: number, budgetMs: number, sourceId?: string) {
  const t0 = Date.now(); const stats = { processed: 0, new: 0, changed: 0, same: 0, deleted: 0, unreachable: 0, skipped: 0, mentions: 0, irrelevant: 0 };
  const pols = await politicians();
  const { data: srcs } = await db.from('sources').select('*'); const byId = new Map((srcs ?? []).map((s: any) => [s.id, s]));
  let dq = db.from('articles').select('*').lte('next_check_at', nowIso()).neq('status', 'deleted');
  if (sourceId) dq = dq.eq('source_id', sourceId);
  const { data: due } = await dq.order('next_check_at', { ascending: true }).limit(limit);
  // interleave domains so one domain's delay does not stall the rest
  const q = [...(due ?? [])];
  while (q.length && Date.now() - t0 < budgetMs) {
    const idx = Math.max(0, q.findIndex((a: any) => {
      const host = new URL(a.url).host; const d = ((byId.get(a.source_id) as any)?.min_delay_seconds ?? 10) * 1000;
      return Date.now() - (lastHit.get(host) ?? 0) >= d; }));
    const a: any = q.splice(idx, 1)[0]; const src: any = byId.get(a.source_id);
    const r: any = await politeGet(a.url, src, { ...(a.etag ? { 'If-None-Match': a.etag } : {}), ...(a.last_modified ? { 'If-Modified-Since': a.last_modified } : {}) });
    const ts = nowIso(); let changed = false;
    if (r.skipped) { stats.skipped++; await db.from('articles').update({ next_check_at: new Date(Date.now() + 864e5).toISOString() }).eq('id', a.id); continue; }
    stats.processed++;
    if (r.status === 304) { stats.same++; await db.from('articles').update({ last_checked_at: ts }).eq('id', a.id); }
    else if (r.status === 200) {
      const { title, body } = extract(r.text); const h = await sha256(title + '\n\n' + body);
      const base = { last_checked_at: ts, etag: r.headers.get('etag'), last_modified: r.headers.get('last-modified'), status: 'active', deleted_at: null, last_gone_at: null };
      const ms = body ? findMentions(title + '\n' + body, pols) : [];
      if (!body) { stats.unreachable++; await db.from('articles').update({ last_checked_at: ts }).eq('id', a.id); }
      else if (!ms.length && !a.current_hash) {   // no politician named: keep only the link record, nothing else
        stats.irrelevant++; await db.from('articles').update({ status: 'irrelevant', last_checked_at: ts, next_check_at: null, title: title || a.title }).eq('id', a.id); continue;
      }
      else if (a.current_hash === h) { stats.same++; await db.from('articles').update(base).eq('id', a.id); }
      else {
        const { data: prev } = await db.from('article_versions').select('version_no,body_text').eq('article_id', a.id).order('version_no', { ascending: false }).limit(1);
        const vno = (prev?.[0]?.version_no ?? 0) + 1;
        const diff = prev?.[0] ? lineDiff(prev[0].body_text ?? '', body) : null;
        await db.from('article_versions').insert({ article_id: a.id, version_no: vno, title, body_text: body, content_hash: h,
          diff_from_previous: diff, added_lines: diff ? diff.added.length : null, removed_lines: diff ? diff.removed.length : null });
        await db.from('articles').update({ ...base, title, current_hash: h }).eq('id', a.id);
        changed = vno > 1; if (changed) stats.changed++; else stats.new++;
        if (ms.length) { stats.mentions += ms.length;
          await db.from('mentions').upsert(ms.map((m) => ({ article_id: a.id, ...m })), { onConflict: 'article_id,politician_id', ignoreDuplicates: true }); }
      }
    } else if (r.status === 404 || r.status === 410) {
      if (a.last_gone_at) { stats.deleted++; await db.from('articles').update({ status: 'deleted', deleted_at: ts, last_checked_at: ts }).eq('id', a.id); continue; }
      await db.from('articles').update({ last_gone_at: ts, last_checked_at: ts, next_check_at: new Date(Date.now() + 36e5).toISOString() }).eq('id', a.id); continue;
    } else { stats.unreachable++; await db.from('articles').update({ status: 'unreachable', last_checked_at: ts }).eq('id', a.id); }
    await db.from('articles').update({ next_check_at: nextCheck(a.first_seen_at, changed) }).eq('id', a.id);
  }
  let cq = db.from('articles').select('id', { count: 'exact', head: true }).lte('next_check_at', nowIso()).neq('status', 'deleted');
  if (sourceId) cq = cq.eq('source_id', sourceId);
  const { count } = await cq;
  return { ...stats, remaining: count ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const token = (Deno.env.get('REGISTRY_TOKEN') ?? '').trim();
  if (!token || (req.headers.get('x-token') ?? '').trim() !== token) return json({ error: 'forbidden', secret_set: !!token }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const a = url.searchParams.get('action');
      if (a === 'sources') { const { data } = await db.from('sources').select('id,domain,name,rss_urls,sitemap_url,is_blocked,min_delay_seconds').order('name'); return json({ rows: data }); }
      if (a === 'articles') {
        const { data } = await db.from('articles').select('id,title,url,status,first_seen_at,deleted_at,last_checked_at,article_versions(count),mentions(politician_id,party_at_mention,politicians(name_en))')
          .order('first_seen_at', { ascending: false }).limit(200);
        return json({ rows: data });
      }
      if (a === 'article') {
        const id = url.searchParams.get('id')!;
        const { data } = await db.from('article_versions').select('version_no,title,body_text,captured_at').eq('article_id', id).order('version_no');
        return json({ rows: data });
      }
      if (a === 'overview') {
        const c = async (f: (q: any) => any) => { const { count } = await f(db.from('articles').select('id', { count: 'exact', head: true })); return count ?? 0; };
        const { count: mentions } = await db.from('mentions').select('id', { count: 'exact', head: true });
        const { count: versions } = await db.from('article_versions').select('id', { count: 'exact', head: true });
        return json({ articles: { relevant: await c((q) => q.in('status', ['active', 'deleted', 'unreachable']).not('current_hash', 'is', null)),
          waiting: await c((q) => q.lte('next_check_at', nowIso()).neq('status', 'deleted')), irrelevant: await c((q) => q.eq('status', 'irrelevant')),
          deleted: await c((q) => q.eq('status', 'deleted')) }, mentions: mentions ?? 0, versions: versions ?? 0 });
      }
      if (a === 'stats') {
        const { data } = await db.from('fetch_log').select('url,fetched_at').gte('fetched_at', new Date(Date.now() - 864e5).toISOString()).limit(20000);
        const c: Record<string, number> = {}; for (const l of data ?? []) { const h = new URL(l.url).host; c[h] = (c[h] ?? 0) + 1; }
        return json({ requests_last_24h: c });
      }
      return json({ error: 'unknown action' }, 400);
    }
    const b = await req.json();
    if (b.action === 'ingest') return json({ added: await ingest(b.items ?? [], b.source_id ?? null) });
    if (b.action === 'fetchfeed') {   // server-side fallback when the browser cannot read a feed
      const { data: s } = await db.from('sources').select('*').eq('id', b.source_id).single();
      if (!s || s.is_blocked) return json({ added: 0, skipped: 'blocked' });
      let items: any[] = [];
      for (const u of [...(s.rss_urls ?? []), ...(s.sitemap_url ? [s.sitemap_url] : [])]) {
        const r: any = await politeGet(u, s); if (r.status === 200) items = items.concat(parseFeed(r.text));
      }
      // Fingerprint of the list of links in the feed: if it is identical to last time (and we already hold articles), nothing is new.
      const key = 'feed:' + s.id; const fp = await sha256(items.map((i) => canonical(i.url)).sort().join('\n'));
      const { data: prev } = await db.from('source_hashes').select('hash').eq('key', key).maybeSingle();
      const { count: have } = await db.from('articles').select('id', { count: 'exact', head: true }).eq('source_id', s.id);
      if (items.length && prev?.hash === fp && (have ?? 0) > 0) { await db.from('source_hashes').update({ checked_at: nowIso() }).eq('key', key); return json({ added: 0, found: items.length, unchanged: true }); }
      const added = await ingest(items, s.id);
      if (items.length) await db.from('source_hashes').upsert({ key, hash: fp, item_count: items.length, checked_at: nowIso(), changed_at: nowIso() }, { onConflict: 'key' });
      return json({ added, found: items.length, unchanged: false });
    }
    if (b.action === 'add_source') {
      const rss = String(b.rss_url ?? '').trim(); let host = ''; try { host = new URL(rss).host.replace(/^www\./, ''); } catch { return json({ error: 'Enter a valid RSS address starting with https://' }, 400); }
      const row = { domain: String(b.domain ?? host).trim().toLowerCase(), name: String(b.name ?? host).trim(), rss_urls: [rss], min_delay_seconds: 3, is_blocked: false };
      const { data, error } = await db.from('sources').upsert(row, { onConflict: 'domain' }).select('id').single();
      return error ? json({ error: error.message }, 500) : json({ id: data.id });
    }
    if (b.action === 'unblock_source') { await db.from('sources').update({ is_blocked: false }).eq('id', b.source_id); return json({ ok: true }); }
    if (b.action === 'process') return json(await processDue(Math.min(b.limit ?? 30, 60), 100000, b.source_id ?? undefined));
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
