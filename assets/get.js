(() => {
'use strict';
const view = document.getElementById('view');
const cfg = window.SV_CONFIG || {};
const endpoint = (cfg.supabaseUrl || '').replace(/\/$/, '') + '/functions/v1/redeem';
const when = t => new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const SEAL = '<svg class="seal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.4"/><g stroke-linecap="round"><path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6M4.65 4.65l1.84 1.84M17.51 17.51l1.84 1.84M4.65 19.35l1.84-1.84M17.51 6.49l1.84-1.84"/></g></svg>';
const FILE = '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 3h10l5 5v17H7z"/><path d="M17 3v5h5M14.5 12v8M11 17l3.5 3.5L18 17"/></svg>';

// Read the token, then take it out of the address bar and browser history.
const token = decodeURIComponent(location.hash.slice(1));
if (location.hash) history.replaceState(null, '', location.pathname);

function render(html) {
  view.innerHTML = html;
  view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

async function call(action) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey || '' },
    body: JSON.stringify({ action, token }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* keep empty */ }
  return { ok: res.ok, status: res.status, body };
}

function dead(state, usedAt) {
  const text = {
    used: ['Link already used', 'This link has already been used.', usedAt ? `It was used on ${when(usedAt)}. Each link works only once.` : 'Each link works only once.'],
    expired: ['Link expired', 'This link has expired.', 'Unused links stop working after a few days.'],
    revoked: ['Link cancelled', 'This link was cancelled.', 'A newer link was sent, or your access was withdrawn.'],
    invalid: ['Link not recognised', 'This isn\'t a valid download link.', 'Open the link exactly as it arrived in your email.'],
  }[state] || ['Unavailable', 'This link can\'t be used right now.', 'Please try again later.'];
  render(`${SEAL}<span class="pill rejected">${text[0]}</span><h2>${text[1]}</h2><p class="sub">${text[2]} If you still need the software, ask Team ODAX for a new link.</p><a class="btn" href="access.html">Go to my access page</a>`);
}

async function start() {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl || '')) return dead('unavailable');
  if (!token) return dead('invalid');
  let r;
  try { r = await call('check'); } catch { return dead('unavailable'); }
  if (r.body.state !== 'valid') return dead(r.body.state, r.body.used_at);

  render(`${SEAL}<span class="pill approved">Ready</span><h2></h2>
    <p class="sub">This is your personal, one-time download. <b>It works once:</b> when you press the button, this link is used up and can't be opened again.</p>
    <p class="burn">Unused, it expires on ${when(r.body.expires_at)}.</p>
    <p class="msg" hidden></p>
    <div class="actions"><button class="btn primary" type="button" id="go">Download now</button></div>`);
  view.querySelector('h2').textContent = `Welcome, ${r.body.name}.`;
  const go = document.getElementById('go');
  go.addEventListener('click', async () => {
    go.disabled = true; go.innerHTML = '<span class="spin" aria-hidden="true"></span>Opening the vault…';
    let x;
    try { x = await call('redeem'); } catch { x = { ok: false, body: {} }; }
    if (!x.ok) {
      if (x.body.state && x.body.state !== 'valid') return dead(x.body.state, x.body.used_at);
      const m = view.querySelector('.msg'); m.hidden = false; m.className = 'msg err';
      m.textContent = x.body.error || 'The download couldn\'t start. Your link hasn\'t been used; try again.';
      go.disabled = false; go.textContent = 'Download now'; return;
    }
    delivered(x.body.files, x.body.expires_in);
  });
}

function delivered(files, secs) {
  render(`${SEAL}<span class="pill approved">Link used</span><h2>Your download has started.</h2>
    <p class="sub">This link is now used up. Start any remaining file below within ${Math.round(secs / 60)} minutes, and don't close this page until every download has begun.</p>
    <div class="files" id="files"></div>`);
  const list = document.getElementById('files');
  files.forEach(f => {
    const row = el('div', 'fileRow'); row.innerHTML = FILE;
    row.append(el('b', null, f.name));
    const a = el('a', 'btn ghost', 'Download'); a.href = f.url; a.rel = 'noopener';
    row.append(a); list.append(row);
  });
  if (files[0]) location.href = files[0].url;   // start the first one straight away
}

start();
})();
