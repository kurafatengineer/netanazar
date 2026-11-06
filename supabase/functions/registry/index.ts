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
    const mins = await ministerMap('LS');
    return list.map((m) => ({ official_id: `LS:${m.mpsno}`, name: tidy(m.mpFirstLastName), rawName: tidy(m.mpLastFirstName), name_hi: hiBy.get(m.mpsno) || undefined,
      party: tidy(m.partySname), constituency: tidy(m.constName), state: tidy(m.stateName), status: 'SITTING',
      photo_url: m.imageUrl || undefined, gender: tidy(m.gender) || undefined, terms_count: m.noOfTerms ?? undefined,
      lok_sabha_terms: String(m.lsExpr ?? '').split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0),
      term_label: m.lastLoksabha ? `${m.lastLoksabha}th Lok Sabha` : undefined, minister_position: mins.get(String(m.mpsno)) }));
  }
  const rs = await getJson('https://sansad.in/api_rs/member/sitting-members?mpFlag=1&page=1&size=400&locale=en');
  const list: any[] = rs.records ?? [];
  if (list.length < 200 || list.length !== rs._metadata?.totalElements) throw new Error(`Unexpected Rajya Sabha list size (${list.length}); nothing imported`);
  const mins = await ministerMap('RS');
  return list.map((m) => ({ official_id: `RS:${m.mpsno}`, name: cleanEn(m.name), rawName: tidy(m.name), name_hi: cleanHi(m.hname) || undefined,
    party: tidy(m.partyCode), constituency: '', state: tidy(m.state), status: 'SITTING',
    photo_url: m.imageUrl || undefined, gender: tidy(m.gender) || undefined, terms_count: m.termCount ?? undefined,
    term_label: tidy(m.term) || undefined, term_start: isoDate(m.notificationDate), term_end: isoDate(m.expirationDate),
    minister_position: mins.get(String(m.mpsno)) }));
}


const isoDate = (d: unknown) => { const m = String(d ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined; };
// Current ministers (public): mpsno -> position, per house
async function ministerMap(house: 'LS' | 'RS') {
  const out = new Map<string, string>();
  try {
    await sleep(1000);
    const list = await getJson('https://sansad.in/api_ls/member/getInCouncilOfMinisters');
    for (const m of Array.isArray(list) ? list : []) if (m.house === house && m.mpsno) out.set(String(m.mpsno), tidy(m.position));
  } catch { /* optional */ }
  return out;
}
const stripHtml = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// Attendance for the current Lok Sabha: one request per session (all members at once)
async function officialAttendance() {
  const sess = await getJson('https://sansad.in/api_ls/business/getAllLoksabhaAndSession');
  const ls = (Array.isArray(sess) ? sess : []).find((x: any) => x.loksabha === 18);
  if (!ls) throw new Error('Lok Sabha 18 sessions not found');
  const pols = (await all('politicians', 'id,official_id')).filter((p) => String(p.official_id ?? '').startsWith('LS:'));
  if (!pols.length) throw new Error('Load the Lok Sabha member list first');
  const byMps = new Map(pols.map((p) => [String(p.official_id).slice(3), p.id]));
  const rowMap = new Map<string, any>(); let sessions = 0;
  for (const s of ls.sessions ?? []) {
    await sleep(1200);
    const mem = await getJson(`https://sansad.in/api_ls/member/getMemberAttendanceMemberWise?loksabha=18&session=${s.sessionNo}`);
    if (!Array.isArray(mem) || !mem.length) continue; sessions++;
    const total = (s.dates ?? []).length; const period = (s.sessionPeriod ?? [])[0] ?? null;
    for (const m of mem) { const pid = byMps.get(String(m.mpsno)); if (pid) rowMap.set(`${pid}|${s.sessionNo}`, { politician_id: pid, house: 'Lok Sabha', loksabha: 18, session_no: s.sessionNo, session_period: period, sitting_days: total, signed_days: m.signedDaysCount ?? 0, fetched_at: new Date().toISOString() }); }
  }
  const rows = [...rowMap.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('attendance').upsert(rows.slice(i, i + 500), { onConflict: 'politician_id,loksabha,session_no' }); if (error) throw new Error(error.message);
  }
  return { sessions, rows: rows.length };
}

// Positions held ("Elected to 18th Lok Sabha", committees, ministries…): one request per member, in small batches.
// onlyStale: only members never loaded or older than 7 days. New positions found on a later run are flagged with added_at.
async function officialDetails(house: string, limit: number, onlyStale: boolean, offset: number) {
  const prefix = house === 'Lok Sabha' ? 'LS:' : 'RS:';
  const everyone = (await all('politicians', 'id,official_id,details_fetched_at,positions_held')).filter((p) => String(p.official_id ?? '').startsWith(prefix));
  const staleBefore = Date.now() - 7 * 864e5;
  const todo = onlyStale ? everyone.filter((p) => !p.details_fetched_at || new Date(p.details_fetched_at).getTime() < staleBefore) : everyone;
  const slice = onlyStale ? todo.slice(0, limit) : todo.slice(offset, offset + limit);
  let done = 0, failed = 0, newPositions = 0;
  for (const p of slice) {
    const code = String(p.official_id).slice(3);
    const url = house === 'Lok Sabha' ? `https://sansad.in/api_ls/member/positionHeld?mpCode=${code}&locale=en` : `https://sansad.in/api_rs/member/position-held?mpCode=${code}&locale=en`;
    try {
      const data = await getJson(url);
      const old: any[] | null = Array.isArray(p.positions_held) ? p.positions_held : null;
      const known = new Map((old ?? []).map((x: any) => [`${x.period}|${x.text}`, x.added_at ?? null]));
      const stamp = new Date().toISOString();
      const positions = (Array.isArray(data) ? data : []).map((x: any) => ({ period: tidy(x.period), text: stripHtml(x.positionHeld ?? x.position).slice(0, 300) })).filter((x: any) => x.text).slice(0, 40)
        .map((x: any) => { const k = `${x.period}|${x.text}`; if (known.has(k)) return { ...x, added_at: known.get(k) }; if (old) newPositions++; return { ...x, added_at: old ? stamp : null }; });
      const el = positions.find((x: any) => /elected to (the )?18th lok sabha/i.test(x.text)) ?? positions.find((x: any) => /elected to/i.test(x.text));
      await db.from('politicians').update({ positions_held: positions, elected_current: el ? `${el.text.replace(/^elected to /i, '')} \u00b7 ${el.period}` : null, details_fetched_at: new Date().toISOString() }).eq('id', p.id);
      done++;
    } catch { failed++; }
    await sleep(700);
  }
  const next = offset + slice.length;
  const remaining = onlyStale ? Math.max(0, todo.length - done) : Math.max(0, everyone.length - next);
  return { house, total: everyone.length, offset, done, failed, new_positions: newPositions, next_offset: next, remaining, finished: remaining === 0 || slice.length === 0 };
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
    for (const k of ['photo_url','gender','terms_count','lok_sabha_terms','term_label','term_start','term_end','minister_position']) if (r[k] !== undefined && r[k] !== null && r[k] !== '') v[k] = r[k];
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
      if (action === 'politicians') return json({ rows: await all('politicians', 'id,name_en,name_hi,party,house,constituency,state,wikidata_id,is_current,source,photo_url,gender,terms_count,lok_sabha_terms,term_label,term_start,term_end,minister_position,elected_current,official_id,details_fetched_at') });
      if (action === 'status') {
        const cnt = async (f: (q: any) => any) => { const { count } = await f(db.from('politicians').select('id', { count: 'exact', head: true })); return count ?? 0; };
        const [ls, rs, other, former, withDetails] = await Promise.all([
          cnt((q) => q.like('official_id', 'LS:%').neq('is_current', false)), cnt((q) => q.like('official_id', 'RS:%').neq('is_current', false)),
          cnt((q) => q.is('official_id', null).neq('is_current', false)), cnt((q) => q.eq('is_current', false)), cnt((q) => q.not('details_fetched_at', 'is', null))]);
        const { count: att } = await db.from('attendance').select('id', { count: 'exact', head: true });
        const { data: last } = await db.from('politicians').select('imported_at').not('imported_at', 'is', null).order('imported_at', { ascending: false }).limit(1);
        const { data: lastAtt } = await db.from('attendance').select('fetched_at').order('fetched_at', { ascending: false }).limit(1);
        return json({ lok_sabha: ls, rajya_sabha: rs, others: other, former, with_positions: withDetails, attendance_rows: att ?? 0, members_updated_at: last?.[0]?.imported_at ?? null, attendance_updated_at: lastAtt?.[0]?.fetched_at ?? null });
      }
      if (action === 'attendance') return json({ rows: await all('attendance', 'id,politician_id,session_no,session_period,sitting_days,signed_days,loksabha') });
      if (action === 'member') {
        const id = url.searchParams.get('id')!;
        const { data } = await db.from('politicians').select('id,name_en,name_hi,party,house,constituency,state,photo_url,gender,terms_count,lok_sabha_terms,term_label,term_start,term_end,minister_position,elected_current,positions_held,details_fetched_at,is_current').eq('id', id).single();
        const { data: att } = await db.from('attendance').select('session_no,session_period,sitting_days,signed_days,loksabha').eq('politician_id', id).order('session_no');
        return json({ member: data, attendance: att ?? [] });
      }
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
    if (body.action === 'official_attendance') return json(await officialAttendance());
    if (body.action === 'official_details') {
      if (!['Lok Sabha', 'Rajya Sabha'].includes(body.house)) return json({ error: 'house must be Lok Sabha or Rajya Sabha' }, 400);
      return json(await officialDetails(body.house, Math.min(+body.limit || 40, 60), !!body.only_stale, Math.max(0, +body.offset || 0)));
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
