/* NetaNazar admin — one click updates members, attendance, positions and news. */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sg = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const ss = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const DEFAULT_BASE = 'https://qajsvaeamujtpdsutzgo.supabase.co/functions/v1';
  const ic = window.ic;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let saved = sg('nn_tok');

  // ---------------- icons & static labels ----------------
  $('#mark').innerHTML = ic('eye'); $('#themeIc').innerHTML = ic('sun'); $('#cIc').innerHTML = ic('key'); $('#sIc').innerHTML = ic('chart-bar'); $('#nIc').innerHTML = ic('newspaper');
  const GO_LABEL = ic('arrows-clockwise') + ' Update everything'; const STOP_LABEL = ic('stop') + ' Stop';
  $('#go').innerHTML = GO_LABEL; $('#stop').innerHTML = STOP_LABEL; $('#addSrc').innerHTML = ic('plus') + ' Add source';
  $('#tok').value = saved; $('#base').value = sg('nn_base') || DEFAULT_BASE;
  (() => { const t = sg('nn_theme'); if (t) document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn').onclick = () => { const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nx); ss('nn_theme', nx); }; })();

  // ---------------- api ----------------
  const cfg = () => ({ base: ($('#base').value || DEFAULT_BASE).trim(), tok: ($('#tok').value || '').trim() });
  async function api(fn, method, qs, body) {
    const c = cfg(); let r;
    try { r = await fetch(`${c.base}/${fn}${qs || ''}`, { method, headers: { 'x-token': c.tok, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); }
    catch { throw new Error('Cannot reach the server — check your internet connection.'); }
    if (r.status === 403) throw new Error('The token does not match the one saved in Supabase.');
    const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 400) throw new Error(j.error || 'Server error ' + r.status);
    if (r.status === 400 && j.error && j.error !== 'unknown action') throw new Error(j.error);
    return j;
  }
  const retry = async (f) => { try { return await f(); } catch (e) { if (/token|reach/.test(e.message)) throw e; await sleep(1500); return f(); } };

  // ---------------- connection ----------------
  const chip = (cls, html) => { const c = $('#tokChip'); c.className = 'chip ' + cls; c.innerHTML = html; };
  async function verify() {
    if (!saved) { chip('', 'Not set'); $('#go').disabled = true; return false; }
    chip('warn', '<span class="sp"></span> Checking…');
    try { await api('registry', 'GET', '?action=ping'); chip('ok', ic('check-circle') + ' Connected'); $('#go').disabled = false; refresh(); return true; }
    catch (e) { chip('off', ic('x-circle') + ' ' + esc(e.message)); $('#go').disabled = true; return false; }
  }
  $('#tok').addEventListener('input', () => { const d = $('#tok').value.trim() !== saved && $('#tok').value.trim(); $('#tokSave').style.display = d ? '' : 'none'; if (d) chip('warn', 'Not saved yet'); });
  $('#tokSave').onclick = () => { saved = $('#tok').value.trim(); ss('nn_tok', saved); ss('nn_base', $('#base').value.trim()); $('#tokSave').style.display = 'none'; verify(); };
  $('#base').addEventListener('change', () => { ss('nn_base', $('#base').value.trim()); verify(); });

  // ---------------- stages ----------------
  const STAGES = [
    { id: 'members', icon: 'users', name: 'Members', desc: 'Lok Sabha and Rajya Sabha: name, party, seat, photo, terms' },
    { id: 'attendance', icon: 'chart-bar', name: 'Attendance', desc: 'Every session of the current Lok Sabha' },
    { id: 'positions', icon: 'clipboard-text', name: 'Positions held', desc: 'Only members not loaded yet or older than 7 days; new positions are flagged' },
    { id: 'news', icon: 'newspaper', name: 'News', desc: 'Reads every news feed, keeps only stories that name a member' }];
  function drawStages() {
    $('#stages').innerHTML = STAGES.map((s) => `<div class="stage" id="st-${s.id}"><span class="si">${ic(s.icon)}</span><div class="sb"><div class="sn">${esc(s.name)}</div><div class="sd" id="sd-${s.id}">${esc(s.desc)}</div><div class="bar"><i id="bar-${s.id}"></i></div>${s.id === 'news' ? '<div class="lanes" id="lanes"></div>' : ''}</div><label class="chk"><input type="checkbox" id="ck-${s.id}" checked> Include</label></div>`).join('');
  }
  function setStage(id, state, text, pct) {
    const el = $('#st-' + id); if (!el) return; el.className = 'stage ' + (state === 'idle' ? '' : state);
    const icon = { run: '<span class="sp"></span>', ok: ic('check'), bad: ic('x'), skip: ic('minus'), idle: ic(STAGES.find((s) => s.id === id).icon) }[state];
    el.querySelector('.si').innerHTML = icon; if (text != null) $('#sd-' + id).innerHTML = text; if (pct != null) $('#bar-' + id).style.width = Math.max(0, Math.min(100, pct)) + '%';
  }
  const log = (t) => { const l = $('#log'); l.textContent = (l.textContent === 'Nothing yet.' ? '' : l.textContent + '\n') + new Date().toLocaleTimeString('en-IN', { hour12: false }) + '  ' + t; l.scrollTop = l.scrollHeight; };
  const banner = (kind, html) => { const m = $('#msg'); m.className = 'msgbar show ' + kind; m.innerHTML = html; };
  let STOP = false;

  async function stageMembers() {
    let added = 0, former = 0, total = 0; setStage('members', 'run', 'Reading the Lok Sabha list from sansad.in…', 5);
    for (const [i, house] of ['Lok Sabha', 'Rajya Sabha'].entries()) {
      if (STOP) return 'stopped'; setStage('members', 'run', `Reading the ${house} list from sansad.in…`, 5 + i * 45);
      const r = await retry(() => api('registry', 'POST', '', { action: 'official_fetch', house, mark_stale: true }));
      added += r.inserted; former += r.marked_former; total += r.official_rows; log(`${house}: ${r.official_rows} members · ${r.matched} matched · ${r.inserted} new · ${r.marked_former} marked former`);
    }
    setStage('members', 'ok', `${total} sitting members updated · ${added} new · ${former} marked former`, 100);
  }
  async function stageAttendance() {
    setStage('attendance', 'run', 'Reading attendance session by session… (about half a minute)', 30);
    const r = await retry(() => api('registry', 'POST', '', { action: 'official_attendance' }));
    log(`Attendance: ${r.sessions} sessions, ${r.rows} records`); setStage('attendance', 'ok', `${r.sessions} sessions · ${r.rows} member records`, 100);
  }
  async function stagePositions() {
    let doneAll = 0, newAll = 0, failedAll = 0;
    for (const house of ['Lok Sabha', 'Rajya Sabha']) {
      let start = null, stall = 0;
      while (!STOP) {
        const r = await retry(() => api('registry', 'POST', '', { action: 'official_details', house, limit: 40, only_stale: true }));
        if (start == null) start = r.remaining + r.done; doneAll += r.done; newAll += r.new_positions; failedAll += r.failed;
        const doneHere = start - r.remaining; setStage('positions', 'run', `${house}: ${doneHere} of ${start} members${newAll ? ` · ${newAll} new position${newAll == 1 ? '' : 's'} found` : ''}${failedAll ? ` · ${failedAll} failed` : ''}`, start ? 100 * doneHere / start : 100);
        if (r.finished || r.remaining <= 0) break; if (r.done === 0 && ++stall >= 2) break; if (r.done > 0) stall = 0;
      }
      if (STOP) break;
    }
    if (STOP) return 'stopped';
    log(`Positions: ${doneAll} members refreshed, ${newAll} new positions, ${failedAll} failed`);
    setStage('positions', failedAll && !doneAll ? 'bad' : 'ok', doneAll ? `${doneAll} members refreshed${newAll ? ` · <b>${newAll} new position${newAll == 1 ? '' : 's'}</b> found` : ' · nothing new'}${failedAll ? ` · ${failedAll} failed (will retry next time)` : ''}` : 'Everyone is already up to date', 100);
  }

  const pdate = (n) => { const d = n.querySelector('pubDate,published,updated'); const t = d && new Date(d.textContent.trim()); return t && !isNaN(t) ? t.toISOString() : undefined; };
  function parseFeed(text) {
    const d = new DOMParser().parseFromString(text, 'text/xml'); const out = [];
    d.querySelectorAll('item,entry').forEach((n) => { const l = n.querySelector('link'); const u = l && (l.getAttribute('href') || l.textContent); const t = n.querySelector('title'); if (u) out.push({ url: u.trim(), title: t && t.textContent.trim(), published: pdate(n) }); });
    d.querySelectorAll('url').forEach((n) => { const loc = n.querySelector('loc'); const lm = n.querySelector('lastmod'); if (loc) { const t = lm && new Date(lm.textContent.trim()); out.push({ url: loc.textContent.trim(), published: t && !isNaN(t) ? t.toISOString() : undefined }); } });
    return out;
  }
  async function stageNews() {
    const { rows: sources } = await api('news', 'GET', '?action=sources'); const live = sources.filter((s) => !s.is_blocked);
    if (!live.length) { setStage('news', 'bad', 'No news sources are available — add one below, or retry a blocked one.', 100); return; }
    $('#lanes').innerHTML = live.map((s) => `<div class="lane" id="ln-${s.id}"><span class="li">${ic('circle-notch')}</span><span><b>${esc(s.name || s.domain)}</b><small>Waiting</small></span></div>`).join('');
    const lane = (s, st, t) => { const el = $('#ln-' + s.id); if (!el) return; el.className = 'lane ' + st; el.querySelector('.li').innerHTML = st === 'run' ? '<span class="sp"></span>' : st === 'ok' ? ic('check-circle') : st === 'bad' ? ic('x-circle') : ic('circle-notch'); el.querySelector('small').innerHTML = t; };
    const tot = { read: 0, keptNew: 0, edited: 0, deleted: 0, mentions: 0, irrelevant: 0, links: 0 }; let first = 0, done = 0;
    const draw = () => setStage('news', 'run', `${tot.read} stories read · <b>${tot.keptNew + tot.edited} about members</b> · ${tot.irrelevant} skipped (no member named)${tot.deleted ? ` · ${tot.deleted} removed by publishers` : ''}`, first ? 100 * done / first : 5);
    setStage('news', 'run', `Reading ${live.length} news sites at the same time…`, 3);
    async function one(s) {
      try {
        lane(s, 'run', 'Reading the feed…'); let items = [], how = 'browser';
        for (const u of [...(s.rss_urls || []), ...(s.sitemap_url ? [s.sitemap_url] : [])]) { try { const r = await fetch(u); if (!r.ok) throw 0; items = items.concat(parseFeed(await r.text())); } catch { how = 'server'; break; } }
        let n = 0;
        if (how === 'server' || !items.length) { lane(s, 'run', 'Site blocks browsers — reading from our server…'); const r = await api('news', 'POST', '', { action: 'fetchfeed', source_id: s.id }); if (r.skipped) { lane(s, 'bad', 'Paused (' + esc(r.skipped) + ')'); return; } n = r.added || 0; }
        else n = (await api('news', 'POST', '', { action: 'ingest', source_id: s.id, items })).added; tot.links += n;
        let rem = null, stall = 0, mine = { read: 0, kept: 0 };
        while (!STOP) {
          lane(s, 'run', `${n} new links · read ${mine.read}${rem != null ? ' · ' + rem + ' waiting' : ''}`);
          const r = await api('news', 'POST', '', { action: 'process', limit: 30, source_id: s.id });
          mine.read += r.processed; mine.kept += r.new + r.changed; tot.read += r.processed; tot.keptNew += r.new; tot.edited += r.changed; tot.deleted += r.deleted; tot.mentions += r.mentions; tot.irrelevant += r.irrelevant;
          done += r.processed; first = Math.max(first, done + r.remaining); rem = r.remaining; draw(); if (rem <= 0) break; if (r.processed === 0) { if (r.skipped > 0 || ++stall >= 2) break; } else stall = 0;
        }
        lane(s, STOP && rem > 0 ? 'run' : 'ok', `${n} new links · ${mine.read} read · <b>${mine.kept}</b> about members${rem > 0 ? ' · ' + rem + ' left' : ''}`);
      } catch (e) { lane(s, 'bad', esc(e.message)); }
    }
    await Promise.all(live.map(one));
    if (STOP) return 'stopped';
    log(`News: ${tot.links} new links, ${tot.read} read, ${tot.keptNew} new member stories, ${tot.edited} edits, ${tot.deleted} removed, ${tot.irrelevant} skipped`);
    setStage('news', 'ok', `${tot.links} new links · ${tot.read} stories read · <b>${tot.keptNew + tot.edited} about members</b> (${tot.mentions} mentions)${tot.edited ? ` · ${tot.edited} edited` : ''}${tot.deleted ? ` · ${tot.deleted} removed` : ''}`, 100);
  }

  const RUNNERS = { members: stageMembers, attendance: stageAttendance, positions: stagePositions, news: stageNews };
  let running = false;
  async function runAll() {
    if (running) return; running = true; STOP = false; $('#msg').className = 'msgbar';
    const go = $('#go'); go.disabled = true; go.innerHTML = '<span class="sp"></span> Updating…'; $('#stop').style.display = ''; $('#stop').innerHTML = STOP_LABEL;
    drawStages(); const picked = STAGES.filter((s) => $('#ck-' + s.id).checked); const failed = [];
    STAGES.forEach((s) => { if (!picked.includes(s)) setStage(s.id, 'skip', 'Skipped'); });
    // keep the user's checkboxes after redraw
    STAGES.forEach((s) => { $('#ck-' + s.id).checked = picked.includes(s); $('#ck-' + s.id).disabled = true; });
    const t0 = Date.now();
    for (const s of picked) {
      if (STOP) { setStage(s.id, 'skip', 'Stopped before this step'); continue; }
      setStage(s.id, 'run', 'Starting…', 2);
      try { const r = await RUNNERS[s.id](); if (r === 'stopped') setStage(s.id, 'skip', 'Stopped'); }
      catch (e) { failed.push(s.name); setStage(s.id, 'bad', esc(e.message)); log(s.name + ' failed: ' + e.message); if (/token|reach/.test(e.message)) break; }
    }
    const mins = Math.max(1, Math.round((Date.now() - t0) / 6e4));
    if (STOP) banner('info', ic('stop') + ' Stopped. Whatever finished is saved; run again any time to continue.');
    else if (failed.length) banner('bad', ic('warning') + ' Finished with problems in: <b>' + esc(failed.join(', ')) + '</b>. Run again to retry just what is missing.');
    else banner('ok', ic('check-circle') + ` All done in about ${mins} min. The public site now shows the latest data.`);
    STAGES.forEach((s) => { $('#ck-' + s.id).disabled = false; }); go.disabled = false; go.innerHTML = GO_LABEL; $('#stop').style.display = 'none'; running = false; refresh();
  }
  $('#go').onclick = runAll; $('#stop').onclick = () => { STOP = true; $('#stop').innerHTML = '<span class="sp"></span> Stopping…'; };

  // ---------------- overview & sources ----------------
  const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  async function refresh() {
    try {
      const [st, ov, src] = await Promise.all([api('registry', 'GET', '?action=status'), api('news', 'GET', '?action=overview'), api('news', 'GET', '?action=sources')]);
      $('#last').textContent = `Members ${ago(st.members_updated_at)} · attendance ${ago(st.attendance_updated_at)}`;
      const S = (n, l) => `<div class="stat"><b class="tnum">${Number(n).toLocaleString('en-IN')}</b><span>${l}</span></div>`;
      $('#stats').innerHTML = S(st.lok_sabha, 'Lok Sabha members') + S(st.rajya_sabha, 'Rajya Sabha members') + S(st.with_positions, 'with positions loaded') + S(st.attendance_rows, 'attendance records') + S(ov.articles.relevant, 'stories about members') + S(ov.mentions, 'member mentions') + S(ov.articles.irrelevant, 'skipped (no member named)') + S(ov.versions, 'story versions saved');
      $('#srcTbl').innerHTML = src.rows.map((r) => `<tr><td><b>${esc(r.name || r.domain)}</b><div class="fine" style="margin:0">${esc((r.rss_urls || [])[0] || 'no feed saved')}</div></td><td style="text-align:right;white-space:nowrap">${r.is_blocked ? `<span class="chip off">Blocked</span> <button class="mini" data-unblock="${esc(r.id)}">Try again</button>` : '<span class="chip ok">Active</span>'}</td></tr>`).join('') || '<tr><td>No sources yet.</td></tr>';
    } catch (e) { $('#stats').innerHTML = `<div class="note" style="grid-column:1/-1">${esc(e.message)}</div>`; }
  }
  $('#srcTbl').addEventListener('click', async (e) => { const b = e.target.closest('[data-unblock]'); if (!b) return; b.disabled = true; try { await api('news', 'POST', '', { action: 'unblock_source', source_id: b.dataset.unblock }); } finally { refresh(); } });
  $('#addSrc').onclick = async () => {
    const name = $('#newName').value.trim(), rss = $('#newRss').value.trim(); if (!rss) { banner('bad', 'Paste the RSS address of the news site first.'); return; }
    $('#addSrc').disabled = true; try { await api('news', 'POST', '', { action: 'add_source', name: name || undefined, rss_url: rss }); $('#newName').value = ''; $('#newRss').value = ''; banner('ok', ic('check-circle') + ' Source added. It is included in the next update.'); } catch (e) { banner('bad', esc(e.message)); } finally { $('#addSrc').disabled = false; refresh(); }
  };

  drawStages(); verify();
})();
