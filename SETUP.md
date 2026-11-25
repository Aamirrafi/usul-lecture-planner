# Putting Usul Lecture Planner online

The site is plain HTML, CSS and JavaScript. **GitHub Pages** hosts it and **Supabase** keeps each student's account and planner.
Both are free to start. Allow about 30 minutes.

## 1. Supabase (accounts and saved planners)

1. Sign up at [supabase.com](https://supabase.com) and create a **New project**. Pick a region near your students and save the database password somewhere safe (you won't need it here).
2. Open **SQL Editor → New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. It creates the `planner` table and the rules that let each student read and change only their own planner.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into [`config.js`](config.js).
   The anon key is designed to be public. Never put the **service_role** key in the site.
4. Open **Authentication → URL Configuration**:
   - **Site URL:** your GitHub Pages address, e.g. `https://YOUR-NAME.github.io/usul-lecture-planner/`
   - **Redirect URLs:** add the same address.
5. **Emails:** Supabase's built-in email sender only sends a few sign-in emails an hour, which is fine for testing but not for a whole school.
   Before inviting everyone, connect a free email service under **Authentication → Emails → SMTP Settings** (for example Resend or Brevo).

## 2. GitHub Pages (the website)

1. Create a GitHub repository, e.g. `usul-lecture-planner` (public; Pages is free for public repositories).
2. Upload everything in this `web` folder to the repository's main branch (drag the files into **Add file → Upload files**, or push with git).
3. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and **Save**.
4. After a minute the site is at `https://YOUR-NAME.github.io/usul-lecture-planner/`.

To update the site later, upload the changed files again. Students' planners are in Supabase, so updates never touch them.

## 3. Sign in with Microsoft (optional)

Email sign-in works for everyone. To add a **Sign in with Microsoft** button:

1. In the [Azure portal](https://portal.azure.com) (a free account works), open **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI (Web): `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
2. Under **Certificates & secrets**, create a client secret and copy its **Value**.
3. In Supabase, open **Authentication → Providers → Azure**, turn it on, and paste the **Application (client) ID** and the secret. Leave the tenant URL as `https://login.microsoftonline.com/common`.
4. In `config.js`, set `microsoftSignIn: true` and upload it again.

This asks Microsoft only for the student's name and email, which schools normally allow without admin approval. If Usul blocks it, students use the email link instead.

## How students use it

1. Open the site and sign in.
2. **+ Add from Teams**: paste the course's Teams link, drag the bookmark to the bookmarks bar the first time, then click it on the SharePoint page that opens.
3. **▶ Watch**: the first time in each study session, click **Open SharePoint** and click the bookmark there. Lectures then play inside the planner and the minutes fill in by themselves. Lectures Usul has blocked from downloading open in SharePoint instead.

Students with a planner from the Mac version can bring it across in **Settings → Bring in a backup or Mac planner file** (the Mac version's `data/data.json`).
After that, click **⟳ Sync** on each course once, so lectures with long names play reliably.

## Testing on your Mac before publishing

```bash
cd web
python3 -m http.server 8790
```
Open http://127.0.0.1:8790/. With `config.js` empty it runs in demo mode (saved only in that browser).
To test real sign-in locally, add `http://127.0.0.1:8790/` to Supabase's Redirect URLs.
