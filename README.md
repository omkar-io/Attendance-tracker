# The Ledger — Subject-wise Attendance Tracker

A subject-wise attendance register with a real account system. Log in with
email + password, track each subject, see how many classes you can afford to
miss (or must attend) to hold a target percentage, mark days on a red/green
calendar, get a Telegram message whenever you mark yourself present or
absent, and review everything in an activity log. Data lives in your own
Supabase project (Postgres + Auth), locked down per-user with Row Level
Security, so it syncs across every device you log into — and the site itself
is still a static frontend, free to host on GitHub Pages.

## Features

- **Accounts** — sign up / log in with email and password (Supabase Auth). Set a display name shown in the header; see the note below on why login itself is email-based.
- **Subject-wise tracking** — add subjects, set a required attendance % per subject (or a site-wide default).
- **Safety-margin calculator** — each subject card shows exactly how many more classes you can skip, or how many in a row you must attend, to hit your target.
- **Calendar view** — pick a subject (or "All subjects") and see the month colored green (present), red (absent), amber (mixed, when "All" is selected and subjects disagree for that day), or blank (no class).
- **Telegram bot notifications** — get pinged the moment you mark yourself present (and optionally absent) in a subject, with your live attendance % included.
- **Activity log** — every add, edit, delete, mark, and Telegram message is logged with a timestamp, newest first.
- **Synced, private data** — everything is stored in Supabase, readable only by your own account via Row Level Security policies.

## Setting up Supabase (do this first)

1. Go to [supabase.com](https://supabase.com), create a free account, and create a new project. Pick any name/region and set a database password (you won't need it day-to-day).
2. Once the project is ready, open **SQL Editor** → **New query**, paste in the entire contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates the `subjects`, `records`, `activity_log`, and `user_settings` tables, each with Row Level Security so users can only ever see their own rows.
3. Go to **Authentication → Providers** and confirm **Email** is enabled (it is by default).
4. While testing, you may want to turn off **Authentication → Settings → Confirm email**, so new accounts can log in immediately without clicking an email link. Turn it back on before sharing the site with other people.
5. Go to **Settings → API** and copy the **Project URL** and the **anon public** key.
6. Open `js/config.js` in this project and paste them in:

   ```js
   const SUPABASE_URL = "https://your-project-ref.supabase.co";
   const SUPABASE_ANON_KEY = "your-public-anon-key";
   ```

The anon key is meant to be public — it's safe to commit to a public GitHub repo. Your data stays private because of the Row Level Security policies in `schema.sql`, not because this key is secret.

### A note on "username" login

Supabase's built-in auth is email + password based. This app lets you set a
**display name** at signup (shown in the header and logs), but you still log
in with your email — there's no separate username-only login. Building true
username login would mean running your own lookup (e.g. a small Postgres
function or edge function mapping username → email) before calling
`signInWithPassword`; it's a reasonable next step if you want it, just outside
what a static GitHub Pages site can do on its own.

## Running it locally

No build step is required. Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Make sure `js/config.js` has your real Supabase URL and anon key first — the app can't load or save anything without them.

## Setting up the Telegram bot

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`, give it a name and a username. BotFather replies with a **token** that looks like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
3. Message **[@userinfobot](https://t.me/userinfobot)** (or your new bot itself once, then check `https://api.telegram.org/bot<token>/getUpdates`) to find your numeric **chat ID**.
4. In the app, go to **Settings → Telegram notifications**, paste the token and chat ID, turn on "Send a message when I mark myself present" (and/or absent), and hit **Save settings**. Use **Send test message** to confirm it works.

Notes:
- Your bot token is stored only in your browser's local storage (`localStorage`). It is never written into any file, so the repository stays safe to make public.
- If Telegram messages fail from a GitHub Pages–hosted site, it's usually an ad-blocker or browser privacy extension blocking the request to `api.telegram.org` — try disabling it for the site, or test in a private window.

## Deploying to GitHub Pages

1. Create a new repository on GitHub (e.g. `attendance-ledger`) and push this folder to it:

   ```bash
   git init
   git add .
   git commit -m "Initial commit: attendance ledger app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub, open the repository → **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch", pick the **`main`** branch and the **`/ (root)`** folder, then **Save**.
4. Wait a minute or two, then your site will be live at:

   ```
   https://<your-username>.github.io/<your-repo>/
   ```

5. Every time you `git push` a change, GitHub Pages redeploys automatically.

### Keeping it updated

Since all data lives in each visitor's own browser, "maintaining" the site day to day just means using it — mark attendance as classes happen, and the dashboard, calendar, and log update instantly. If you want to change the code (styling, new features), edit the files and push again; GitHub Pages will redeploy in under a minute.

## Data & backup

Everything is stored in your Supabase project's Postgres database, scoped to
your account by Row Level Security — log in from any device and you'll see
the same subjects, records, and settings. To back up or inspect your data
directly, use the **Table Editor** in your Supabase dashboard, or export a
table from **SQL Editor** with a query like:

```sql
select * from subjects where user_id = auth.uid();
```

## File structure

```
attendance-tracker/
├── index.html          # auth screen + all four app views + two modals
├── css/style.css        # ledger/register visual theme
├── js/config.js          # your Supabase URL + anon key (edit this)
├── js/app.js              # auth, data loading/mutations, calculations, rendering
├── supabase/schema.sql     # run once in Supabase's SQL Editor
└── README.md
```

## The attendance formulas

For a subject with `attended` out of `total` classes and a `required` percentage:

- **Classes you can still miss** (when currently at/above target):
  `floor(attended / required − total)`
- **Classes you must attend in a row** (when currently below target):
  `ceil((required × total − attended) / (1 − required))`
