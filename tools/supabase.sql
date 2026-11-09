-- Likes und Kommentare der App vinifeli.
-- Einmal im SQL-Editor des Supabase-Projekts ausführen. Fasst nur die eigenen fz_-Tabellen an.
-- Die App hat keinen Zugangsschutz: Jede Person mit dem Link kann lesen und schreiben.

create table if not exists public.fz_likes (angebot text not null check (char_length(angebot) <= 120), name text not null check (char_length(name) between 1 and 40), erstellt timestamptz not null default now(), primary key (angebot, name));
create table if not exists public.fz_kommentare (id bigint generated always as identity primary key, angebot text not null check (char_length(angebot) <= 120), name text not null check (char_length(name) between 1 and 40), text text not null check (char_length(text) between 1 and 1000), erstellt timestamptz not null default now());
alter table public.fz_likes enable row level security;
alter table public.fz_kommentare enable row level security;
drop policy if exists "fz likes lesen" on public.fz_likes;
drop policy if exists "fz likes setzen" on public.fz_likes;
drop policy if exists "fz likes entfernen" on public.fz_likes;
drop policy if exists "fz kommentare lesen" on public.fz_kommentare;
drop policy if exists "fz kommentare schreiben" on public.fz_kommentare;
drop policy if exists "fz kommentare entfernen" on public.fz_kommentare;
create policy "fz likes lesen" on public.fz_likes for select to anon using (true);
create policy "fz likes setzen" on public.fz_likes for insert to anon with check (true);
create policy "fz likes entfernen" on public.fz_likes for delete to anon using (true);
create policy "fz kommentare lesen" on public.fz_kommentare for select to anon using (true);
create policy "fz kommentare schreiben" on public.fz_kommentare for insert to anon with check (true);
create policy "fz kommentare entfernen" on public.fz_kommentare for delete to anon using (true);
grant select, insert, delete on public.fz_likes to anon;
grant select, insert, delete on public.fz_kommentare to anon;
