// Supabase project for verified downloads.
// Both values are from Supabase → Project Settings → API.
// The anon key is meant to be public; the database rules (supabase/schema.sql) do the protecting.
// Never put the service_role key here.
window.SV_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
};
