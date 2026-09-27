# Setting up verified downloads

Visitors who press **Download** land on `access.html`. They create an account,
confirm their email, upload a DigiLocker-issued ID and a signed authority letter,
and wait. A reviewer approves or rejects them on `admin.html`. Approving grants **one
download**: the person signs in and opens the vault, which uses the grant up and gives them
one hour to fetch each file through short-lived links. (If email is set up, they also get a
one-time link to `get.html` that does the same.) Unused grants expire after 7 days; every
file downloaded is logged.

Everything runs on Supabase (free tier). About 20 minutes, once.

## 1. Create the Supabase project
1. Sign in at **supabase.com** with GitHub → **New project**.
2. Name `sudarshana-vyuha`, a strong database password (save it), region **South Asia (Mumbai)**.

## 2. Create the tables, rules and storage
1. **SQL Editor → New query**, paste all of `supabase/schema.sql`, **Run**.
2. Check **Storage**: two private buckets exist, `applicant-docs` and `releases`.

## 3. Turn on email confirmation
**Authentication → Sign In / Providers → Email**: keep **Confirm email** on.
**Authentication → URL Configuration**:
- Site URL: `https://sudarshana-vyuha.onrender.com`
- Redirect URLs: add `https://sudarshana-vyuha.onrender.com/access.html`

## 4. Connect the website
**Project Settings → API**: copy the **Project URL** and the **anon public** key into
`config.js`. Never use the `service_role` key on the website.

## 5. The vault: where the app lives
The application is kept in a **private Release** of the private `ProjectSudarshanVyuha`
repository (tag `v2026.09.27`): the app split into parts under GitHub's 2 GB limit,
`Join-SudarshanaVyuha.bat` to rebuild and verify it, and the optional analyst pack.
Nobody can see it without access to the repo. The website never links to it directly.

Create a read-only key the vault can use:
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name `sudarshana-vault`, **Only select repositories → ProjectSudarshanVyuha**.
3. **Repository permissions → Contents → Read-only**. Nothing else. Generate, copy it.

## 6. Deploy the two functions
For each: **Edge Functions → Deploy a new function → Via editor**, name it exactly, paste the code,
deploy, then in its **Details** turn **Verify JWT off** (both check every caller themselves).
- `send-link`: `supabase/functions/send-link/index.ts`. Approving someone grants them one download.
- `redeem`: `supabase/functions/redeem/index.ts`. Opens the vault and hands out each file.

**Edge Functions → Secrets**:
- `GITHUB_TOKEN` = the fine-grained token from step 5
- `GITHUB_REPO` = `Abhinav9897S/ProjectSudarshanVyuha`
- `RELEASE_TAG` = `v2026.09.27` (change it when you publish a new version)
- optional email: `BREVO_API_KEY`, `SENDER_EMAIL` (without them approval still works; users sign in to download)
- optional: `LINK_HOURS` (unused grant lifetime, default 168), `SESSION_MINUTES` (open-vault window, default 60)

## 7. Make yourself the reviewer
1. Open `access.html` on the site, create your account, confirm the email.
2. **SQL Editor**, replacing the address with the one you signed up with:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
3. Open `admin.html` and sign in. You'll see the queue.

## How it's protected
- Applicants can read and edit only their own application, and only while it's pending or rejected.
- Nobody can approve themselves: a database trigger resets any status change that isn't made by a reviewer.
- Reviewers can change only the decision and the note, never what the applicant submitted.
- Documents live in a private bucket; only the owner and reviewers can open them, through 5-minute links.
- The app sits in a private GitHub release. Files leave it only through `redeem`, as download URLs that expire within minutes, during a one-hour window opened once per approval.
- Only a hash of each link is stored, so even a database leak exposes no working link.
- Email scanners that open links can't burn them: a grant is used up only by pressing "Open the vault".
- Revoking access, or sending a new link, cancels every unused link for that person.

## Notes
- A free Supabase project pauses after 7 days without activity. You'll get an email; one click restores it.
- Under India's DPDP Act you are responsible for the identity documents you collect.
  Keep the data-handling notice on `access.html` accurate, delete applications you no longer need,
  and prefer the masked Aadhaar.
- Uploaded PDFs can be forged. The reviewer should check the DigiLocker QR code or document ID,
  and call the authority on the letterhead for anything sensitive.
