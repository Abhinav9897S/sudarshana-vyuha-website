# Setting up verified downloads

Visitors who press **Download** land on `access.html`. They create an account,
confirm their email, upload a DigiLocker-issued ID and a signed authority letter,
and wait. A reviewer approves or rejects them on `admin.html`. Approved users get a
download link that expires after 10 minutes, and every download is logged.

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

## 5. Deploy the download function
**Edge Functions → Deploy a new function → Via editor**, name it `download`, paste
`supabase/functions/download/index.ts`, deploy. Then **Edge Functions → Secrets**:
- `RELEASE_PATH` = the installer's file name, e.g. `SudarshanaVyuha-setup.zip`
- `ALLOWED_ORIGINS` = `https://sudarshana-vyuha.onrender.com` (add your custom domain later, comma-separated)

## 6. Upload the installer
**Storage → releases → Upload file**: upload the file named exactly as `RELEASE_PATH`.
To ship a new version, upload the new file and update `RELEASE_PATH`.

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
- The installer bucket has no public access at all; only the download function can create a link, and only for approved users.

## Notes
- A free Supabase project pauses after 7 days without activity. You'll get an email; one click restores it.
- Under India's DPDP Act you are responsible for the identity documents you collect.
  Keep the data-handling notice on `access.html` accurate, delete applications you no longer need,
  and prefer the masked Aadhaar.
- Uploaded PDFs can be forged. The reviewer should check the DigiLocker QR code or document ID,
  and call the authority on the letterhead for anything sensitive.
