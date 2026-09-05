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

- `comments` — messages, `is_anon`, `is_verified` (owner badge), timestamps
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

## 3. Connect the site

1. Open `https://cz-navy.vercel.app/vault` and unlock it (default passcode `cz2026`).
2. In **Settings → Supabase connection**, paste the **Project URL** and **anon public** key, save.
   The page reloads so the guestbook picks up the fresh config.
3. In **Guestbook moderation**, sign in with the guestbook passcode (`cz2026` by default) to
   unlock deleting comments. Use **Change** in Settings to rotate that passcode.

## How the guestbook behaves

- **Owner post/sign-in**: open the guestbook → **Sign in** with the passcode. Signed-in, your
  posts get the "✓ official" badge and your likes use the dedicated owner row. The passcode is
  kept in `sessionStorage` only while the tab is open.
- **Guest likes**: liked entries are remembered per-browser via a random id in localStorage —
  no account needed, guests can never fake an owner like or the verified badge.
- **Profanity** is filtered on the client before posting; it is not a substitute for
  moderation, which is why the delete flow exists.

## Security notes

- RLS lets anyone read `comments`/`likes` and post comments — that's intended for a public guestbook.
- Everything owner-scoped (verified posts, owner like, deletes, passcode change) goes through
  security-definer RPCs that bcrypt-compare the passcode on the server.
- The anon key is meant to be public. Never ship the **service_role** key in the browser.