/* NetaNazar admin — one click starts the update ON THE SERVER; this page only starts it and watches progress. */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sg = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const ss = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const DEFAULT_BASE = 'https://qajsvaeamujtpdsutzgo.supabase.co/functions/v1';
  const ic = window.ic;
  let saved = sg('nn_tok');

  // ---------------- icons & static labels ----------------
  $('#mark').innerHTML = ic('eye'); $('#themeIc').innerHTML = ic('sun'); $('#cIc').innerHTML = ic('key'); $('#sIc').innerHTML = ic('chart-bar'); $('#nIc').innerHTML = ic('newspaper'); $('#hIc').innerHTML = ic('database');
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

  // ---------------- connection ----------------
  const chip = (cls, html) => { const c = $('#tokChip'); c.className = 'chip ' + cls; c.innerHTML = html; };
  async function verify() {
    if (!saved) { chip('', 'Not set'); $('#go').disabled = true; return false; }
    $('#tok').classList.remove('ok'); chip('warn', '<span class="sp"></span> Checking…');
    try { await api('registry', 'GET', '?action=ping'); chip('ok', ic('check-circle') + ' Connected'); $('#tok').classList.add('ok'); $('#go').disabled = false; refresh(); attach(); return true; }
    catch (e) { chip('off', ic('x-circle') + ' ' + esc(e.message)); $('#tok').classList.remove('ok'); $('#go').disabled = true; return false; }
  }
  $('#tok').addEventListener('input', () => { const d = $('#tok').value.trim() !== saved && $('#tok').value.trim(); $('#tokSave').style.display = d ? '' : 'none'; if (d) { $('#tok').classList.remove('ok'); chip('warn', 'Not saved yet'); } });
  $('#tokSave').onclick = () => { saved = $('#tok').value.trim(); ss('nn_tok', saved); ss('nn_base', $('#base').value.trim()); $('#tokSave').style.display = 'none'; verify(); };

  // ---------------- stages (the server runs them; we only show them) ----------------
  const GROUPS = [
    { id: 'members', icon: 'users', name: 'Members', desc: 'Lok Sabha and Rajya Sabha lists, plus the seat and party of every past Lok Sabha term' },
    { id: 'attendance', icon: 'chart-bar', name: 'Attendance', desc: 'Every session of the current Lok Sabha' },
    { id: 'positions', icon: 'clipboard-text', name: 'Positions held', desc: 'Only members not loaded yet or older than 7 days; new positions are flagged' },
    { id: 'news', icon: 'newspaper', name: 'News', desc: 'Reads every news feed, keeps only stories that name a member' }];
  function drawStages() {
    $('#stages').innerHTML = GROUPS.map((s) => `<div class="stage" id="st-${s.id}"><span class="si">${ic(s.icon)}</span><div class="sb"><div class="sn">${esc(s.name)}</div><div class="sd" id="sd-${s.id}">${esc(s.desc)}</div><div class="bar"><i id="bar-${s.id}"></i></div><div class="lanes" id="ln-${s.id}"></div></div><label class="chk"><input type="checkbox" id="ck-${s.id}" checked> Include</label></div>`).join('');
  }
  const TERM = ['done', 'failed', 'skipped', 'stopped'];
  function renderJob(d) {
    const job = d && d.job; const tasks = (d && d.tasks) || [];
    const lg = $('#log'); if (lg) lg.textContent = job ? tasks.map((t) => `${t.label.padEnd(44)} ${t.status.padEnd(8)} ${t.detail || ''}`).join('\n') : 'Nothing yet.';
    for (const g of GROUPS) {
      const el = $('#st-' + g.id); if (!el) continue; const ts = tasks.filter((t) => t.grp === g.id);
      if (!job) { el.className = 'stage'; continue; }
      if (!ts.length) { el.className = 'stage skip'; $('#sd-' + g.id).textContent = 'Not included in the last run'; $('#ln-' + g.id).innerHTML = ''; el.querySelector('.si').innerHTML = ic('minus'); continue; }
      const run = ts.some((t) => t.status === 'running' || t.status === 'queued'), pend = ts.some((t) => t.status === 'pending'), bad = ts.filter((t) => t.status === 'failed'), done = ts.filter((t) => t.status === 'done');
      const st = run || pend ? 'run' : bad.length ? 'bad' : done.length === ts.length ? 'ok' : 'skip';
      el.className = 'stage ' + st; el.querySelector('.si').innerHTML = st === 'run' ? '<span class="sp"></span>' : st === 'ok' ? ic('check') : st === 'bad' ? ic('x') : ic('minus');
      const avg = Math.round(ts.reduce((a, t) => a + (TERM.includes(t.status) ? 100 : t.progress || 0), 0) / ts.length); $('#bar-' + g.id).style.width = avg + '%';
      $('#sd-' + g.id).innerHTML = ts.length === 1 ? esc(ts[0].detail || g.desc) : `${done.length} of ${ts.length} finished${bad.length ? ` · <b style="color:var(--off)">${bad.length} failed</b>` : ''}`;
      $('#ln-' + g.id).innerHTML = ts.length === 1 && g.id !== 'news' ? '' : ts.map((t) => {
        const s = t.status === 'running' || t.status === 'queued' ? 'run' : t.status === 'done' ? 'ok' : t.status === 'failed' ? 'bad' : '';
        const i = s === 'run' ? '<span class="sp"></span>' : s === 'ok' ? ic('check-circle') : s === 'bad' ? ic('x-circle') : ic('circle-notch');
        return `<div class="lane ${s}"><span class="li">${i}</span><span><b>${esc(t.label)}</b><small>${esc(t.status === 'pending' ? 'Waiting for the member list…' : t.detail || t.status)}</small></span></div>`; }).join('');
    }
  }
  const banner = (kind, html) => { const m = $('#msg'); m.className = 'msgbar show ' + kind; m.innerHTML = html; };
  const setRunning = (on) => {
    const go = $('#go'); go.disabled = on; go.classList.toggle('busy', on); go.innerHTML = on ? '<span class="sp"></span>' : GO_LABEL; if (on) go.setAttribute('aria-label', 'Updating'); else go.removeAttribute('aria-label');
    $('#stop').style.display = on ? '' : 'none'; GROUPS.forEach((g) => { const c = $('#ck-' + g.id); if (c) c.disabled = on; });
  };

  // ---------------- watching a job ----------------
  let timer = null, lastNudge = 0, ticks = 0, current = null;
  async function poll() {
    let d; try { d = await api('worker', 'GET', '?action=progress'); } catch (e) { banner('bad', ic('warning') + ' ' + esc(e.message)); return; }
    renderJob(d); const job = d.job; current = job;
    const running = job && (job.status === 'running' || job.status === 'stopping'); setRunning(!!running);
    if (running) {
      banner('info', ic('lightning') + ' <b>Running on the server.</b> You can close this page — the update keeps going and the public site fills in as it finishes.');
      const live = d.tasks.filter((t) => !TERM.includes(t.status)); const stale = live.length && live.every((t) => Date.now() - new Date(t.updated_at).getTime() > 150000);
      if (stale && Date.now() - lastNudge > 60000) { lastNudge = Date.now(); api('worker', 'POST', '', { action: 'nudge' }).catch(() => {}); }
      if (++ticks % 5 === 0) refresh();
    } else {
      stopWatching(); refresh();
      if (job) { const failed = (job.summary && job.summary.failed) || []; const when = job.finished_at ? new Date(job.finished_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        if (job.status === 'stopped') banner('info', ic('stop') + ' Stopped. Whatever finished is saved; run again any time to continue.');
        else if (job.status === 'failed') banner('bad', ic('warning') + ' The last run was interrupted. Run again to continue.');
        else if (failed.length) banner('bad', ic('warning') + ' Finished with problems in: <b>' + esc(failed.join(', ')) + '</b>. Run again to retry just what is missing.');
        else banner('ok', ic('check-circle') + ' Last update finished' + (when ? ' on ' + esc(when) : '') + '. The public site shows the latest data.'); }
    }
  }
  function watch() { stopWatching(); ticks = 0; poll(); timer = setInterval(poll, 2000); }
  function stopWatching() { if (timer) { clearInterval(timer); timer = null; } }
  async function attach() { try { const d = await api('worker', 'GET', '?action=progress'); renderJob(d); if (d.job && ['running', 'stopping'].includes(d.job.status)) watch(); else if (d.job) { const f = d.job.finished_at || d.job.started_at; if (f) $('#last').textContent = 'Last update ' + ago(f); } } catch { /* first run: no jobs yet */ } }

  $('#go').onclick = async () => {
    const stages = GROUPS.filter((g) => $('#ck-' + g.id).checked).map((g) => g.id); if (!stages.length) { banner('bad', 'Tick at least one step to include.'); return; }
    setRunning(true);
    try { const r = await api('worker', 'POST', '', { action: 'start', stages }); if (r.empty) { setRunning(false); return; } watch(); }
    catch (e) { setRunning(false); banner('bad', ic('warning') + ' ' + esc(e.message)); }
  };
  $('#stop').onclick = async () => { $('#stop').innerHTML = '<span class="sp"></span>'; try { await api('worker', 'POST', '', { action: 'stop' }); } catch { /* ignore */ } setTimeout(() => { $('#stop').innerHTML = STOP_LABEL; }, 1500); poll(); };

  // ---------------- overview & sources ----------------
  const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const HGROUPS = [[/^sansad:ls:members/, 'Lok Sabha members'], [/^sansad:rs:members/, 'Rajya Sabha members'], [/^sansad:ministers/, 'Ministers'], [/^sansad:ls:attendance|^sansad:ls:sessions/, 'Attendance sessions'], [/^sansad:ls:past/, 'Past Lok Sabha lists'], [/^feed:/, 'News feeds']];
  async function drawHashes() {
    try {
      const { rows } = await api('registry', 'GET', '?action=hashes'); const g = new Map();
      for (const r of rows) { const name = (HGROUPS.find(([re]) => re.test(r.key)) || [0, 'Other'])[1]; const o = g.get(name) || { n: 0, items: 0, checked: null, changed: null }; o.n++; o.items += r.item_count || 0;
        if (!o.checked || r.checked_at > o.checked) o.checked = r.checked_at; if (!o.changed || (r.changed_at || '') > o.changed) o.changed = r.changed_at; g.set(name, o); }
      $('#hashTbl').innerHTML = [...g].map(([k, o]) => `<tr><td><b>${esc(k)}</b><div class="fine" style="margin:0">${o.n} fingerprint${o.n == 1 ? '' : 's'}${o.items ? ' · ' + o.items.toLocaleString('en-IN') + ' items' : ''}</div></td><td style="text-align:right;white-space:nowrap">Checked ${ago(o.checked)}<div class="fine" style="margin:0">Last change ${ago(o.changed)}</div></td></tr>`).join('') || '<tr><td class="fine">No fingerprints yet — run an update.</td></tr>';
    } catch { /* optional card */ }
  }
  async function refresh() {
    drawHashes();
    try {
      const [st, ov, src] = await Promise.all([api('registry', 'GET', '?action=status'), api('news', 'GET', '?action=overview'), api('news', 'GET', '?action=sources')]);
      $('#last').textContent = `Members ${ago(st.members_updated_at)} · attendance ${ago(st.attendance_updated_at)}`;
      const S = (n, l) => `<div class="stat"><b class="tnum">${Number(n).toLocaleString('en-IN')}</b><span>${l}</span></div>`;
      $('#stats').innerHTML = S(st.lok_sabha, 'Lok Sabha members') + S(st.rajya_sabha, 'Rajya Sabha members') + S(st.with_positions, 'With positions loaded') + S(st.attendance_rows, 'Attendance records') + S(ov.articles.relevant, 'Stories about members') + S(ov.mentions, 'Member mentions') + S(ov.articles.irrelevant, 'Skipped (no member named)') + S(ov.versions, 'Story versions saved');
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
