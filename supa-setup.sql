-- note: pgcrypto is preinstalled on Supabase; do NOT run "create extension".
-- note: do NOT add "set search_path = public" to the functions below --
-- PostgREST hides RPC functions that carry a SET clause.

create table if not exists comments (
  id bigint generated always as identity primary key,
  name text not null default '',
  message text not null,
  is_anon boolean not null default false,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists owner (
  id int primary key default 1 check (id = 1),
  hash text not null
);

-- guest like rows. liker = "owner" marks the vault owner's like, guests use a
-- random anonymous id stored in their browser.
create table if not exists likes (
  comment_id bigint not null references comments(id) on delete cascade,
  liker text not null,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (comment_id, liker)
);

insert into owner (id, hash) values (1, crypt('cz2026', gen_salt('bf')))
on conflict (id) do nothing;

alter table comments enable row level security;
alter table owner enable row level security;
alter table likes enable row level security;

create policy "comments public read" on comments
  for select to anon using (true);

-- guests may post, but never mark a comment as verified (owner badge).
create policy "comments public insert" on comments
  for insert to anon with check (is_verified = false);

create policy "likes public read" on likes
  for select to anon using (true);

-- guests may insert/delete their own like rows only; the owner row is
-- managed exclusively through owner_toggle_like below.
create policy "likes guest insert" on likes
  for insert to anon with check (
    is_owner = false and
    liker <> 'owner' and
    length(liker) between 3 and 64
  );

create policy "likes guest delete" on likes
  for delete to anon using (is_owner = false and liker <> 'owner');

-- ---------------------------------------------------------------------------
-- RPCs below are security definer (run as table owner -> bypass RLS) and do
-- their own bcrypt passcode check. Grants are limited to anon.
-- ---------------------------------------------------------------------------

create or replace function verify_owner(passcode text)
returns boolean
language plpgsql
security definer
as $$
declare h text;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  return h = crypt(coalesce(passcode, ''), h);
end $$;

create or replace function owner_post(name text, message text, is_anon boolean, passcode text)
returns bigint
language plpgsql
security definer
as $$
declare h text;
declare new_id bigint;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  if h <> crypt(coalesce(passcode, ''), h) then
    raise exception 'wrong passcode';
  end if;
  insert into comments (name, message, is_anon, is_verified)
  values (coalesce(name, ''), coalesce(message, ''), coalesce(is_anon, false), true)
  returning id into new_id;
  return new_id;
end $$;

create or replace function owner_toggle_like(cid bigint, passcode text)
returns boolean
language plpgsql
security definer
as $$
declare h text;
declare cnt int;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  if h <> crypt(coalesce(passcode, ''), h) then
    raise exception 'wrong passcode';
  end if;
  select count(*) into cnt from likes where comment_id = cid and liker = 'owner';
  if cnt > 0 then
    delete from likes where comment_id = cid and liker = 'owner';
    return false;
  else
    insert into likes (comment_id, liker, is_owner) values (cid, 'owner', true);
    return true;
  end if;
end $$;

create or replace function delete_comment(cid bigint, passcode text)
returns void
language plpgsql
security definer
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
as $$
declare h text;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  if h = crypt(old, h) then
    if new is null or length(new) < 4 then
      raise exception 'password too short';
    end if;
    update owner set hash = crypt(new, gen_salt('bf')) where id = 1;
  else
    raise exception 'wrong password';
  end if;
end $$;

revoke all on function verify_owner(text) from public;
grant execute on function verify_owner(text) to anon;
revoke all on function owner_post(text, text, boolean, text) from public;
grant execute on function owner_post(text, text, boolean, text) to anon;
revoke all on function owner_toggle_like(bigint, text) from public;
grant execute on function owner_toggle_like(bigint, text) to anon;
revoke all on function delete_comment(bigint, text) from public;
grant execute on function delete_comment(bigint, text) to anon;
revoke all on function change_passcode(text, text) from public;
grant execute on function change_passcode(text, text) to anon;

-- ---------------------------------------------------------------------------
-- site_data: cross-browser sync of owner content (gallery, links, projects,
-- friends, phrases, socials) plus the global view counter. Guests read via a
-- public RLS policy; only the owner can write, gated by the same bcrypt
-- passcode used for the guestbook (security-definer RPC, grant to anon).
-- This section is idempotent, so you can run just it (or re-run everything).
-- ---------------------------------------------------------------------------

create table if not exists site_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table site_data enable row level security;

drop policy if exists "site_data public read" on site_data;
create policy "site_data public read" on site_data
  for select to anon using (true);

create or replace function site_upsert(dkey text, dvalue jsonb, passcode text)
returns void
language plpgsql
security definer
as $$
declare h text;
begin
  select hash into h from owner where id = 1;
  if h is null or h = '' then
    raise exception 'owner not configured';
  end if;
  if h <> crypt(coalesce(passcode, ''), h) then
    raise exception 'wrong passcode';
  end if;
  insert into site_data (key, value, updated_at)
  values (dkey, coalesce(dvalue, 'null'::jsonb), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
end $$;

create or replace function add_visit()
returns bigint
language plpgsql
security definer
as $$
declare n bigint;
begin
  insert into site_data (key, value, updated_at)
  values ('visits', to_jsonb(1), now())
  on conflict (key) do update
    set value = to_jsonb(coalesce((site_data.value #>> '{}')::int, 0) + 1),
        updated_at = now()
  returning (value #>> '{}')::bigint into n;
  return n;
end $$;

revoke all on function site_upsert(text, jsonb, text) from public;
grant execute on function site_upsert(text, jsonb, text) to anon;
revoke all on function add_visit() from public;
grant execute on function add_visit() to anon;

-- ---------------------------------------------------------------------------
-- Gallery media storage. This public bucket holds only display media while the
-- gallery list itself remains owner-controlled by site_upsert above. The 100 MB
-- limit matches the Vault uploader and prevents oversized uploads.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery-media', 'gallery-media', true, 104857600, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = 104857600,
  allowed_mime_types = array['video/mp4'];

drop policy if exists "gallery media public read" on storage.objects;
create policy "gallery media public read" on storage.objects
  for select to public using (bucket_id = 'gallery-media');
drop policy if exists "gallery media vault upload" on storage.objects;
create policy "gallery media vault upload" on storage.objects
  for insert to anon with check (bucket_id = 'gallery-media');
