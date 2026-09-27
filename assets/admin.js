(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), cfg = window.SV_CONFIG || {};
const show = id => { view.replaceChildren($('#' + id).content.cloneNode(true)); return view; };
const say = (text, kind = 'err') => { const m = $('.msg', view); if (!m) return; m.textContent = text || ''; m.className = 'msg ' + kind; m.hidden = !text; };
const when = t => t ? new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl || '') && cfg.supabaseAnonKey && !/YOUR-/.test(cfg.supabaseAnonKey);
if (!configured || !window.supabase) { show('t-setup'); return; }
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

let shownFor, rows = [], downloads = {}, filter = 'pending';
const LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', revoked: 'Revoked', all: 'All' };

sb.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id || null;
  if (event === 'INITIAL_SESSION' || uid !== shownFor) { shownFor = uid; setTimeout(() => route(session), 0); }
});
$('#signOut').addEventListener('click', () => sb.auth.signOut());

async function route(session) {
  const user = session?.user;
  $('#who').hidden = !user; $('#whoEmail').textContent = user?.email || '';
  if (!user) return signIn();
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin) return show('t-denied');
  show('t-queue');
  await load();
}
function signIn() {
  show('t-signin');
  $('#inForm').onsubmit = async e => {
    e.preventDefault(); say('');
    const { error } = await sb.auth.signInWithPassword({ email: $('#aEmail').value.trim(), password: $('#aPass').value });
    if (error) say(/invalid/i.test(error.message) ? 'That email and password don\'t match an account.' : error.message);
  };
}

async function load() {
  const [{ data, error }, log] = await Promise.all([
    sb.from('access_requests').select('*').order('updated_at', { ascending: false }),
    sb.from('download_log').select('user_id, downloaded_at').order('downloaded_at', { ascending: false }),
  ]);
  if (error) return say('Couldn\'t load applications. Refresh to try again.');
  rows = data || [];
  downloads = {};
  (log.data || []).forEach(d => { (downloads[d.user_id] ||= []).push(d.downloaded_at); });
  render();
}

function render() {
  const counts = { all: rows.length };
  rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const f = $('#filters'); f.replaceChildren();
  Object.keys(LABEL).forEach(k => {
    const b = el('button', null, LABEL[k]); b.type = 'button'; b.setAttribute('aria-pressed', k === filter);
    b.append(el('b', null, String(counts[k] || 0)));
    b.onclick = () => { filter = k; render(); };
    f.append(b);
  });
  const q = $('#queue'); q.replaceChildren();
  const list = rows.filter(r => filter === 'all' || r.status === filter);
  if (!list.length) { q.append(el('p', 'empty', `No ${filter === 'all' ? '' : LABEL[filter].toLowerCase() + ' '}applications.`)); return; }
  list.forEach(r => q.append(card(r)));
}

function card(r) {
  const c = el('article', 'req');
  const main = el('div');
  const pill = el('span', 'pill ' + r.status, LABEL[r.status]);
  const h = el('h3', null, r.full_name); h.style.marginTop = '10px';
  main.append(pill, h, el('p', 'org', `${r.designation} · ${r.organisation}`), el('p', 'purpose', r.purpose));
  const meta = el('div', 'meta');
  const dls = downloads[r.user_id] || [];
  [r.official_email, r.phone, `ID: ${r.id_doc_type}`, `Submitted ${when(r.updated_at)}`,
   r.reviewed_at && `Decided ${when(r.reviewed_at)}`, `${dls.length} download${dls.length === 1 ? '' : 's'}${dls[0] ? ', last ' + when(dls[0]) : ''}`]
    .filter(Boolean).forEach(t => meta.append(el('span', null, t)));
  main.append(meta);

  const side = el('div', 'side');
  const docs = el('div', 'actions');
  [['View ID document', r.id_doc_path], ['View authority letter', r.letter_path]].forEach(([t, p]) => {
    const b = el('button', 'btn ghost', t); b.type = 'button'; b.onclick = () => openDoc(p); docs.append(b);
  });
  const note = el('textarea'); note.placeholder = 'Note to the applicant (shown to them)'; note.value = r.reviewer_note || ''; note.maxLength = 1000;
  note.setAttribute('aria-label', `Note to ${r.full_name}`);
  const acts = el('div', 'actions');
  const act = (label, status, cls) => {
    const b = el('button', 'btn ghost ' + cls, label); b.type = 'button';
    b.onclick = () => decide(r, status, note.value.trim(), b); acts.append(b);
  };
  if (r.status !== 'approved') act('Approve', 'approved', 'ok');
  if (r.status === 'pending') act('Reject', 'rejected', 'bad');
  if (r.status === 'approved') act('Revoke access', 'revoked', 'bad');
  side.append(docs, note, acts);
  c.append(main, side);
  return c;
}

async function openDoc(path) {
  const w = window.open('', '_blank');   // opened now so the browser doesn't block it
  const { data, error } = await sb.storage.from('applicant-docs').createSignedUrl(path, 300);
  if (error || !data) { w && w.close(); return say('That document couldn\'t be opened.'); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

async function decide(r, status, note, btn) {
  if ((status === 'rejected' || status === 'revoked') && !note) { say('Add a note explaining why, so the applicant knows what to fix.'); return; }
  btn.disabled = true; say('');
  const { error } = await sb.from('access_requests').update({ status, reviewer_note: note || null }).eq('id', r.id);
  if (error) { btn.disabled = false; return say('That decision couldn\'t be saved. Try again.'); }
  say(`${r.full_name}: ${LABEL[status].toLowerCase()}.`, 'ok');
  await load();
}
})();
