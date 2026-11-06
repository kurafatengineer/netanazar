/* NetaNazar — public site. Reads only public, read-only views with the publishable key. */
(() => {
  const CFG = window.NN_CONFIG || { url: 'https://qajsvaeamujtpdsutzgo.supabase.co', key: 'sb_publishable_qy5xkrXKXL-bFufW2N2r-g_5Htbg85y' };
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nz = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const IST = 'Asia/Kolkata';

  // ---------------- data ----------------
  async function api(path, extra) {
    const r = await fetch(CFG.url + '/rest/v1/' + path, { headers: { apikey: CFG.key, ...(extra || {}) } });
    if (!r.ok) throw new Error('Could not load data (' + r.status + ')');
    return r.json();
  }
  async function apiAll(path) {
    const out = []; for (let off = 0; ; off += 1000) {
      const part = await api(path + (path.includes('?') ? '&' : '?') + 'limit=1000&offset=' + off);
      out.push(...part); if (part.length < 1000) break;
    } return out;
  }
  let MEM = [], BYID = new Map(), PARTIES = new Map(), SEATS = [], STATES = [], UPDATED = null, TREND = [];
  async function loadMembers() {
    const cols = 'id,name_en,name_hi,name_variants,party,house,constituency,state,photo_url,gender,terms_count,lok_sabha_terms,term_label,term_start,term_end,minister_position,elected_current,is_current,imported_at';
    MEM = await apiAll('v_members?select=' + cols + '&order=name_en.asc');
    BYID = new Map(); PARTIES = new Map(); const seats = new Map(), states = new Map(); UPDATED = null;
    for (const m of MEM) {
      m._k = nz([m.name_en, m.name_hi, ...(m.name_variants || [])].filter(Boolean).join(' | ')); m._n = nz(m.name_en);
      BYID.set(m.id, m);
      if (m.is_current !== false) {
        if (m.party) PARTIES.set(m.party, (PARTIES.get(m.party) || 0) + 1);
        if (m.constituency) seats.set(m.constituency, m);
        if (m.state) states.set(m.state, (states.get(m.state) || 0) + 1);
      }
      if (m.imported_at && (!UPDATED || m.imported_at > UPDATED)) UPDATED = m.imported_at;
    }
    SEATS = [...seats.entries()].map(([name, m]) => ({ name, m, k: nz(name) }));
    STATES = [...states.entries()].map(([name, n]) => ({ name, n, k: nz(name) }));
  }
  async function loadTrending() { try { TREND = await api('v_trending?select=politician_id,stories&order=stories.desc&limit=12'); } catch { TREND = []; } }

  // ---------------- helpers ----------------
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const isMP = (m) => m.house === 'Lok Sabha' || m.house === 'Rajya Sabha';
  const roleOf = (m) => m.is_current === false ? (isMP(m) ? 'Former MP' : 'Former MLA') : (isMP(m) ? 'Sitting MP' : 'MLA');
  const seatOf = (m) => m.constituency || m.state || '';
  function avatar(m, size) {
    const ring = m.is_current === false ? 'ring-off' : 'ring-ok';
    return `<span class="av av-${size} ${ring}" title="${esc(roleOf(m))}">${esc(initials(m.name_en))}${m.photo_url ? `<img loading="lazy" referrerpolicy="no-referrer" alt="" src="${esc(m.photo_url)}" onerror="this.remove()">` : ''}</span>`;
  }
  const fmtDay = (iso) => {
    const d = new Date(iso + 'T00:00:00+05:30'); const today = new Date(new Date().toLocaleString('en-US', { timeZone: IST })); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(d.toLocaleString('en-US', { timeZone: IST }))) / 864e5);
    const wk = d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: IST });
    const full = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: IST });
    return { day: d.toLocaleDateString('en-IN', { day: 'numeric', timeZone: IST }), mon: d.toLocaleDateString('en-IN', { month: 'short', timeZone: IST }) + ' ' + String(d.getFullYear()).slice(2),
      label: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : wk, full };
  };
  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const kindOf = (domain, name) => { const d = String(domain || '').toLowerCase();
    if (/facebook\.com|fb\.com/.test(d)) return { icon: 'facebook-logo', label: 'Facebook' }; if (/instagram\.com/.test(d)) return { icon: 'instagram-logo', label: 'Instagram' };
    if (/(^|\.)x\.com|twitter\.com/.test(d)) return { icon: 'x-logo', label: 'X (Twitter)' }; if (/youtube\.com|youtu\.be/.test(d)) return { icon: 'youtube-logo', label: 'YouTube' };
    return { icon: 'globe', label: name || domain || 'Website' }; };

  // ---------------- search ----------------
  function suggestions(q) {
    const qn = nz(q); const out = { members: [], parties: [], seats: [] };
    if (!qn) { out.members = TREND.map((t) => BYID.get(t.politician_id)).filter(Boolean).slice(0, 5); out.trending = true; return out; }
    const toks = qn.split(' ');
    const scored = [];
    for (const m of MEM) {
      if (!toks.every((t) => m._k.includes(t))) continue;
      const s = m._n.startsWith(qn) ? 0 : m._n.split(' ').some((w) => w.startsWith(toks[0])) ? 1 : 2;
      scored.push([s + (m.is_current === false ? 5 : 0), m]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].name_en.localeCompare(b[1].name_en)); out.members = scored.slice(0, 6).map((x) => x[1]);
    out.parties = [...PARTIES.entries()].filter(([p]) => nz(p).includes(qn)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, n]) => ({ name, n }));
    out.seats = [...SEATS.filter((s) => s.k.includes(qn)).slice(0, 4).map((s) => ({ kind: 'seat', name: s.name, sub: s.m.name_en + ' · ' + (s.m.state || '') })),
      ...STATES.filter((s) => s.k.includes(qn)).slice(0, 2).map((s) => ({ kind: 'state', name: s.name, sub: s.n + ' members' }))].slice(0, 5);
    return out;
  }
  function mountSearch(host, compact) {
    host.innerHTML = `<div class="search ${compact ? 'compact' : ''}"><label class="field"><span class="sr">Search members, parties or constituencies</span>${ic('magnifying-glass')}<input type="search" autocomplete="off" spellcheck="false" aria-label="Search members, parties or constituencies" role="combobox" aria-expanded="false"></label><div class="suggest" hidden role="listbox"></div></div>`;
    const input = $('input', host), box = $('.suggest', host); let items = [], idx = -1, tick = 0;
    const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); idx = -1; };
    const go = (it) => { close(); input.value = ''; location.hash = it.href; };
    function render() {
      const s = suggestions(input.value); items = [];
      const mk = (cls, html, href) => { items.push({ href }); return `<button class="sg" role="option" data-i="${items.length - 1}">${html}</button>`; };
      let h = '';
      if (s.members.length) { h += `<div class="sg-label">${s.trending ? 'In the news this week' : 'Members'}</div>` + s.members.map((m) => mk('', `${avatar(m, 's')}<span class="t"><div class="n">${esc(m.name_en)}${m.name_hi ? ` <span style="font-weight:400;color:var(--muted)">${esc(m.name_hi)}</span>` : ''}</div><div class="s">${esc(m.party || '')} · ${esc(seatOf(m))}${m.is_current === false ? ' · Former' : ''}</div></span><span class="go">${ic('caret-right')}</span>`, '#/m/' + m.id)).join(''); }
      if (s.parties.length) { h += '<div class="sg-label">Parties</div>' + s.parties.map((p) => mk('', `<span class="badge">${ic('flag')}</span><span class="t"><div class="n">${esc(p.name)}</div><div class="s">${p.n} sitting members</div></span><span class="go">${ic('caret-right')}</span>`, '#/party/' + encodeURIComponent(p.name))).join(''); }
      if (s.seats.length) { h += '<div class="sg-label">Constituencies &amp; states</div>' + s.seats.map((p) => mk('', `<span class="badge">${ic('map-pin')}</span><span class="t"><div class="n">${esc(p.name)}</div><div class="s">${esc(p.sub)}</div></span><span class="go">${ic('caret-right')}</span>`, '#/' + p.kind + '/' + encodeURIComponent(p.name))).join(''); }
      if (!h) h = `<div class="empty" style="padding:20px">${ic('magnifying-glass')}<div>No member, party or constituency found for “${esc(input.value)}”.</div></div>`;
      box.innerHTML = h; box.hidden = false; input.setAttribute('aria-expanded', 'true'); idx = -1;
    }
    const mark = () => box.querySelectorAll('.sg').forEach((b, i) => b.classList.toggle('on', i === idx));
    input.addEventListener('input', () => { clearTimeout(tick); tick = setTimeout(render, 60); });
    host.addEventListener('pointerdown', () => { if (MEM.length && box.hidden) render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden && MEM.length) { render(); } idx = Math.min(items.length - 1, idx + 1); mark(); box.querySelectorAll('.sg')[idx]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
      else if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); const it = items[idx >= 0 ? idx : 0]; if (it) go(it); else if (input.value.trim()) { const v = input.value.trim(); close(); location.hash = '#/q/' + encodeURIComponent(v); } }
    });
    box.addEventListener('mousedown', (e) => { const b = e.target.closest('.sg'); if (b) { e.preventDefault(); go(items[+b.dataset.i]); } });
    document.addEventListener('click', (e) => { if (!host.contains(e.target)) close(); });
    return input;
  }

  // ---------------- views ----------------
  const view = $('#view'); const ic = window.ic;
  function setTitle(t) { document.title = t ? t + ' · NetaNazar' : 'NetaNazar · Know your MP'; }
  function memberRow(m) {
    return `<a class="row" href="#/m/${m.id}">${avatar(m, 'm')}<span class="t"><div class="n">${esc(m.name_en)}${m.name_hi ? `<small>${esc(m.name_hi)}</small>` : ''}</div><div class="s">${esc(m.party || '')} · ${esc(seatOf(m))}${m.state && m.constituency ? ', ' + esc(m.state) : ''}</div></span><span class="st ${m.is_current === false ? 'off' : 'ok'}"><span class="dot"></span>${esc(roleOf(m))}</span></a>`;
  }
  function home() {
    setTitle(''); const cur = MEM.filter((m) => m.is_current !== false);
    const ls = cur.filter((m) => m.house === 'Lok Sabha').length, rs = cur.filter((m) => m.house === 'Rajya Sabha').length;
    view.innerHTML = `<section class="hero"><div class="wrap"><h1>Know your <em>MP</em>.</h1><div id="heroSearch"></div>
      ${cur.length ? `<div class="stats"><span>${ic('users')} <b class="tnum">${cur.length}</b> sitting members</span><span>${ic('bank')} <b class="tnum">${ls}</b> Lok Sabha</span><span>${ic('buildings')} <b class="tnum">${rs}</b> Rajya Sabha</span>${UPDATED ? `<span>${ic('clock')} Updated ${esc(new Date(UPDATED).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST }))}</span>` : ''}</div>` : ''}</div></section>
      <div class="wrap" id="homeBody"></div>`;
    const inp = mountSearch($('#heroSearch'), false); if (matchMedia('(min-width:700px)').matches) inp.focus({ preventScroll: true });
    const body = $('#homeBody');
    if (!MEM.length) { body.innerHTML = `<div class="empty">${ic('database')}<div><b>No members loaded yet.</b></div><div>The data is refreshed from the admin page.</div></div>`; return; }
    const t = TREND.map((x) => ({ m: BYID.get(x.politician_id), n: x.stories })).filter((x) => x.m);
    if (t.length) body.innerHTML = `<section class="section"><h2>${ic('fire')} In the news this week</h2><div class="rail">${t.map((x) => `<a class="tcard" href="#/m/${x.m.id}" style="text-decoration:none;color:inherit">${avatar(x.m, 'm')}<span><div class="n">${esc(x.m.name_en)}</div><div class="s">${esc(x.m.party || '')} · ${esc(seatOf(x.m))}</div></span><span class="hot">${x.n}<small>STORIES</small></span></a>`).join('')}</div></section>`;
  }
  function group(kind, arg) {
    const decoded = arg; let title = '', sub = '', list = [], seg = true;
    if (kind === 'party') { list = MEM.filter((m) => m.party === decoded && m.is_current !== false); title = decoded; sub = 'Party'; }
    else if (kind === 'seat') { list = MEM.filter((m) => m.constituency === decoded && m.is_current !== false); title = decoded; sub = 'Constituency'; seg = false; }
    else if (kind === 'state') { list = MEM.filter((m) => m.state === decoded && m.is_current !== false); title = decoded; sub = 'State'; }
    else { const qn = nz(decoded); const toks = qn.split(' '); list = MEM.filter((m) => toks.every((t) => m._k.includes(t))); title = '“' + decoded + '”'; sub = 'Search results'; seg = false; }
    setTitle(title);
    view.innerHTML = `<div class="wrap"><a class="back" href="#/">${ic('arrow-left')} Home</a><div class="page-head"><div><div class="sub">${esc(sub)}</div><h1>${esc(title)}</h1></div><div class="spacer"></div>${seg ? '<div class="seg" id="seg"></div>' : ''}</div><div id="listBox"></div></div>`;
    let house = '', shown = 50;
    const draw = () => {
      const rows = list.filter((m) => !house || m.house === house); const slice = rows.slice(0, shown);
      $('#listBox').innerHTML = rows.length ? `<div class="list">${slice.map(memberRow).join('')}</div>${rows.length > shown ? `<button class="more" id="more">Show ${Math.min(50, rows.length - shown)} more of ${rows.length - shown}</button>` : ''}` : `<div class="empty">${ic('magnifying-glass')}<div>No members found.</div></div>`;
      $('#more')?.addEventListener('click', () => { shown += 50; draw(); });
      const hs = [...new Set(list.map((m) => m.house))]; const sg = $('#seg');
      if (sg) { sg.innerHTML = hs.length > 1 ? ['', ...hs].map((h) => `<button data-h="${esc(h)}" class="${h === house ? 'on' : ''}">${h || 'All'} <span class="tnum">${h ? list.filter((m) => m.house === h).length : list.length}</span></button>`).join('') : ''; }
    };
    draw(); $('#seg')?.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { house = b.dataset.h; shown = 50; draw(); } });
    mountSearchTop();
  }

  let TL = new Map();
  async function member(id) {
    const m = BYID.get(id);
    if (!m) { view.innerHTML = `<div class="wrap"><a class="back" href="#/">${ic('arrow-left')} Home</a><div class="empty">${ic('user')}<div>Member not found.</div></div></div>`; return; }
    setTitle(m.name_en); const role = roleOf(m); const ok = m.is_current !== false;
    view.innerHTML = `<div class="wrap"><a class="back" href="javascript:history.length>1?history.back():location.hash='#/'">${ic('arrow-left')} Back</a>
      <section class="profile-head">${avatar(m, 'l')}<div><h1>${esc(m.name_en)}</h1>${m.name_hi ? `<div class="hi">${esc(m.name_hi)}</div>` : ''}
        <div class="chips"><span class="chip ${ok ? 'ok' : 'off'}"><span class="dot"></span>${esc(role)}</span>${m.party ? `<a class="chip accent" href="#/party/${encodeURIComponent(m.party)}" style="text-decoration:none">${ic('flag')}${esc(m.party)}</a>` : ''}<span class="chip">${esc(m.house)}</span>${m.minister_position ? `<span class="chip sand">${ic('seal-check')}${esc(m.minister_position)}</span>` : ''}</div>
        <div class="facts">${m.constituency ? `<span>${ic('map-pin')} <b><a href="#/seat/${encodeURIComponent(m.constituency)}" style="color:inherit">${esc(m.constituency)}</a></b></span>` : ''}${m.state ? `<span><a href="#/state/${encodeURIComponent(m.state)}" style="color:inherit">${esc(m.state)}</a></span>` : ''}
          ${m.lok_sabha_terms && m.lok_sabha_terms.length ? `<span>Lok Sabha <b class="tnum">${esc(m.lok_sabha_terms.join(', '))}</b> · ${m.terms_count} term${m.terms_count == 1 ? '' : 's'}</span>` : (m.terms_count ? `<span><b>${m.terms_count}</b> term${m.terms_count == 1 ? '' : 's'}</span>` : '')}
          ${m.term_label && m.house === 'Rajya Sabha' ? `<span>Term <b class="tnum">${esc(m.term_label)}</b></span>` : ''}${m.elected_current ? `<span>${ic('calendar-check')} <b>${esc(m.elected_current)}</b></span>` : ''}</div></div></section>
      <div class="cols"><div><section class="card" id="newsCard"><h3>${ic('path')} In the news</h3><div class="skel" style="height:90px"></div></section></div>
      <aside class="aside"><section class="card" id="attCard"><h3>${ic('chart-bar')} Attendance</h3><div class="skel" style="height:140px"></div></section><section class="card" id="posCard"><h3>${ic('clipboard-text')} Positions held</h3><div class="skel" style="height:90px"></div></section></aside></div></div>`;
    mountSearchTop(); window.scrollTo(0, 0);
    const q = (p) => api(p).catch(() => null);
    const [det, att, news] = await Promise.all([q('v_member_detail?select=positions_held,details_fetched_at&id=eq.' + id), q('v_attendance?select=session_no,session_period,sitting_days,signed_days,loksabha&order=session_no.asc&politician_id=eq.' + id), q('v_news_timeline?select=article_id,url,title,source_name,source_domain,day,at,status&order=at.desc&limit=600&politician_id=eq.' + id)]);
    if (location.hash !== '#/m/' + id) return;
    drawAttendance(m, att); drawPositions(det && det[0]); drawNews(news, id);
  }
  function drawAttendance(m, att) {
    const el = $('#attCard'); if (!el) return;
    if (m.house !== 'Lok Sabha') { el.innerHTML = `<h3>${ic('chart-bar')} Attendance</h3><div class="note">Attendance is available for Lok Sabha members. Rajya Sabha attendance is not published in a form we can read yet.</div>`; return; }
    if (!att || !att.length) { el.innerHTML = `<h3>${ic('chart-bar')} Attendance</h3><div class="empty" style="padding:18px 0">${ic('chart-bar')}<div>No attendance recorded yet.</div></div>`; return; }
    if (m.minister_position) { el.innerHTML = `<h3>${ic('chart-bar')} Attendance</h3><div class="note">${esc(m.minister_position)}s do not sign the attendance register, so a percentage would be misleading. The Speaker and ministers are exempt.</div>`; return; }
    const sig = att.reduce((a, x) => a + Math.min(x.signed_days || 0, x.sitting_days || 0), 0), sit = att.reduce((a, x) => a + (x.sitting_days || 0), 0); const pc = sit ? Math.round(100 * sig / sit) : 0;
    const col = pc >= 75 ? 'g-ok' : pc >= 50 ? 'g-warn' : 'g-off';
    el.innerHTML = `<h3>${ic('chart-bar')} Attendance</h3><div class="big tnum">${pc}<small>%</small></div><div class="bar"><i class="${col}" style="width:${pc}%"></i></div><div class="fine" style="margin-top:4px">Signed on <b class="tnum">${sig}</b> of <b class="tnum">${sit}</b> sitting days · 18th Lok Sabha</div>
      <div class="reg" role="img" aria-label="Attendance by session">${att.map((a) => { const p = a.sitting_days ? Math.min(100, Math.round(100 * Math.min(a.signed_days, a.sitting_days) / a.sitting_days)) : 0; const c = p >= 75 ? 'g-ok' : p >= 50 ? 'g-warn' : 'g-off';
        return `<div class="s" title="Session ${a.session_no}: ${a.signed_days} of ${a.sitting_days} days (${esc(a.session_period || '')})"><div class="col"><i class="${c}" style="height:${p}%"></i></div><label>S${a.session_no}</label></div>`; }).join('')}</div>`;
  }
  function drawPositions(d) {
    const el = $('#posCard'); if (!el) return; const pos = d && Array.isArray(d.positions_held) ? d.positions_held : [];
    if (!pos.length) { el.innerHTML = `<h3>${ic('clipboard-text')} Positions held</h3><div class="note">Positions will appear after the next data refresh.</div>`; return; }
    const recent = (x) => x.added_at && Date.now() - new Date(x.added_at).getTime() < 30 * 864e5;
    el.innerHTML = `<h3>${ic('clipboard-text')} Positions held</h3><ul class="pos">${pos.map((x) => `<li><span class="p">${esc(x.period)}</span><span class="x">${esc(x.text)}${recent(x) ? ' <span class="chip accent new">New</span>' : ''}</span></li>`).join('')}</ul>`;
  }
  function drawNews(rows, id) {
    const el = $('#newsCard'); if (!el) return;
    if (!rows) { el.innerHTML = `<h3>${ic('path')} In the news</h3><div class="note">Could not load news right now.</div>`; return; }
    if (!rows.length) { el.innerHTML = `<h3>${ic('path')} In the news</h3><div class="empty">${ic('newspaper')}<div><b>Not in the news yet.</b></div><div>Only days when this member was named in a story appear here.</div></div>`; return; }
    TL = new Map(rows.map((r) => [r.article_id, r]));
    const days = new Map(); for (const r of rows) { if (!days.has(r.day)) days.set(r.day, new Map()); const k = r.source_domain || r.source_name || 'other'; const dm = days.get(r.day); if (!dm.has(k)) dm.set(k, { name: r.source_name || r.source_domain || 'Website', domain: r.source_domain, items: new Map() }); dm.get(k).items.set(r.article_id, r); }
    const total = new Set(rows.map((r) => r.article_id)).size;
    let h = `<h3>${ic('path')} In the news <span class="chip" style="margin-left:auto;text-transform:none;letter-spacing:0">${total} stor${total == 1 ? 'y' : 'ies'} · ${days.size} day${days.size == 1 ? '' : 's'}</span></h3><div class="road">`; let first = true;
    for (const [day, srcs] of days) {
      const f = fmtDay(day); const n = [...srcs.values()].reduce((a, s) => a + s.items.size, 0);
      h += `<div class="stone ${first ? 'open' : ''}" data-day="${esc(day)}"><button class="head" aria-expanded="${first}"><span class="d"><b class="tnum">${esc(f.day)}</b><span>${esc(f.mon)}</span></span><span class="w"><div class="a">${esc(f.label)}</div><div class="b">${n} stor${n == 1 ? 'y' : 'ies'} · ${srcs.size} source${srcs.size == 1 ? '' : 's'}</div></span><span class="car">${ic('caret-down')}</span></button>
        <div class="flow" ${first ? '' : 'hidden'}>${[...srcs.values()].map((s) => { const k = kindOf(s.domain, s.name); return `<div class="src"><div class="sh"><span class="ico">${ic(k.icon)}</span>${esc(k.icon === 'globe' ? s.name : k.label)} <small>${s.items.size}</small></div><div class="arts">${[...s.items.values()].map((a) => `<div class="art"><button data-a="${esc(a.article_id)}"><div class="tt">${esc(a.title || a.url)}</div><div class="mm"><span>${esc(new Date(a.at).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' }))}</span>${a.status === 'deleted' ? '<span class="chip off">Removed</span>' : ''}</div></button></div>`).join('')}</div></div>`; }).join('')}</div></div>`;
      first = false;
    }
    h += '</div>' + (rows.length >= 600 ? '<div class="fine">Showing the most recent stories.</div>' : '');
    el.innerHTML = h;
    el.addEventListener('click', (e) => {
      const hd = e.target.closest('button.head'); if (hd) { const st = hd.parentNode; const open = st.classList.toggle('open'); hd.setAttribute('aria-expanded', open); $('.flow', st).hidden = !open; return; }
      const a = e.target.closest('button[data-a]'); if (a) openStory(a.dataset.a);
    });
  }

  // ---------------- story sheet ----------------
  async function openStory(aid) {
    const r = TL.get(aid); if (!r) return; const k = kindOf(r.source_domain, r.source_name); const scrim = $('#scrim'), sh = $('#sheet');
    const head = `<div class="top"><span class="chip accent">${ic(k.icon)}${esc(k.icon === 'globe' ? (r.source_name || r.source_domain) : k.label)}</span>${r.status === 'deleted' ? '<span class="chip off">Removed by publisher</span>' : ''}<button class="iconbtn x" id="sx" aria-label="Close">${ic('x')}</button></div>
      <h2>${esc(r.title || r.url)}</h2><div class="meta"><span>${ic('calendar-blank')} ${esc(fmtTime(r.at))} IST</span>${r.source_domain ? `<span>${ic('link')} ${esc(r.source_domain)}</span>` : ''}</div>`;
    sh.innerHTML = head + `<h3 style="font:600 12px var(--f-ui);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:20px 0 6px">What changed</h3><div id="hist"><div class="skel" style="height:56px"></div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px"><a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open original ${ic('arrow-up-right')}</a><button class="btn ghost" id="cp">${ic('copy')} Copy link</button></div>
      <div class="fine">We keep headlines and a summary of edits only. The full story stays on the publisher’s site, which also doesn’t allow being opened inside other pages.</div>`;
    scrim.classList.add('open'); $('#sx').focus();
    $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(r.url); $('#cp').innerHTML = ic('check') + ' Copied'; } catch { prompt('Copy this link', r.url); } };
    let ch = []; try { ch = await api('v_article_changes?select=version_no,title,captured_at,added_lines,removed_lines&order=version_no.asc&article_id=eq.' + aid); } catch { /* optional */ }
    const li = [];
    li.push(`<li><b>Published</b><small>${esc(fmtTime(r.at))}</small></li>`);
    ch.forEach((v, i) => { if (i === 0) li.push(`<li><b>First seen by NetaNazar</b><small>${esc(fmtTime(v.captured_at))}</small></li>`);
      else { const prev = ch[i - 1]; const t = prev.title && v.title && prev.title !== v.title;
        li.push(`<li class="ed"><b>Edited by the publisher</b><small>${esc(fmtTime(v.captured_at))}${v.added_lines != null ? ` · <span style="color:var(--ok)">+${v.added_lines}</span> / <span style="color:var(--off)">−${v.removed_lines}</span> lines` : ''}</small>${t ? `<small>Headline: “${esc(prev.title)}” → “${esc(v.title)}”</small>` : ''}</li>`); } });
    if (r.status === 'deleted') li.push(`<li class="del"><b>No longer available</b><small>The publisher removed this page.</small></li>`);
    const hist = $('#hist'); if (hist) hist.innerHTML = `<ul class="hist">${li.join('')}</ul>` + (ch.length <= 1 && r.status !== 'deleted' ? '<div class="fine" style="margin-top:6px">No edits since we first saw it.</div>' : '');
  }
  function closeStory() { $('#scrim').classList.remove('open'); }

  // ---------------- chrome ----------------
  let topSearch = null;
  function mountSearchTop() { const h = $('#topSearch'); if (!h) return; h.hidden = false; $('.topbar')?.classList.add('has-search'); if (!h.dataset.m) { mountSearch(h, true); h.dataset.m = '1'; } }
  function route() {
    closeStory(); const h = decodeURIComponent((location.hash || '#/').slice(1)); const parts = h.split('/'); const k = parts[1] || '';
    const top = $('#topSearch'); if (top) top.hidden = true; $('.topbar')?.classList.remove('has-search');
    if (k === 'm') member(parts.slice(2).join('/')); else if (['party', 'seat', 'state', 'q'].includes(k)) group(k, parts.slice(2).join('/')); else home();
    window.scrollTo(0, 0);
  }
  function theme() {
    const t = safeGet('nn_theme'); if (t) document.documentElement.setAttribute('data-theme', t);
    $('#themeBtn')?.addEventListener('click', () => { const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const nx = cur === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nx); safeSet('nn_theme', nx); });
  }
  async function boot() {
    theme(); $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim' || e.target.closest('#sx')) closeStory(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStory(); });
    view.innerHTML = `<div class="wrap"><div class="hero"><div class="skel" style="height:64px;max-width:680px;margin:60px auto"></div></div></div>`;
    try { await Promise.all([loadMembers(), loadTrending()]); } catch (e) { view.innerHTML = `<div class="wrap"><div class="empty">${ic('warning')}<div><b>Couldn’t load the data.</b></div><div>${esc(e.message)}</div></div></div>`; return; }
    addEventListener('hashchange', route); route();
  }
  window.NN_SITE = { boot };
  document.addEventListener('DOMContentLoaded', boot);
})();
