// Sudarshana Vyuha · send-link
// Called from the review page right after a reviewer approves someone (or presses
// "Send new link"). Creates a one-time download link, retires any earlier unused
// link for that person, and emails the new one.
//
// Deploy with "Verify JWT" OFF: this function checks the caller itself.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   BREVO_API_KEY   Brevo → SMTP & API → API keys
//   SENDER_EMAIL    an address verified in Brevo → Senders
//   SENDER_NAME     optional, defaults to "Team ODAX"
//   SITE_URL        optional, defaults to https://sudarshana-vyuha.onrender.com
//   LINK_HOURS      optional, how long an unused link lives, defaults to 72
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = (Deno.env.get('SITE_URL') ?? 'https://sudarshana-vyuha.onrender.com').replace(/\/$/, '');
const LINK_HOURS = Number(Deno.env.get('LINK_HOURS') ?? '72');

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (origin === SITE || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : SITE,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const mask = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);

function email(name: string, link: string, expires: Date) {
  const until = expires.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) + ' IST';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f4;font-family:Segoe UI,Arial,sans-serif;color:#0d0f10">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#030404;padding:22px 28px;color:#52d3cb;font-size:13px;letter-spacing:2px;font-weight:600">SUDARSHANA VYUHA · TEAM ODAX</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">Your access is approved, ${esc(name)}.</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#454c4f">Use the button below to download Sudarshana Vyuha. This link is personal and <b>works only once</b>: as soon as you press Download on the page it opens, it is used up.</p>
<p style="margin:0 0 22px"><a href="${link}" style="display:inline-block;background:#08777e;color:#ffffff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:999px">Open my one-time download</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#6b7275">Unused, it expires on <b>${until}</b>.</p>
<p style="margin:0;font-size:13px;color:#6b7275">Don't forward this email. If you didn't apply for access, ignore it.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Your access to Sudarshana Vyuha is approved, ${name}.\n\nOpen your one-time download (works once, expires ${until}):\n${link}\n\nDon't forward this email. If you didn't apply for access, ignore it.\n\nTeam ODAX`;
  return { html, text };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = jwt ? await service.auth.getUser(jwt) : { data: { user: null } };
  if (!user) return reply(401, { error: 'Sign in as a reviewer first.' });
  const { data: admin } = await service.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return reply(403, { error: 'Only reviewers can send download links.' });

  const { request_id } = await req.json().catch(() => ({}));
  const { data: r } = await service.from('access_requests').select('user_id, full_name, status').eq('id', request_id).maybeSingle();
  if (!r) return reply(404, { error: 'That application no longer exists.' });
  if (r.status !== 'approved') return reply(409, { error: 'Approve the application before sending a link.' });

  const { data: owner } = await service.auth.admin.getUserById(r.user_id);
  const to = owner?.user?.email;
  if (!to) return reply(404, { error: 'The applicant\'s account has no email address.' });

  const key = Deno.env.get('BREVO_API_KEY'), from = Deno.env.get('SENDER_EMAIL');
  if (!key || !from) return reply(500, { error: 'Email isn\'t set up yet: add BREVO_API_KEY and SENDER_EMAIL in Edge Function secrets.' });

  await service.from('download_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', r.user_id).is('used_at', null).is('revoked_at', null);

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + LINK_HOURS * 3600_000);
  const { data: row, error: insErr } = await service.from('download_tokens')
    .insert({ token_hash: await sha256(token), user_id: r.user_id, created_by: user.id, expires_at: expires.toISOString() })
    .select('id').single();
  if (insErr || !row) return reply(500, { error: 'The link couldn\'t be created. Try again.' });

  const link = `${SITE}/get.html#${token}`;   // after '#', so the token never reaches any server log
  const { html, text } = email(r.full_name, link, expires);
  const sent = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: Deno.env.get('SENDER_NAME') ?? 'Team ODAX' },
      to: [{ email: to, name: r.full_name }],
      subject: 'Your one-time Sudarshana Vyuha download',
      htmlContent: html, textContent: text,
    }),
  });
  if (!sent.ok) {
    await service.from('download_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
    return reply(502, { error: `The email couldn't be sent (Brevo said ${sent.status}). Check the Brevo key and verified sender.` });
  }
  return reply(200, { sent_to: mask(to), expires_at: expires.toISOString() });
});
