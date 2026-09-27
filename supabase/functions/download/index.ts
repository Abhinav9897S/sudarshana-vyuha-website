// Sudarshana Vyuha · download
// Hands an approved user a download link that expires after 10 minutes,
// and records the download. Everyone else gets a clear refusal.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   RELEASE_PATH     file name inside the private 'releases' bucket, e.g. SudarshanaVyuha-setup.zip
//   ALLOWED_ORIGINS  comma-separated site origins allowed to call this function
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

const LINK_SECONDS = 600;
const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://sudarshana-vyuha.onrender.com')
  .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return reply(401, { error: 'Sign in to download.' });

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: request } = await service
    .from('access_requests').select('status').eq('user_id', user.id).maybeSingle();
  if (request?.status !== 'approved') {
    return reply(403, { error: 'Your access has not been approved, so the download is locked.' });
  }

  const path = Deno.env.get('RELEASE_PATH') ?? 'SudarshanaVyuha-setup.zip';
  const { data, error } = await service.storage.from('releases').createSignedUrl(path, LINK_SECONDS, { download: true });
  if (error || !data) return reply(503, { error: 'The installer is not available right now. Please try again later.' });

  await service.from('download_log').insert({
    user_id: user.id, file: path, user_agent: req.headers.get('User-Agent')?.slice(0, 300) ?? null,
  });
  return reply(200, { url: data.signedUrl, expires_in: LINK_SECONDS });
});
