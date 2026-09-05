# Supabase setup (guestbook)

The guestbook on the home page stores comments in Supabase. Visitors can post and read
comments; you (the owner) can delete them from `/vault` using a password that is verified
server-side (not shipped to the browser except when you type it).

## 1. Create a project

1. Go to https://supabase.com and sign up / log in.
2. Create a new project (free tier is fine). Pick any region, remember the DB password for later.
3. Once created, open **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key (safe to expose in a static site)

## 2. Run the SQL

Open **SQL Editor → New query**, paste everything below, and run it:

```sql
create extension if not exists pgcrypto;

create table if not exists comments (
  id bigint generated always as identity primary key,
  name text not null default '',
  message text not null,
  is_anon boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists owner (
  id int primary key default 1 check (id = 1),
  hash text not null
);

-- default guestbook password is: cz2026
insert into owner (id, hash) values (1, crypt('cz2026', gen_salt('bf')))
on conflict (id) do nothing;

alter table comments enable row level security;
alter table owner enable row level security;

create policy "comments public read" on comments
  for select to anon using (true);

create policy "comments public insert" on comments
  for insert to anon with check (true);

create or replace function delete_comment(cid bigint, passcode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h text;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  if h = crypt(passcode, h) then
    delete from comments where id = cid;
  else
    raise exception 'wrong passcode';
  end if;
end $$;

create or replace function change_passcode(old text, new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare h text;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' or h = crypt(old, h) then
    if new is null or length(new) < 4 then
      raise exception 'password too short';
    end if;
    update owner set hash = crypt(new, gen_salt('bf')) where id = 1;
  else
    raise exception 'wrong password';
  end if;
end $$;

revoke all on function delete_comment(bigint, text) from public;
grant execute on function delete_comment(bigint, text) to anon;
revoke all on function change_passcode(text, text) from public;
grant execute on function change_passcode(text, text) to anon;
```

## 3. Connect the site

1. Open `https://cz-navy.vercel.app/vault` and unlock it (default passcode `cz2026`).
2. In **Settings → Supabase connection**, paste the **Project URL** and **anon public** key, save.
3. In **Guestbook moderation**, enter the guestbook password (`cz2026` by default) and unlock —
   you can now delete comments. Use **Change** in Settings to rotate that password.

That's it — visitors can now read and post comments, and only the password lets you delete.

## Security notes

- RLS lets anyone read (`select`) and post (`insert`) — that's intended for a public guestbook.
- Deletes go through the security-definer `delete_comment(...)` function, which bcrypt-compares
  the password on the server. The password itself is only kept in your browser's `sessionStorage`
  while you're on `/vault`.
- The anon key is meant to be public. Never ship the **service_role** key in the browser.
- Profanity is filtered on the client before posting; it is not a substitute for moderation,
  which is why the delete flow exists.