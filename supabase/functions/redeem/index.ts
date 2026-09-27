// Sudarshana Vyuha · redeem (the vault)
// The application lives in a private GitHub release. Nobody gets a permanent link:
// an approved user opens the vault once, and gets a short session in which each file
// is handed out as a fresh, minutes-long download URL.
//
// Two ways in, both single-use:
//   signed in   Authorization: Bearer <user session>   { action: 'status' | 'open' }
//   email link  { token }                              { action: 'check'  | 'open' }
// then, with the session 'open' returned:              { action: 'file', session, name }
//
// Deploy with "Verify JWT" OFF: this function checks every caller itself.
//
// Secrets:
//   GITHUB_TOKEN   fine-grained token with read-only "Contents" on the private repo
//   GITHUB_REPO    owner/repo, e.g. Abhinav9897S/ProjectSudarshanVyuha
//   RELEASE_TAG    the release holding the files, e.g. v2026.09.27
//   SITE_URL       optional, defaults to https://sudarshana-vyuha.onrender.com
//   SESSION_MINUTES optional, how long an opened vault stays open, defaults to 60

import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE = (Deno.env.get('SITE_URL') ?? 'https://sudarshana-vyuha.onrender.com').replace(/\/$/, '');
const SESSION_MINUTES = Number(Deno.env.get('SESSION_MINUTES') ?? '60');

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
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---------- the private release ---------- */
type Asset = { id: number; name: string; size: number };
const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${Deno.env.get('GITHUB_TOKEN') ?? ''}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sudarshana-vyuha-vault',
    ...(init.headers ?? {}),
  },
});
async function releaseAssets(): Promise<Asset[] | null> {
  const repo = Deno.env.get('GITHUB_REPO'), tag = Deno.env.get('RELEASE_TAG');
  if (!repo || !tag || !Deno.env.get('GITHUB_TOKEN')) return null;
  const res = await gh(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  if (!res.ok) return null;
  const rel = await res.json();
  return (rel.assets ?? []).map((a: Asset) => ({ id: a.id, name: a.name, size: a.size }));
}
// What the person sees, in the order they need it. Checksums stay in the vault.
function describe(assets: Asset[]) {
  const rank = (n: string) => /win64\.zip\.\d+$/.test(n) ? 0 : /^Join-/i.test(n) ? 1 : /analyst/i.test(n) ? 2 : 3;
  return assets.filter((a) => !/manifest\.json$/i.test(a.name))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
    .map((a) => ({
      name: a.name, size: a.size,
      kind: /win64\.zip\.\d+$/.test(a.name) ? 'part' : /^Join-/i.test(a.name) ? 'joiner' : /analyst/i.test(a.name) ? 'optional' : 'file',
    }));
}
async function signedUrl(assetId: number): Promise<string | null> {
  const repo = Deno.env.get('GITHUB_REPO');
  const res = await gh(`/repos/${repo}/releases/assets/${assetId}`, { headers: { Accept: 'application/octet-stream' }, redirect: 'manual' });
  return res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const body = await req.json().catch(() => ({}));
  const { action } = body;
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ua = req.headers.get('User-Agent')?.slice(0, 300) ?? null;
  const now = () => new Date().toISOString();
  const approved = async (userId: string) => {
    const { data } = await service.from('access_requests').select('status, full_name').eq('user_id', userId).maybeSingle();
    return data?.status === 'approved' ? data : null;
  };

  /* ---------- downloading one file inside an open session ---------- */
  if (action === 'file') {
    if (typeof body.session !== 'string' || typeof body.name !== 'string') return reply(400, { error: 'Missing session or file.' });
    const { data: g } = await service.from('download_tokens').select('user_id, session_expires, revoked_at')
      .eq('session_hash', await sha256(body.session)).maybeSingle();
    if (!g || g.revoked_at) return reply(410, { state: 'closed', error: 'This download session isn\'t valid.' });
    if (!g.session_expires || new Date(g.session_expires) <= new Date()) return reply(410, { state: 'closed', error: 'Your download window has closed.' });
    if (!(await approved(g.user_id))) return reply(403, { state: 'revoked', error: 'Your access has been withdrawn.' });
    const assets = await releaseAssets();
    const asset = assets?.find((a) => a.name === body.name);
    if (!asset) return reply(404, { error: 'That file isn\'t in the vault.' });
    const url = await signedUrl(asset.id);
    if (!url) return reply(503, { error: 'The vault didn\'t respond. Try this file again in a minute.' });
    await service.from('download_log').insert({ user_id: g.user_id, file: asset.name, user_agent: ua });
    return reply(200, { url });
  }

  /* ---------- find the grant: by signed-in user, or by emailed token ---------- */
  let grantQuery;
  let userId: string | null = null;
  if (typeof body.token === 'string') {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(body.token)) return reply(400, { state: 'invalid' });
    const hash = await sha256(body.token);
    grantQuery = () => service.from('download_tokens').select('*').eq('token_hash', hash).maybeSingle();
  } else {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = jwt ? await service.auth.getUser(jwt) : { data: { user: null } };
    if (!user) return reply(401, { error: 'Sign in first.' });
    userId = user.id;
    grantQuery = () => service.from('download_tokens').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
  }

  const stateOf = async () => {
    const { data: g } = await grantQuery();
    if (!g) return { state: userId ? 'none' : 'invalid' };
    const person = await approved(g.user_id);
    if (!person || g.revoked_at) return { state: 'revoked' };
    if (g.used_at) return { state: 'used', used_at: g.used_at, session_open: !!(g.session_expires && new Date(g.session_expires) > new Date()) };
    if (new Date(g.expires_at) <= new Date()) return { state: 'expired' };
    return { state: 'valid', name: person.full_name, expires_at: g.expires_at, grant_id: g.id, user_id: g.user_id };
  };
  const publicState = (s: Record<string, unknown>) => { delete s.grant_id; delete s.user_id; return s; };

  if (action === 'check' || action === 'status') return reply(200, publicState(await stateOf()));
  if (action !== 'open') return reply(400, { error: 'Unknown action.' });

  /* ---------- open the vault: uses the grant up, exactly once ---------- */
  const s = await stateOf();
  if (s.state !== 'valid') return reply(410, publicState(s));
  const assets = await releaseAssets();
  if (!assets || !assets.length) return reply(503, { error: 'The vault isn\'t reachable right now. Your download hasn\'t been used; try again later.' });

  const session = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const sessionExpires = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();
  const { data: claimed } = await service.from('download_tokens')
    .update({ used_at: now(), used_ua: ua, session_hash: await sha256(session), session_expires: sessionExpires })
    .eq('id', s.grant_id as number).is('used_at', null).is('revoked_at', null).gt('expires_at', now())
    .select('id').maybeSingle();
  if (!claimed) return reply(410, publicState(await stateOf()));
  return reply(200, { session, session_expires: sessionExpires, files: describe(assets) });
});
