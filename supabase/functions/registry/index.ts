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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const token = (Deno.env.get('REGISTRY_TOKEN') ?? '').trim();
  const given = (req.headers.get('x-token') ?? '').trim();
  if (!token || given !== token) return json({ error: 'forbidden', secret_set: !!token, secret_length: token.length, token_length_you_sent: given.length }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'politicians') return json({ rows: await all('politicians', 'id,name_en,name_hi,party,house,constituency,wikidata_id') });
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
