// The open vault: the file list an approved user sees for one hour after using their download.
// Shared by access.html (signed in) and get.html (emailed link).
window.SVVault = (() => {
'use strict';
const cfg = window.SV_CONFIG || {};
const endpoint = (cfg.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/redeem';
const KEY = 'sv-vault-session';
const size = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const FILE = '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 3h10l5 5v17H7z"/><path d="M17 3v5h5M14.5 12v8M11 17l3.5 3.5L18 17"/></svg>';

// Kept only in this tab, only until the window closes, so a refresh doesn't lose the files.
function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }
function saved() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && new Date(s.session_expires) > new Date()) return s; } catch { /* ignore */ }
  return null;
}
async function call(body, jwt) {
  const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey || '' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* keep empty */ }
  return { ok: res.ok, status: res.status, body: data };
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function render(container, s) {
  save(s);
  const parts = s.files.filter(f => f.kind === 'part');
  const until = new Date(s.session_expires).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  container.innerHTML = `<div class="state">
    <span class="pill approved">Vault open</span>
    <h2>Your files are ready.</h2>
    <p class="sub">Your one-time download has been used. For the next hour you can fetch each file below; the window closes at <b>${until}</b> (<span id="vaultLeft"></span> left).</p>
    <ol class="howto">
      <li>Download all ${parts.length} parts of the app and <b>Join-SudarshanaVyuha.bat</b> into <b>one folder</b>.</li>
      <li>Double-click <b>Join-SudarshanaVyuha.bat</b>. It rebuilds the app and checks it's intact.</li>
      <li>Right-click the finished zip, choose <b>Extract All</b>, then open <b>SudarshanaVyuha.exe</b>.</li>
    </ol>
    <div class="files" id="vaultFiles"></div>
    <p class="msg" hidden></p>
    <p class="fineprint">If a download stops halfway, press its button again while the window is open. Windows may warn about the .bat file because it came from the internet: choose <b>More info → Run anyway</b>.</p>
  </div>`;
  const list = container.querySelector('#vaultFiles');
  const msg = container.querySelector('.msg');
  let n = 0;
  s.files.forEach(f => {
    const row = el('div', 'fileRow' + (f.kind === 'optional' ? ' optional' : ''));
    row.innerHTML = FILE;
    const info = el('div', 'fileInfo');
    const label = f.kind === 'part' ? `App, part ${++n} of ${parts.length}` : f.kind === 'joiner' ? 'Joins and checks the parts' : f.kind === 'optional' ? 'Optional: on-device AI analyst add-on' : 'File';
    info.append(el('b', null, f.name), el('span', null, `${label} · ${size(f.size)}`));
    const btn = el('button', 'btn ghost', (s.started || []).includes(f.name) ? 'Download again' : 'Download');
    btn.type = 'button';
    btn.onclick = async () => {
      msg.hidden = true; btn.disabled = true; const was = btn.textContent; btn.textContent = 'Opening…';
      let r;
      try { r = await call({ action: 'file', session: s.session, name: f.name }); } catch { r = { ok: false, body: {} }; }
      btn.disabled = false;
      if (!r.ok || !r.body.url) {
        btn.textContent = was;
        msg.hidden = false; msg.className = 'msg err';
        msg.textContent = r.body.error || 'That file couldn\'t be fetched. Try again.';
        if (r.body.state === 'closed' || r.body.state === 'revoked') closeUp();
        return;
      }
      btn.textContent = 'Download again';
      row.classList.add('started');
      s.started = [...new Set([...(s.started || []), f.name])]; save(s);
      const a = document.createElement('a'); a.href = r.body.url; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
    };
    row.append(info, btn);
    list.append(row);
  });

  const left = container.querySelector('#vaultLeft');
  const end = new Date(s.session_expires).getTime();
  function closeUp() {
    clearInterval(timer);
    list.querySelectorAll('button').forEach(b => { b.disabled = true; });
    container.querySelector('.pill').textContent = 'Window closed';
    container.querySelector('.pill').className = 'pill rejected';
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  }
  const tick = () => {
    const ms = end - Date.now();
    if (ms <= 0) { left.textContent = '0:00'; closeUp(); return; }
    left.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  };
  const timer = setInterval(tick, 1000); tick();
}

return { call, render, saved };
})();
