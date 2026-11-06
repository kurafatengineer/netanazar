import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const norm = (s: string) => (s || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Supabase returns at most 1000 rows per request, so read in pages.
async function all(table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}


// ---- official list import (Lok Sabha / Rajya Sabha members from sansad.in) ----
const HONS = new Set(['shri', 'smt', 'sri', 'dr', 'prof', 'adv', 'kumari', 'kum', 'sh', 'shrimati', 'capt', 'col', 'lt', 'gen', 'maj', 'er', 'ms', 'mr', 'mrs', 'sushri', 'late']);
const toks = (s: string) => norm(s).split(' ').filter((t) => t && !HONS.has(t));
const keyAll = (s: string) => toks(s).sort().join(' ');
const keyLoose = (s: string) => { const t = toks(s).filter((x) => x.length > 1).sort(); return t.length >= 2 ? t.join(' ') : ''; };
const seatKey = (s: string) => norm((s || '').replace(/\((sc|st)\)/ig, ' ').replace(/lok sabha constituency|assembly constituency|constituency/ig, ' '));


const UA = 'NetaNazarBot/1.0 (+contact: projectnetanazar@gmail.com)';
const HON_RE = /^(shri|smt|sri|dr|prof|adv|kumari|kum|sh|shrimati|sushri|capt|col|lt|gen|maj|er|ms|mr|mrs|late)\.?$/i;
const HON_HI = new Set(['श्री', 'श्रीमती', 'सुश्री', 'डा.', 'डा', 'डॉ.', 'डॉ', 'प्रो.', 'प्रो', 'कुमारी', 'सर्वश्री', 'श्रीमति']);
const swapName = (raw: string, isHon: (w: string) => boolean) => {
  const parts = String(raw ?? '').replace(/\s+/g, ' ').trim().split(',').map((x) => x.trim()).filter(Boolean);
  const strip = (t: string) => t.split(' ').filter((w) => w && !isHon(w)).join(' ').trim();
  return parts.length >= 2 ? (strip(parts.slice(1).join(' ')) + ' ' + strip(parts[0])).trim() : strip(parts[0] ?? '');
};
const cleanEn = (raw: string) => swapName(raw, (w) => HON_RE.test(w));
const cleanHi = (raw: string) => swapName(raw, (w) => HON_HI.has(w));
const tidy = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`sansad.in answered ${r.status}`);
  return await r.json();
}
// Public member lists from sansad.in (the same data its own pages show). Only public role details are kept.
async function officialRows(house: string) {
  if (house === 'Lok Sabha') {
    const en = await getJson('https://sansad.in/api_ls/member?loksabha=18&sitting=1&locale=en&page=1&size=700');
    await sleep(1500);
    const hi = await getJson('https://sansad.in/api_ls/member?loksabha=18&sitting=1&locale=hi&page=1&size=700');
    const list: any[] = en.membersDtoList ?? [];
    if (list.length < 400 || list.length !== en.metaDatasDto?.totalElements) throw new Error(`Unexpected Lok Sabha list size (${list.length}); nothing imported`);
    const hiBy = new Map((hi.membersDtoList ?? []).map((m: any) => [m.mpsno, tidy(m.mpFirstLastName)]));
    return list.map((m) => ({ official_id: `LS:${m.mpsno}`, name: tidy(m.mpFirstLastName), rawName: tidy(m.mpLastFirstName), name_hi: hiBy.get(m.mpsno) || undefined,
      party: tidy(m.partySname), constituency: tidy(m.constName), state: tidy(m.stateName), status: 'SITTING' }));
  }
  const rs = await getJson('https://sansad.in/api_rs/member/sitting-members?mpFlag=1&page=1&size=400&locale=en');
  const list: any[] = rs.records ?? [];
  if (list.length < 200 || list.length !== rs._metadata?.totalElements) throw new Error(`Unexpected Rajya Sabha list size (${list.length}); nothing imported`);
  return list.map((m) => ({ official_id: `RS:${m.mpsno}`, name: cleanEn(m.name), rawName: tidy(m.name), name_hi: cleanHi(m.hname) || undefined,
    party: tidy(m.partyCode), constituency: '', state: tidy(m.state), status: 'SITTING' }));
}

async function importOfficial(house: string, rows: any[], markStale: boolean) {
  const existing = (await all('politicians', 'id,name_en,name_hi,name_variants,house,constituency,state,source,is_current,official_id')).filter((p) => p.house === house);
  const exact = new Map<string, any>(), loose = new Map<string, any>(), seat = new Map<string, any[]>(), byId = new Map<string, any>();
  for (const p of existing) {
    if (p.official_id) byId.set(p.official_id, p);
    for (const n of [p.name_en, ...(p.name_variants ?? [])].filter(Boolean)) {
      exact.set(keyAll(n), p); const kl = keyLoose(n); if (kl) loose.set(kl, p);
    }
    if (p.constituency) { const k = seatKey(p.constituency); if (k) seat.set(k, [...(seat.get(k) ?? []), p]); }
  }
  const used = new Set<string>(); const updates: { id: string; v: Record<string, unknown> }[] = []; const fresh: Record<string, unknown>[] = [];
  const how = { id: 0, exact: 0, loose: 0, seat: 0 };
  for (const r of rows) {
    const name = String(r.name ?? '').trim(); if (!name) continue;
    let cur = r.official_id ? byId.get(r.official_id) : undefined; let m: 'id' | 'exact' | 'loose' | 'seat' = 'id';
    if (!cur || used.has(cur.id)) { cur = exact.get(keyAll(name)); m = 'exact'; }
    if (!cur || used.has(cur.id)) { cur = loose.get(keyLoose(name)); m = 'loose'; }
    if ((!cur || used.has(cur.id)) && r.constituency) {
      const c = (seat.get(seatKey(r.constituency)) ?? []).filter((p) => !used.has(p.id));
      cur = c.length === 1 ? c[0] : undefined; m = 'seat';
    }
    const v: Record<string, unknown> = { name_en: name, house, source: 'official', is_current: true, imported_at: new Date().toISOString() };
    if (r.official_id) v.official_id = r.official_id; if (r.name_hi) v.name_hi = r.name_hi; if (r.party) v.party = r.party; if (r.constituency) v.constituency = r.constituency; if (r.state) v.state = r.state; if (r.status) v.official_status = r.status;
    if (cur && !used.has(cur.id)) {
      used.add(cur.id); how[m]++;
      const variants = new Set<string>([...(cur.name_variants ?? [])]); if (cur.name_en && norm(cur.name_en) !== norm(name)) variants.add(cur.name_en);
      if (r.rawName && norm(r.rawName) !== norm(name)) variants.add(String(r.rawName));
      if (cur.name_hi && r.name_hi && norm(cur.name_hi) !== norm(r.name_hi)) variants.add(cur.name_hi);
      v.name_variants = [...variants]; updates.push({ id: cur.id, v });
    } else { v.name_variants = r.rawName && norm(r.rawName) !== norm(name) ? [String(r.rawName)] : []; fresh.push(v); }
  }
  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(updates.slice(i, i + 20).map((u) => db.from('politicians').update(u.v).eq('id', u.id)));
  }
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await db.from('politicians').insert(fresh.slice(i, i + 200)); if (error) throw new Error(error.message);
  }
  let stale = 0; const staleSample: string[] = [];
  if (markStale && rows.length >= 20) {
    const old = existing.filter((p) => !used.has(p.id) && p.source !== 'official' && p.is_current !== false);
    for (let i = 0; i < old.length; i += 100) await db.from('politicians').update({ is_current: false }).in('id', old.slice(i, i + 100).map((p) => p.id));
    stale = old.length; staleSample.push(...old.slice(0, 8).map((p) => p.name_en));
  }
  return { house, official_rows: rows.length, matched: used.size, matched_by: how, inserted: fresh.length, marked_former: stale, former_examples: staleSample };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const token = (Deno.env.get('REGISTRY_TOKEN') ?? '').trim();
  const given = (req.headers.get('x-token') ?? '').trim();
  if (!token || given !== token) return json({ error: 'forbidden', secret_set: !!token, secret_length: token.length, token_length_you_sent: given.length }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'politicians') return json({ rows: await all('politicians', 'id,name_en,name_hi,party,house,constituency,state,wikidata_id,is_current,source') });
      if (action === 'checks') return json({ rows: await all('registry_checks', 'id,politician_id,source,found') });
      return json({ error: 'unknown action' }, 400);
    }
    const body = await req.json();
    if (body.action === 'wikidata') {
      const existing = await all('politicians', 'id,name_en,wikidata_id');
      const byQid = new Map(existing.filter((p) => p.wikidata_id).map((p) => [p.wikidata_id, p]));
      const byName = new Map(existing.map((p) => [norm(p.name_en), p]));
      let updated = 0; const fresh: Record<string, unknown>[] = []; const seen = new Set<string>();
      for (const r of body.rows as Record<string, string>[]) {
        if (seen.has(r.qid)) continue; seen.add(r.qid);
        const row: Record<string, unknown> = { wikidata_id: r.qid };
        for (const k of ['name_en', 'name_hi', 'party', 'constituency', 'state', 'house', 'x_handle', 'youtube_channel_id']) if (r[k]) row[k] = r[k];
        const cur = byQid.get(r.qid) ?? byName.get(norm(r.name_en));
        if (cur) { await db.from('politicians').update(row).eq('id', cur.id); updated++; }
        else { row.house ??= 'Lok Sabha'; fresh.push(row); byName.set(norm(r.name_en), { id: '', name_en: r.name_en, wikidata_id: r.qid }); }
      }
      for (let i = 0; i < fresh.length; i += 200) {
        const { error } = await db.from('politicians').upsert(fresh.slice(i, i + 200), { onConflict: 'wikidata_id', ignoreDuplicates: true });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ inserted: fresh.length, updated });
    }
    if (body.action === 'official_fetch') {
      if (!['Lok Sabha', 'Rajya Sabha'].includes(body.house)) return json({ error: 'house must be Lok Sabha or Rajya Sabha' }, 400);
      const rows = await officialRows(body.house);
      return json({ source: 'sansad.in', ...(await importOfficial(body.house, rows, body.mark_stale !== false)) });
    }
    if (body.action === 'official') {
      if (!['Lok Sabha', 'Rajya Sabha'].includes(body.house)) return json({ error: 'house must be Lok Sabha or Rajya Sabha' }, 400);
      return json(await importOfficial(body.house, body.rows ?? [], body.mark_stale !== false));
    }
    if (body.action === 'checks') {
      const rows = Object.entries(body.results as Record<string, boolean>).map(([pid, found]) => ({ politician_id: pid, source: body.source, found }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('registry_checks').upsert(rows.slice(i, i + 500), { onConflict: 'politician_id,source' });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ saved: rows.length });
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
