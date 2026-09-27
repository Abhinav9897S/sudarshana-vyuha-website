-- Sudarshana Vyuha · verified download access
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every object is created only if missing, or replaced.

-------------------------------------------------------------------------------
-- Reviewers
-------------------------------------------------------------------------------
create table if not exists public.admins (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies: only reachable through is_admin()

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-------------------------------------------------------------------------------
-- Access requests (one per account)
-------------------------------------------------------------------------------
do $$ begin
  create type public.request_status as enum ('pending', 'approved', 'rejected', 'revoked');
exception when duplicate_object then null; end $$;

create table if not exists public.access_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users on delete cascade,
  full_name      text not null check (char_length(full_name) between 2 and 120),
  organisation   text not null check (char_length(organisation) between 2 and 160),
  designation    text not null check (char_length(designation) between 2 and 120),
  official_email text not null check (official_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone          text check (phone is null or phone ~ '^[0-9+() -]{7,20}$'),
  purpose        text not null check (char_length(purpose) between 20 and 2000),
  id_doc_type    text not null check (char_length(id_doc_type) between 2 and 60),
  id_doc_path    text not null,
  letter_path    text not null,
  consent_at     timestamptz not null default now(),
  status         public.request_status not null default 'pending',
  reviewer_note  text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  reviewed_by    uuid references auth.users,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.access_requests enable row level security;

drop policy if exists "read own or review all" on public.access_requests;
create policy "read own or review all" on public.access_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "submit own" on public.access_requests;
create policy "submit own" on public.access_requests
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "resubmit own while open" on public.access_requests;
create policy "resubmit own while open" on public.access_requests
  for update to authenticated
  using (user_id = auth.uid() and status in ('pending', 'rejected'))
  with check (user_id = auth.uid());

drop policy if exists "reviewers decide" on public.access_requests;
create policy "reviewers decide" on public.access_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The rules the policies can't express: applicants can never set their own status,
-- reviewers can change only the decision (never what the applicant submitted),
-- and document paths must sit in the applicant's own storage folder.
create or replace function public.guard_access_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  reviewing boolean;
begin
  -- No signed-in user: SQL editor or service role, both trusted.
  if auth.uid() is null then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.reviewer_note := null; new.reviewed_by := null; new.reviewed_at := null;
    new.consent_at := now(); new.created_at := now();
  else
    reviewing := public.is_admin()
      and (new.status is distinct from old.status or new.reviewer_note is distinct from old.reviewer_note);
    if reviewing then
      new.user_id := old.user_id;            new.full_name := old.full_name;
      new.organisation := old.organisation;  new.designation := old.designation;
      new.official_email := old.official_email; new.phone := old.phone;
      new.purpose := old.purpose;            new.id_doc_type := old.id_doc_type;
      new.id_doc_path := old.id_doc_path;    new.letter_path := old.letter_path;
      new.consent_at := old.consent_at;      new.created_at := old.created_at;
      new.reviewed_by := auth.uid();         new.reviewed_at := now();
    else
      if old.user_id <> auth.uid() then
        raise exception 'You can only change your own application';
      end if;
      new.user_id := old.user_id; new.created_at := old.created_at;
      new.status := 'pending';    new.consent_at := now();
      new.reviewer_note := null;  new.reviewed_by := null; new.reviewed_at := null;
    end if;
  end if;

  if new.id_doc_path not like new.user_id::text || '/%'
     or new.letter_path not like new.user_id::text || '/%' then
    raise exception 'Documents must be uploaded to your own folder';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_access_request on public.access_requests;
create trigger guard_access_request
  before insert or update on public.access_requests
  for each row execute function public.guard_access_request();

-------------------------------------------------------------------------------
-- Download log (written only by the download function)
-------------------------------------------------------------------------------
create table if not exists public.download_log (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users on delete cascade,
  file          text not null,
  user_agent    text,
  downloaded_at timestamptz not null default now()
);
alter table public.download_log enable row level security;

drop policy if exists "reviewers read downloads" on public.download_log;
create policy "reviewers read downloads" on public.download_log
  for select to authenticated using (public.is_admin());

-------------------------------------------------------------------------------
-- One-time download links (created by send-link, consumed by redeem)
-- Only a SHA-256 hash of each link is stored, so a database leak reveals no working link.
-------------------------------------------------------------------------------
create table if not exists public.download_tokens (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique,
  user_id     uuid not null references auth.users on delete cascade,
  created_by  uuid references auth.users,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_ua     text,
  revoked_at  timestamptz
);
create index if not exists download_tokens_user on public.download_tokens (user_id);
-- Opening the vault uses a grant up and starts a short download session for the browser that opened it.
alter table public.download_tokens add column if not exists session_hash text unique;
alter table public.download_tokens add column if not exists session_expires timestamptz;
alter table public.download_tokens enable row level security;

drop policy if exists "reviewers read links" on public.download_tokens;
create policy "reviewers read links" on public.download_tokens
  for select to authenticated using (public.is_admin());

-- Leaving 'approved' (revoked, rejected) kills every link that hasn't been used yet.
create or replace function public.revoke_links_when_access_ends() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved' and new.status <> 'approved' then
    update public.download_tokens set revoked_at = now()
    where user_id = new.user_id and used_at is null and revoked_at is null;
  end if;
  return new;
end $$;

drop trigger if exists revoke_links_when_access_ends on public.access_requests;
create trigger revoke_links_when_access_ends
  after update of status on public.access_requests
  for each row execute function public.revoke_links_when_access_ends();

-------------------------------------------------------------------------------
-- Storage: applicant documents (private) and the installer (private)
-------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('applicant-docs', 'applicant-docs', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
  ('releases',       'releases',       false, null,     null)
on conflict (id) do update set public = false;

drop policy if exists "applicants upload own documents" on storage.objects;
create policy "applicants upload own documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'applicant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "applicants and reviewers read documents" on storage.objects;
create policy "applicants and reviewers read documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'applicant-docs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "applicants remove own documents" on storage.objects;
create policy "applicants remove own documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'applicant-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- 'releases' has no policies on purpose: nobody can read it directly.
-- Approved users get a short-lived signed link from the download function.
