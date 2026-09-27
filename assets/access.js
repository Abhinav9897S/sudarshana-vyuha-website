(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view'), steps = [...document.querySelectorAll('#steps li')];
const cfg = window.SV_CONFIG || {};
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function show(id) {
  view.replaceChildren($('#' + id).content.cloneNode(true));
  view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
  return view;
}
function step(n) { steps.forEach((li, i) => { li.classList.toggle('done', i < n); li.classList.toggle('on', i === n); }); }
function say(text, kind = 'err') { const m = $('.msg', view); if (!m) return; m.textContent = text || ''; m.className = 'msg ' + kind; m.hidden = !text; }
function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spin" aria-hidden="true"></span>'; btn.append(label || 'Working…'); }
  else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
}
const when = t => new Date(t).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl || '') && cfg.supabaseAnonKey && !/YOUR-/.test(cfg.supabaseAnonKey);
if (!configured || !window.supabase) { show('t-setup'); step(0); return; }

const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } });
const here = location.origin + location.pathname;
let user = null, shownFor = undefined, recovering = false;

/* ---------- routing: one screen per state ---------- */
async function route() {
  if (recovering) return showReset();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user || null;
  $('#who').hidden = !user; $('#whoEmail').textContent = user?.email || '';
  if (!user) return showAuth(false);
  const { data: row, error } = await sb.from('access_requests').select('*').eq('user_id', user.id).maybeSingle();
  if (error) { showStatus({ status: 'error' }); return; }
  if (!row) return showApply(null);
  showStatus(row);
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') recovering = true;
  const uid = session?.user?.id || null;
  // token refreshes and tab-focus re-checks must not wipe a half-filled form
  if (event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY' || uid !== shownFor) { shownFor = uid; setTimeout(route, 0); }
});
$('#signOut').addEventListener('click', async () => { await sb.auth.signOut(); });

/* ---------- account ---------- */
function showAuth(signup) {
  step(0); show('t-auth');
  const form = $('#authForm'), go = $('#authGo'), tabs = $('.tabs', view);
  const set = up => {
    signup = up;
    tabs.style.setProperty('--t', up ? 1 : 0);
    $('#tabIn').setAttribute('aria-selected', !up); $('#tabUp').setAttribute('aria-selected', up);
    $('#authH').textContent = up ? 'Create your account' : 'Sign in to continue';
    go.textContent = up ? 'Create account' : 'Sign in';
    $('#confirmWrap').hidden = !up; $('#passHint').hidden = !up; $('#forgot').hidden = up;
    $('#aPass').autocomplete = up ? 'new-password' : 'current-password';
    say('');
  };
  $('#tabIn').onclick = () => set(false); $('#tabUp').onclick = () => set(true);
  set(signup);
  $('#forgot').onclick = async () => {
    const email = $('#aEmail').value.trim();
    if (!$('#aEmail').checkValidity() || !email) { say('Enter your email above, then press “Forgot password?” again.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here });
    say(error ? error.message : `If an account exists for ${email}, a reset link is on its way.`, error ? 'err' : 'ok');
  };
  form.onsubmit = async e => {
    e.preventDefault(); say('');
    const email = $('#aEmail').value.trim(), pass = $('#aPass').value;
    if (!$('#aEmail').checkValidity() || !email) return say('Enter a valid email address.');
    if (pass.length < 10) return say('Use a password of at least 10 characters.');
    if (signup && pass !== $('#aPass2').value) return say('The two passwords don\'t match.');
    busy(go, true, signup ? 'Creating account…' : 'Signing in…');
    if (signup) {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: here } });
      busy(go, false);
      if (error) return say(error.message);
      if (!data.session) { show('t-check-email'); $('#sentTo').textContent = email; $('#backToSignIn').onclick = () => showAuth(false); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      busy(go, false);
      if (error) return say(/confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent you.' : /invalid/i.test(error.message) ? 'That email and password don\'t match an account.' : error.message);
    }
  };
}
function showReset() {
  step(0); show('t-reset');
  $('#resetForm').onsubmit = async e => {
    e.preventDefault();
    const pass = $('#rPass').value;
    if (pass.length < 10) return say('Use a password of at least 10 characters.');
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) return say(error.message);
    recovering = false; route();
  };
}

/* ---------- application ---------- */
function bindFile(input, drop, label) {
  input.addEventListener('change', () => {
    const f = input.files[0];
    drop.classList.toggle('has', !!f);
    $('em', drop).textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : label;
  });
}
function checkFile(f, what) {
  if (!f) return `Upload your ${what}.`;
  if (!TYPES[f.type]) return `Your ${what} must be a PDF, JPG or PNG.`;
  if (f.size > MAX_BYTES) return `Your ${what} is larger than 10 MB. Export a smaller copy and try again.`;
  return '';
}
function showApply(prev) {
  step(1); show('t-apply');
  if (prev) {
    $('#applyH').textContent = 'Update and resubmit';
    $('#applySub').textContent = prev.status === 'rejected'
      ? 'Fix what the reviewer pointed out and upload both documents again.'
      : 'Update your details and upload both documents again.';
    $('#fName').value = prev.full_name; $('#fDesig').value = prev.designation; $('#fOrg').value = prev.organisation;
    $('#fMail').value = prev.official_email; $('#fPhone').value = prev.phone || ''; $('#fPurpose').value = prev.purpose;
    $('#fDocType').value = prev.id_doc_type;
  }
  bindFile($('#fId'), $('#idDrop'), 'PDF, JPG or PNG, up to 10 MB');
  bindFile($('#fLetter'), $('#letterDrop'), 'On letterhead, signed and stamped by your commanding officer or head of department');
  const go = $('#applyGo');
  $('#applyForm').onsubmit = async e => {
    e.preventDefault(); say('');
    const form = e.currentTarget;
    const bad = [...form.querySelectorAll('input:not([type=file]):not([type=checkbox]),select,textarea')].find(el => !el.checkValidity());
    if (bad) { bad.focus(); return say(`Check “${bad.closest('.field').querySelector('span').firstChild.textContent.trim()}”.`); }
    const idFile = $('#fId').files[0], letter = $('#fLetter').files[0];
    const fileErr = checkFile(idFile, 'identity document') || checkFile(letter, 'authority letter');
    if (fileErr) return say(fileErr);
    if (!$('#fConsent').checked) return say('Tick the confirmation box to submit.');

    busy(go, true, 'Uploading documents…');
    const ts = Date.now();
    const idPath = `${user.id}/id-${ts}.${TYPES[idFile.type]}`, letterPath = `${user.id}/letter-${ts}.${TYPES[letter.type]}`;
    const store = sb.storage.from('applicant-docs');
    const up1 = await store.upload(idPath, idFile, { contentType: idFile.type, upsert: false });
    const up2 = up1.error ? up1 : await store.upload(letterPath, letter, { contentType: letter.type, upsert: false });
    if (up1.error || up2.error) { busy(go, false); await store.remove([idPath, letterPath]); return say('The upload didn\'t go through. Check your connection and try again.'); }

    const row = {
      user_id: user.id, full_name: $('#fName').value.trim(), designation: $('#fDesig').value.trim(),
      organisation: $('#fOrg').value.trim(), official_email: $('#fMail').value.trim(),
      phone: $('#fPhone').value.trim() || null, purpose: $('#fPurpose').value.trim(),
      id_doc_type: $('#fDocType').value, id_doc_path: idPath, letter_path: letterPath,
    };
    const { error } = prev
      ? await sb.from('access_requests').update(row).eq('user_id', user.id)
      : await sb.from('access_requests').insert(row);
    busy(go, false);
    if (error) { await store.remove([idPath, letterPath]); return say('Your application couldn\'t be saved. Please try again.'); }
    if (prev) store.remove([prev.id_doc_path, prev.letter_path]);   // replaced files, best effort
    route();
  };
}

/* ---------- the vault: one download per approval ---------- */
async function vaultPanel(acts) {
  const open = window.SVVault.saved();
  if (open) { step(3); window.SVVault.render(view, open); return; }
  const token = async () => (await sb.auth.getSession()).data.session?.access_token;
  let res;
  try { res = await window.SVVault.call({ action: 'status' }, await token()); } catch { res = { body: {} }; }
  const h = $('#stH'), p = $('#stP'), s = res.body.state;
  if (s === 'valid') {
    h.textContent = 'Your download is ready.';
    p.textContent = 'You can download Sudarshana Vyuha once. Open the vault only when you\'re ready: that uses your download and gives you one hour to fetch every file.';
    const b = document.createElement('button'); b.className = 'btn primary'; b.type = 'button'; b.textContent = 'Open the vault';
    b.onclick = async () => {
      say(''); busy(b, true, 'Opening the vault…');
      let x;
      try { x = await window.SVVault.call({ action: 'open' }, await token()); } catch { x = { ok: false, body: {} }; }
      busy(b, false);
      if (!x.ok) return say(x.body.error || 'The vault couldn\'t be opened. Refresh and try again.');
      step(3); window.SVVault.render(view, x.body);
    };
    acts.prepend(b);
  } else if (s === 'used') {
    h.textContent = 'Your download has been used.';
    p.textContent = `You opened the vault on ${when(res.body.used_at)}. Each approval allows one download. If you need it again, ask Team ODAX to issue a new one.`;
  } else if (s === 'expired') {
    h.textContent = 'Your download expired unused.';
    p.textContent = 'Ask Team ODAX to issue a new one.';
  } else if (s === 'none') {
    h.textContent = 'Your download is being prepared.';
    p.textContent = 'Team ODAX will issue it shortly. Check back here.';
  } else if (s === 'revoked') {
    h.textContent = 'Your download was withdrawn.';
    p.textContent = 'Contact Team ODAX if you think this is a mistake.';
  } else {
    h.textContent = 'The vault isn\'t reachable right now.';
    p.textContent = 'Refresh this page in a minute to try again.';
  }
}

/* ---------- status ---------- */
function showStatus(r) {
  show('t-status');
  const pill = $('#stPill'), acts = $('#stActions');
  const text = {
    pending: ['Under review', 'Your application is with Team ODAX.', 'We check every application by hand. Sign in here again to see the decision.'],
    approved: ['Approved', 'You\'re cleared.', 'Checking your download…'],
    rejected: ['Not approved', 'Your application wasn\'t approved.', 'Read the reviewer\'s note, then update your application and resubmit.'],
    revoked: ['Access revoked', 'Your access has been withdrawn.', 'Contact Team ODAX if you think this is a mistake.'],
    error: ['Unavailable', 'We couldn\'t load your application.', 'Refresh the page to try again.'],
  }[r.status];
  step(r.status === 'approved' ? 3 : r.status === 'pending' ? 2 : 1);
  pill.textContent = text[0]; pill.className = 'pill ' + (r.status === 'error' ? 'rejected' : r.status);
  $('#stH').textContent = text[1]; $('#stP').textContent = text[2];
  if (r.reviewer_note) { const n = $('#stNote'); n.hidden = false; n.textContent = 'Reviewer\'s note: ' + r.reviewer_note; }
  const dl = $('#stDl');
  if (r.status !== 'error') {
    [['Name', r.full_name], ['Organisation', `${r.designation}, ${r.organisation}`], ['Official email', r.official_email],
     ['ID document', r.id_doc_type], ['Submitted', when(r.updated_at)], ...(r.reviewed_at ? [['Decided', when(r.reviewed_at)]] : [])]
      .forEach(([k, v]) => { const d = document.createElement('div'), t = document.createElement('dt'), dd = document.createElement('dd'); t.textContent = k; dd.textContent = v; d.append(t, dd); dl.append(d); });
  } else dl.hidden = true;

  if (r.status === 'approved') vaultPanel(acts);
  if (r.status === 'rejected') {
    const b = document.createElement('button'); b.className = 'btn primary'; b.type = 'button'; b.textContent = 'Update and resubmit';
    b.onclick = () => showApply(r); acts.append(b);
  }
  if (r.status === 'pending') {
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = 'Edit application';
    b.onclick = () => showApply(r); acts.append(b);
  }
}
})();
