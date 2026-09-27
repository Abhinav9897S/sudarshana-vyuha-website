// Sudarshana Vyuha · redeem
// Backs the one-time link page (get.html).
//   { action: 'check',  token }  → is this link still usable? (does NOT use it up)
//   { action: 'redeem', token }  → uses the link up, atomically, and returns short-lived
//                                  download URLs for every file in the private 'releases' vault
// Email scanners only load pages, they never press the button, so they can't burn a link.
//
// Deploy with "Verify JWT" OFF: the link itself is the credential.
//
// Secrets:
//   RELEASE_PATHS  comma-separated file names in the 'releases' bucket,
//                  e.g. SudarshanaVyuha-setup.zip,vault.key
//   SITE_URL       optional, defaults to https://sudarshana-vyuha.onrender.com

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = (Deno.env.get('SITE_URL') ?? 'https://sudarshana-vyuha.onrender.com').replace(/\/$/, '');
const FILE_SECONDS = 600;   // each released URL must be started within 10 minutes

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (origin === SITE || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : SITE,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
async function sha256(t: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const { action, token } = await req.json().catch(() => ({}));
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return reply(400, { state: 'invalid' });

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const hash = await sha256(token);

  const stateOf = async () => {
    const { data: t } = await service.from('download_tokens')
      .select('user_id, expires_at, used_at, revoked_at').eq('token_hash', hash).maybeSingle();
    if (!t) return { state: 'invalid' };
    if (t.used_at) return { state: 'used', used_at: t.used_at };
    if (t.revoked_at) return { state: 'revoked' };
    if (new Date(t.expires_at) <= new Date()) return { state: 'expired' };
    const { data: r } = await service.from('access_requests').select('status, full_name').eq('user_id', t.user_id).maybeSingle();
    if (r?.status !== 'approved') return { state: 'revoked' };
    return { state: 'valid', name: r.full_name, expires_at: t.expires_at, user_id: t.user_id };
  };

  if (action === 'check') {
    const s = await stateOf();
    delete (s as Record<string, unknown>).user_id;
    return reply(200, s);
  }
  if (action !== 'redeem') return reply(400, { error: 'Unknown action.' });

  const before = await stateOf();
  if (before.state !== 'valid') return reply(410, before);

  // One statement, one winner: two tabs pressing Download at once can't both succeed.
  const now = new Date().toISOString();
  const { data: claimed } = await service.from('download_tokens')
    .update({ used_at: now, used_ua: req.headers.get('User-Agent')?.slice(0, 300) ?? null })
    .eq('token_hash', hash).is('used_at', null).is('revoked_at', null).gt('expires_at', now)
    .select('user_id').maybeSingle();
  if (!claimed) return reply(410, await stateOf());

  const paths = (Deno.env.get('RELEASE_PATHS') ?? 'SudarshanaVyuha-setup.zip').split(',').map((p) => p.trim()).filter(Boolean);
  const files: { name: string; url: string }[] = [];
  for (const path of paths) {
    const { data } = await service.storage.from('releases').createSignedUrl(path, FILE_SECONDS, { download: true });
    if (data) files.push({ name: path.split('/').pop()!, url: data.signedUrl });
  }
  if (!files.length) {
    // nothing to hand over: give the link back rather than burn it
    await service.from('download_tokens').update({ used_at: null, used_ua: null }).eq('token_hash', hash);
    return reply(503, { error: 'The files aren\'t available right now. Your link still works; try again later.' });
  }
  await service.from('download_log').insert(files.map((f) => ({
    user_id: claimed.user_id, file: f.name, user_agent: req.headers.get('User-Agent')?.slice(0, 300) ?? null,
  })));
  return reply(200, { files, expires_in: FILE_SECONDS });
});
