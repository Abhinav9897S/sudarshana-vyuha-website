# Setting up verified downloads

Visitors who press **Download** land on `access.html`. They create an account,
confirm their email, upload a DigiLocker-issued ID and a signed authority letter,
and wait. A reviewer approves or rejects them on `admin.html`. Approving automatically
emails a **one-time link**: it opens `get.html`, and pressing Download there uses it up and
releases the files from the private vault. Unused links expire after 72 hours; every
download is logged.

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

## 5. Set up email with Brevo (free, 300 emails a day)
1. Sign up at **brevo.com**.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: add the address emails should
   come from (e.g. your Gmail) and click the verification link Brevo sends to it.
3. **SMTP & API → API keys → Generate a new API key**. Copy it (starts with `xkeysib-`).
4. Optional but recommended, so outside applicants receive their sign-up confirmation email:
   Supabase **Authentication → Emails → SMTP Settings → Enable custom SMTP**:
   host `smtp-relay.brevo.com`, port `587`, username and password from Brevo
   **SMTP & API → SMTP**, sender = the address you verified.

## 6. Deploy the two functions
For each one: **Edge Functions → Deploy a new function → Via editor**, paste the code, then
open the function's **Details** and turn **Verify JWT** **off** (both functions check access themselves).
- `send-link`: paste `supabase/functions/send-link/index.ts`. Emails the one-time link when you approve someone.
- `redeem`: paste `supabase/functions/redeem/index.ts`. Checks and uses up a link when the applicant presses Download.

**Edge Functions → Secrets**, add:
- `BREVO_API_KEY` = the key from step 5
- `SENDER_EMAIL` = the verified sender address
- `RELEASE_PATHS` = the files to hand over, comma-separated, e.g. `SudarshanaVyuha-setup.zip,vault.key`
- optional: `SENDER_NAME` (default `Team ODAX`), `LINK_HOURS` (default `72`)

Upload every file named in `RELEASE_PATHS` to **Storage → releases** (the private vault),
with exactly those names. To ship a new version, upload it and update `RELEASE_PATHS`.

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
- The vault bucket has no public access at all. Files leave it only through `redeem`, once per link.
- Only a hash of each link is stored, so even a database leak exposes no working link.
- Email scanners that open links can't burn them: a link is used up only by pressing Download.
- Revoking access, or sending a new link, cancels every unused link for that person.

## Notes
- A free Supabase project pauses after 7 days without activity. You'll get an email; one click restores it.
- Under India's DPDP Act you are responsible for the identity documents you collect.
  Keep the data-handling notice on `access.html` accurate, delete applications you no longer need,
  and prefer the masked Aadhaar.
- Uploaded PDFs can be forged. The reviewer should check the DigiLocker QR code or document ID,
  and call the authority on the letterhead for anything sensitive.
