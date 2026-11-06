// NetaNazar "worker": runs the whole update on the server, in parallel, even if the browser is closed.
// "start" creates a job with independent tasks; every task runs in its own background invocation and re-invokes itself
// until it is finished. The admin page only starts the job and watches progress.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } = (globalThis as any).EdgeRuntime;
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BASE = Deno.env.get('SUPABASE_URL')! + '/functions/v1';
const TOKEN = (Deno.env.get('REGISTRY_TOKEN') ?? '').trim();
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = ['done', 'failed', 'skipped', 'stopped'];
const BUDGET_MS = 95000;     // one background slice; then the task re-invokes itself
const STALE_MS = 170000;     // a running task with no heartbeat for this long is considered lost

async function call(fn: string, body: unknown) {
  const r = await fetch(`${BASE}/${fn}`, { method: 'POST', headers: { 'x-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `${fn} answered ${r.status}`);
  return j;
}
async function retry<T>(f: () => Promise<T>): Promise<T> { try { return await f(); } catch { await sleep(2000); return await f(); } }
async function kick(jobId: string, taskId: string) {
  try { await fetch(`${BASE}/worker`, { method: 'POST', headers: { 'x-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run', job_id: jobId, task_id: taskId }) }); } catch { /* nudge will retry */ }
}
const setTask = (id: string, patch: Record<string, unknown>) => db.from('job_tasks').update({ ...patch, updated_at: now() }).eq('id', id);

async function maybeFinish(jobId: string) {
  const { data: tasks } = await db.from('job_tasks').select('id,grp,label,status,detail').eq('job_id', jobId);
  if (!tasks || !tasks.every((t: any) => TERMINAL.includes(t.status))) return;
  const { data: job } = await db.from('jobs').select('status').eq('id', jobId).single();
  if (!job || !['running', 'stopping'].includes(job.status)) return;
  const failed = tasks.filter((t: any) => t.status === 'failed').map((t: any) => t.label);
  await db.from('jobs').update({ status: job.status === 'stopping' ? 'stopped' : 'done', finished_at: now(), updated_at: now(), summary: { failed, tasks: tasks.length } }).eq('id', jobId).in('status', ['running', 'stopping']);
}
// Start every pending task whose dependencies are done; skip those whose dependencies failed.
async function kickReady(jobId: string) {
  const { data: tasks } = await db.from('job_tasks').select('id,status,deps').eq('job_id', jobId);
  const by = new Map((tasks ?? []).map((t: any) => [t.id, t]));
  for (const t of tasks ?? []) {
    if (t.status !== 'pending') continue;
    const deps = (t.deps as string[]).map((d) => by.get(d)).filter(Boolean) as any[];
    if (deps.some((d) => d.status === 'failed' || d.status === 'skipped' || d.status === 'stopped')) { await setTask(t.id, { status: 'skipped', detail: 'Skipped because a step it needs did not finish', finished_at: now() }); continue; }
    if (deps.every((d) => d.status === 'done')) {
      const { data } = await db.from('job_tasks').update({ status: 'queued', updated_at: now() }).eq('id', t.id).eq('status', 'pending').select('id');
      if (data?.length) await kick(jobId, t.id);
    }
  }
  await maybeFinish(jobId);
}

type Ctx = { left: () => number; stop: () => Promise<boolean>; progress: (detail: string, pct: number, state?: unknown) => Promise<void>; jobId: string };
type Result = { done: boolean; stopped?: boolean; detail?: string; state?: any };

const RUNNERS: Record<string, (t: any, st: any, c: Ctx) => Promise<Result>> = {
  async members(t, st, c) {
    const house = t.params.house; await c.progress(`Reading the ${house} list from sansad.in…`, 15, st);
    const r = await retry(() => call('registry', { action: 'official_fetch', house, mark_stale: true }));
    if (r.unchanged) return { done: true, detail: `No change at sansad.in since the last check — nothing to update (${r.official_rows} members)` };
    return { done: true, detail: `${r.official_rows} members · ${r.updated ?? 0} updated · ${r.unchanged_rows ?? 0} unchanged · ${r.inserted} new · ${r.marked_former} marked former` };
  },
  async seats(_t, st, c) { await c.progress('Reading seats and parties of past Lok Sabha terms…', 20, st); const r = await retry(() => call('registry', { action: 'official_seats' })); return { done: true, detail: r.members ? `${r.members} members updated · ${r.lok_sabhas_read} past Lok Sabha lists read` : `No change — ${r.unchanged ?? 0} members already up to date (${r.lok_sabhas_read} lists read)` }; },
  async attendance(_t, st, c) { await c.progress('Reading attendance session by session…', 20, st); const r = await retry(() => call('registry', { action: 'official_attendance' })); return { done: true, detail: `${r.sessions} sessions · ${r.unchanged_sessions ?? 0} unchanged · ${r.requests ?? '?'} request${r.requests == 1 ? '' : 's'} to sansad.in` }; },
  async positions(t, st, c) {
    const house = t.params.house; st.done ??= 0; st.newp ??= 0; st.failed ??= 0; st.stall ??= 0;
    for (;;) {
      if (await c.stop()) return { done: false, stopped: true, state: st };
      if (c.left() < 45000) return { done: false, state: st };
      const r = await call('registry', { action: 'official_details', house, limit: 20, only_stale: true });
      if (st.start == null) st.start = r.remaining + r.done; st.same = (st.same ?? 0) + (r.unchanged ?? 0); st.done += r.done; st.newp += r.new_positions; st.failed += r.failed;
      const here = st.start - r.remaining; const txt = `${here} of ${st.start} members${st.newp ? ` · ${st.newp} new position${st.newp == 1 ? '' : 's'}` : ''}${st.failed ? ` · ${st.failed} failed` : ''}`;
      await c.progress(txt, st.start ? Math.round(100 * here / st.start) : 100, st);
      if (r.finished || r.remaining <= 0) return { done: true, detail: st.done ? `${st.done} members checked \u00b7 ${st.same ?? 0} unchanged${st.newp ? ` · ${st.newp} new position${st.newp == 1 ? '' : 's'} found` : ' · nothing new'}${st.failed ? ` · ${st.failed} failed (retried next time)` : ''}` : 'Everyone is already up to date', state: st };
      if (r.done === 0) { if (++st.stall >= 2) return { done: true, detail: `Stopped early: ${st.failed} failed`, state: st }; } else st.stall = 0;
    }
  },
  async news(t, st, c) {
    const sid = t.params.source_id; st.phase ??= 'ingest'; st.read ??= 0; st.kept ??= 0; st.links ??= 0; st.skipped ??= 0; st.stall ??= 0;
    if (st.phase === 'ingest') {
      await c.progress('Reading the feed…', 5, st);
      const r = await retry(() => call('news', { action: 'fetchfeed', source_id: sid }));
      if (r.skipped) return { done: true, detail: `Paused (${r.skipped})`, state: st };
      st.unchangedFeed = !!r.unchanged; st.links = r.added ?? 0; st.phase = 'wait'; await c.progress(`${st.links} new links — waiting for the member list…`, 15, st);
    }
    if (st.phase === 'wait') {   // matching needs the member list; wait for this job's member tasks (if any)
      for (;;) {
        const { data } = await db.from('job_tasks').select('status').eq('job_id', c.jobId).eq('kind', 'members');
        if (!data || !data.length || data.every((x: any) => TERMINAL.includes(x.status))) break;
        if (c.left() < 15000 || await c.stop()) return { done: false, stopped: await c.stop(), state: st };
        await sleep(3000);
      }
      st.phase = 'process';
    }
    for (;;) {
      if (await c.stop()) return { done: false, stopped: true, state: st };
      if (c.left() < 50000) return { done: false, state: st };
      const r = await call('news', { action: 'process', limit: 15, source_id: sid });
      st.read += r.processed; st.kept += r.new + r.changed; st.skipped += r.irrelevant; st.rem = r.remaining; if (st.total == null) st.total = st.read + r.remaining;
      await c.progress(`${st.links} new links · ${st.read} read · ${st.kept} about members${r.remaining ? ` · ${r.remaining} waiting` : ''}`, st.total ? Math.min(99, Math.round(100 * st.read / st.total)) : 50, st);
      if (r.remaining <= 0) return { done: true, detail: st.unchangedFeed && !st.read ? 'Feed unchanged since the last check — nothing new' : `${st.links} new links · ${st.read} read · ${st.kept} about members`, state: st };
      if (r.processed === 0) { if (r.skipped > 0 || ++st.stall >= 2) return { done: true, detail: `${st.links} new links · ${st.read} read · ${st.kept} about members`, state: st }; } else st.stall = 0;
    }
  },
};

async function runTask(jobId: string, taskId: string) {
  const t0 = Date.now();
  const { data: task } = await db.from('job_tasks').select('*').eq('id', taskId).single();
  if (!task || TERMINAL.includes(task.status)) return;
  const jobStatus = async () => (await db.from('jobs').select('status').eq('id', jobId).single()).data?.status;
  const stop = async () => ['stopping', 'stopped'].includes(await jobStatus());
  if (await stop()) { await setTask(taskId, { status: 'stopped', detail: 'Stopped', finished_at: now() }); await maybeFinish(jobId); return; }
  await setTask(taskId, { status: 'running', started_at: task.started_at ?? now() });
  const st = task.state ?? {};
  const ctx: Ctx = { jobId, left: () => BUDGET_MS - (Date.now() - t0), stop,
    progress: async (detail, pct, state) => { await setTask(taskId, { detail, progress: Math.max(0, Math.min(100, pct)), ...(state ? { state } : {}) }); } };
  try {
    const res = await RUNNERS[task.kind](task, st, ctx);
    if (res.stopped) { await setTask(taskId, { status: 'stopped', detail: 'Stopped', state: res.state ?? st, finished_at: now() }); }
    else if (res.done) { await setTask(taskId, { status: 'done', detail: res.detail ?? 'Done', progress: 100, state: res.state ?? st, finished_at: now() }); }
    else { await setTask(taskId, { status: 'queued', state: res.state ?? st }); await kick(jobId, taskId); return; }   // next slice
  } catch (e) { await setTask(taskId, { status: 'failed', detail: String((e as Error).message ?? e), finished_at: now() }); }
  await kickReady(jobId);
}

async function startJob(stages: string[]) {
  const { data: running } = await db.from('jobs').select('id,updated_at').in('status', ['running', 'stopping']).order('started_at', { ascending: false }).limit(1);
  if (running?.length) {
    const { data: ts } = await db.from('job_tasks').select('updated_at,status').eq('job_id', running[0].id);
    const alive = (ts ?? []).some((t: any) => !TERMINAL.includes(t.status) && Date.now() - new Date(t.updated_at).getTime() < STALE_MS);
    if (alive) return { job_id: running[0].id, already_running: true };
    await db.from('jobs').update({ status: 'failed', finished_at: now() }).eq('id', running[0].id);
  }
  const { data: job, error } = await db.from('jobs').insert({ options: { stages } }).select('id').single(); if (error) throw new Error(error.message);
  const has = (s: string) => stages.includes(s); const id = () => crypto.randomUUID(); let sort = 0; const rows: any[] = [];
  const add = (kind: string, grp: string, label: string, params: unknown, deps: string[] = []) => { const tid = id(); rows.push({ id: tid, job_id: job.id, kind, grp, label, params, deps, sort: sort++ }); return tid; };
  let ls = '', rs = '';
  if (has('members')) { ls = add('members', 'members', 'Lok Sabha list', { house: 'Lok Sabha' }); rs = add('members', 'members', 'Rajya Sabha list', { house: 'Rajya Sabha' }); add('seats', 'members', 'Past Lok Sabha terms (seats and parties)', {}, [ls]); }
  if (has('attendance')) add('attendance', 'attendance', 'Attendance', {}, ls ? [ls] : []);
  if (has('positions')) { add('positions', 'positions', 'Lok Sabha positions', { house: 'Lok Sabha' }, ls ? [ls] : []); add('positions', 'positions', 'Rajya Sabha positions', { house: 'Rajya Sabha' }, rs ? [rs] : []); }
  if (has('news')) { const { data: srcs } = await db.from('sources').select('id,name,domain').eq('is_blocked', false).order('name'); for (const s of srcs ?? []) add('news', 'news', s.name || s.domain, { source_id: s.id }); }
  if (!rows.length) { await db.from('jobs').update({ status: 'done', finished_at: now() }).eq('id', job.id); return { job_id: job.id, empty: true }; }
  const { error: e2 } = await db.from('job_tasks').insert(rows); if (e2) throw new Error(e2.message);
  EdgeRuntime.waitUntil(kickReady(job.id));
  return { job_id: job.id, tasks: rows.length };
}

async function progress() {
  const { data: job } = await db.from('jobs').select('*').order('started_at', { ascending: false }).limit(1);
  if (!job?.length) return { job: null, tasks: [] };
  const { data: tasks } = await db.from('job_tasks').select('id,kind,grp,label,status,detail,progress,sort,started_at,finished_at,updated_at').eq('job_id', job[0].id).order('sort');
  return { job: job[0], tasks: tasks ?? [], now: now() };
}
async function nudge() {
  const { data: job } = await db.from('jobs').select('id,status').in('status', ['running', 'stopping']).order('started_at', { ascending: false }).limit(1);
  if (!job?.length) return { nudged: 0 };
  const { data: tasks } = await db.from('job_tasks').select('id,status,updated_at').eq('job_id', job[0].id).in('status', ['queued', 'running']);
  let n = 0;
  for (const t of tasks ?? []) if (Date.now() - new Date(t.updated_at).getTime() > STALE_MS) { await setTask(t.id, { status: 'queued' }); await kick(job[0].id, t.id); n++; }
  await kickReady(job[0].id);
  return { nudged: n };
}
async function stopJob() {
  const { data: job } = await db.from('jobs').select('id').in('status', ['running']).order('started_at', { ascending: false }).limit(1);
  if (!job?.length) return { stopped: false };
  await db.from('jobs').update({ status: 'stopping', updated_at: now() }).eq('id', job[0].id);
  await db.from('job_tasks').update({ status: 'stopped', detail: 'Stopped before it started', finished_at: now(), updated_at: now() }).eq('job_id', job[0].id).eq('status', 'pending');
  await maybeFinish(job[0].id);
  return { stopped: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (!TOKEN || (req.headers.get('x-token') ?? '').trim() !== TOKEN) return json({ error: 'forbidden', secret_set: !!TOKEN }, 403);
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') { const a = url.searchParams.get('action'); if (a === 'progress') return json(await progress()); return json({ error: 'unknown action' }, 400); }
    const b = await req.json();
    if (b.action === 'start') return json(await startJob(Array.isArray(b.stages) && b.stages.length ? b.stages : ['members', 'attendance', 'positions', 'news']));
    if (b.action === 'run') { EdgeRuntime.waitUntil(runTask(b.job_id, b.task_id).catch(() => {})); return json({ accepted: true }, 202); }
    if (b.action === 'stop') return json(await stopJob());
    if (b.action === 'nudge') return json(await nudge());
    return json({ error: 'unknown action' }, 400);
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
