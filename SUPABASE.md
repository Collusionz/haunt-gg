# Supabase setup (guestbook)

The guestbook is an overlay you open from the **Guestbook** item in the sidebar on any
page. Visitors can read and post comments and like entries. The site owner (you) can
post as "verified" and delete comments from `/vault` — everything owner-scoped is
gated by a passcode (bcrypt-hashed server-side, never shipped to the browser).

## 1. Create a project

1. Go to https://supabase.com and sign up / log in.
2. Create a new project (free tier is fine). Pick any region, remember the DB password for later.
3. Once created, open **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (safe to expose in a static site)

## 2. Run the SQL

Open **SQL Editor → New query**, paste everything from `supa-setup.sql` (in this repo),
and run it. The script sets up:

- `comments` — messages, `is_anon`, `is_verified`, timestamps
- `owner` — a single bcrypt-hashed passcode (default `cz2026`)
- `likes` — one row per `(comment_id, liker)`; guests use a random id, the owner uses `liker = 'owner'`
- RLS: public read on `comments`/`likes`; insert on `comments` only with `is_verified = false`;
  guest insert/delete on `likes` only for non-owner rows
- RPCs (security definer, grant to `anon`):
  - `verify_owner(passcode) -> boolean` — check the owner passcode
  - `owner_post(name, message, is_anon, passcode) -> bigint` — post as verified owner
  - `owner_toggle_like(cid, passcode) -> boolean` — owner like/unlike
  - `delete_comment(cid, passcode)` — delete any comment
  - `change_passcode(old, new)` — rotate the passcode

> Do NOT run `create extension pgcrypto` (it's preinstalled) and do NOT add
> `set search_path = public` to the functions — PostgREST hides RPC functions that
> carry a `SET` clause, so the RPCs would 404.

## Cross-browser content sync

Gallery items, links, projects, acquaintances, status phrases and
the view counter are now synced through Supabase so they match on every browser/device
(`/sync.js` reads/writes a `site_data` key/value table).

To enable it, re-open **SQL Editor → New query** and run **only the `site_data`
section** at the bottom of `supa-setup.sql` (the part that creates `site_data`,
`site_upsert` and `add_visit`). It is idempotent — safe to run again.

How it behaves:

- **Reads** go through the public RLS policy, so visitors always see the latest owner content.
- **Writes** are owner-only via the `site_upsert` RPC, protected by the same vault passcode
  (`cz2026` by default) checked server-side with bcrypt — visitors can never overwrite content.
- **Reconcile**: opening `/vault` pulls the server copy into your browser. If the server is
  empty but this browser has content, the vault pushes it up once (first-time migration).
- **Offline/no-SQL fallback**: still renders from localStorage, so nothing breaks if the
  backend is unreachable.
- The **view counter** increments atomically server-side (`add_visit`) and shows the shared
  global count everywhere; localStorage is just a cache.
- Not synced (deliberately): the passcode, your background preference and Supabase
  credentials — those are per-browser settings.

## 3. Connect the site

1. Open `https://cz-navy.vercel.app/vault` and unlock it (default passcode `cz2026`).
2. In **Settings → Supabase connection**, paste the **Project URL** and **anon public** key, save.
   The page reloads so the guestbook picks up the fresh config.
3. In **Guestbook moderation**, sign in with the guestbook passcode (`cz2026` by default) to
   unlock deleting comments. Use **Change** in Settings to rotate that passcode.

## How the guestbook behaves

- **Owner post/sign-in**: open the guestbook → **Sign in** with the passcode. Signed-in, your
  likes use the dedicated owner row and you can delete comments from `/vault`. The passcode is
  kept in `sessionStorage` only while the tab is open.
- **Guest likes**: liked entries are remembered per-browser via a random id in localStorage —
  no account needed, guests can never fake an owner like.
- **Profanity** is filtered on the client before posting; it is not a substitute for
  moderation, which is why the delete flow exists.

## Security notes

- RLS lets anyone read `comments`/`likes` and post comments — that's intended for a public guestbook.
- Everything owner-scoped (verified posts, owner like, deletes, passcode change) goes through
  security-definer RPCs that bcrypt-compare the passcode on the server.
- The anon key is meant to be public. Never ship the **service_role** key in the browser.