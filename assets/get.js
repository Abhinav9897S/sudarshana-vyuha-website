(() => {
'use strict';
const view = document.getElementById('view');
const cfg = window.SV_CONFIG || {};
const when = t => new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const SEAL = '<svg class="seal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.4"/><g stroke-linecap="round"><path d="M12 1.6v2.6M12 19.8v2.6M1.6 12h2.6M19.8 12h2.6M4.65 4.65l1.84 1.84M17.51 17.51l1.84 1.84M4.65 19.35l1.84-1.84M17.51 6.49l1.84-1.84"/></g></svg>';

// Read the link's token, then take it out of the address bar and browser history.
const token = decodeURIComponent(location.hash.slice(1));
if (location.hash) history.replaceState(null, '', location.pathname);

function render(html) {
  view.innerHTML = html;
  view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
}
function dead(state, usedAt) {
  const text = {
    used: ['Already used', 'This download has already been used.', usedAt ? `The vault was opened on ${when(usedAt)}. Each approval allows one download.` : 'Each approval allows one download.'],
    expired: ['Expired', 'This download link has expired.', 'Unused links stop working after a few days.'],
    revoked: ['Cancelled', 'This download link was cancelled.', 'A newer one was issued, or your access was withdrawn.'],
    invalid: ['Not recognised', 'This isn\'t a valid download link.', 'Open the link exactly as it arrived in your email.'],
  }[state] || ['Unavailable', 'The vault isn\'t reachable right now.', 'Please try again in a minute.'];
  render(`${SEAL}<span class="pill rejected">${text[0]}</span><h2>${text[1]}</h2><p class="sub">${text[2]} If you still need the software, ask Team ODAX to issue a new download.</p><a class="btn" href="access.html">Go to my access page</a>`);
}

async function start() {
  const open = window.SVVault.saved();
  if (open) return window.SVVault.render(view, open);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl || '')) return dead('unavailable');
  if (!token) return dead('invalid');
  let r;
  try { r = await window.SVVault.call({ action: 'check', token }); } catch { return dead('unavailable'); }
  if (r.body.state !== 'valid') return dead(r.body.state, r.body.used_at);

  render(`${SEAL}<span class="pill approved">Ready</span><h2></h2>
    <p class="sub">This is your personal, one-time download. Opening the vault <b>uses it up</b>, then gives you one hour to fetch every file. Open it only when you're ready.</p>
    <p class="burn">Unused, it expires on ${when(r.body.expires_at)}.</p>
    <p class="msg" hidden></p>
    <div class="actions"><button class="btn primary" type="button" id="go">Open the vault</button></div>`);
  view.querySelector('h2').textContent = `Welcome, ${r.body.name}.`;
  const go = document.getElementById('go');
  go.addEventListener('click', async () => {
    go.disabled = true; go.innerHTML = '<span class="spin" aria-hidden="true"></span>Opening the vault…';
    let x;
    try { x = await window.SVVault.call({ action: 'open', token }); } catch { x = { ok: false, body: {} }; }
    if (!x.ok) {
      if (x.body.state && x.body.state !== 'valid') return dead(x.body.state, x.body.used_at);
      const m = view.querySelector('.msg'); m.hidden = false; m.className = 'msg err';
      m.textContent = x.body.error || 'The vault couldn\'t be opened. Your download hasn\'t been used; try again.';
      go.disabled = false; go.textContent = 'Open the vault'; return;
    }
    window.SVVault.render(view, x.body);
  });
}

start();
})();
