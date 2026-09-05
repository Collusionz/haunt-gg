-- note: pgcrypto is preinstalled on Supabase; do NOT run "create extension".
-- note: do NOT add "set search_path = public" to the functions below --
-- PostgREST hides RPC functions that carry a SET clause.

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

revoke all on function delete_comment(bigint, text) from public;
grant execute on function delete_comment(bigint, text) to anon;
revoke all on function change_passcode(text, text) from public;
grant execute on function change_passcode(text, text) to anon;