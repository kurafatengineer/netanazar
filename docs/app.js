// Shared helpers for NetaNazar pages: token box with saved/verified state, busy buttons, step lists, messages.
const NN = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const get = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const DEFAULT_BASE = 'https://qajsvaeamujtpdsutzgo.supabase.co/functions/v1';
  const cfg = () => ({ base: ($('base')?.value || get('nn_base') || DEFAULT_BASE).trim(), tok: ($('tok')?.value || get('nn_tok') || '').trim() });

  async function api(fn, method, qs, body) {
    const c = cfg();
    let r; try { r = await fetch(`${c.base}/${fn}${qs || ''}`, { method, headers: { 'x-token': c.tok, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); }
    catch { throw new Error('Cannot reach the server (check internet / function URL)'); }
    if (r.status === 403) throw new Error('Token does not match the secret in Supabase');
    const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 400) throw new Error(j.error || 'Server error ' + r.status); return j;
  }

  // ---- token box ----
  function setup({ onReady }) {
    const box = $('setup'); box.innerHTML = `
      <h2>Connection</h2>
      <div class="row"><input id="tok" type="password" placeholder="Paste your REGISTRY_TOKEN" size="34" autocomplete="off">
        <button id="tokSave" class="ghost" style="display:none">Save</button><span id="tokChip" class="chip">Not set</span></div>
      <details><summary>Advanced: function address</summary><input id="base" size="52"></details>`;
    $('tok').value = get('nn_tok'); $('base').value = get('nn_base') || DEFAULT_BASE;
    let saved = get('nn_tok');
    const chip = (cls, t, spin) => { $('tokChip').className = 'chip ' + cls; $('tokChip').innerHTML = (spin ? '<span class="spin"></span>' : '') + t; };
    const dirty = () => { const d = $('tok').value.trim() !== saved && $('tok').value.trim() !== ''; $('tokSave').style.display = d ? '' : 'none'; if (d) chip('busy', 'Not saved yet'); };
    async function verify() {
      if (!saved) return chip('', 'Not set');
      chip('busy', 'Checking…', true);
      try { await api('registry', 'GET', '?action=ping'); chip('ok', '✓ Token saved · connected'); onReady && onReady(); }
      catch (e) { chip('bad', '✗ ' + e.message); }
    }
    $('tok').addEventListener('input', dirty); $('base').addEventListener('change', () => { put('nn_base', $('base').value.trim()); verify(); });
    $('tokSave').onclick = () => { saved = $('tok').value.trim(); put('nn_tok', saved); put('nn_base', $('base').value.trim()); $('tokSave').style.display = 'none'; verify(); };
    verify();
  }

  // ---- status message under a button ----
  function msg(el, kind, html) { el.className = 'msg show ' + kind; el.innerHTML = (kind === 'busy' ? '<span class="spin"></span> ' : kind === 'ok' ? '✓ ' : '✗ ') + html; }
  function clear(el) { el.className = 'msg'; el.innerHTML = ''; }

  // ---- busy button: spinner + label while running, tick/cross after ----
  async function busy(btn, busyLabel, fn) {
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${busyLabel}`;
    try { const r = await fn(); btn.innerHTML = '✓ Done'; setTimeout(() => { btn.innerHTML = old; }, 2500); return r; }
    catch (e) { btn.innerHTML = '✗ Failed'; setTimeout(() => { btn.innerHTML = old; }, 3000); throw e; }
    finally { btn.disabled = false; }
  }

  // ---- step list ----
  function steps(ul) {
    ul.className = 'steps'; ul.innerHTML = ''; const m = new Map();
    const icon = { wait: '○', busy: '<span class="spin"></span>', ok: '✓', bad: '✗' };
    return {
      add(id, label) { const li = document.createElement('li'); li.innerHTML = `<span class="ic wait">○</span><span class="t">${esc(label)}</span>`; ul.appendChild(li); m.set(id, li); },
      set(id, st, text) { const li = m.get(id); if (!li) return; const ic = li.querySelector('.ic'); ic.className = 'ic ' + st; ic.innerHTML = icon[st]; if (text != null) li.querySelector('.t').innerHTML = text; },
    };
  }
  return { $, esc, get, put, cfg, api, setup, msg, clear, busy, steps };
})();
