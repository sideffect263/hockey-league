-- user-contact.sql (P0 — 2026-08-02)
-- Applied to production via MCP as migration `user_contact`.
--
-- Contact details for officials. Sheet rows 16–17 ask for a judge who registers
-- "עם שם מלא" and a medic "עם שם מלא וטלפון בטופס המשחק".
--
-- Deliberately NOT a column on `profiles`: that table's SELECT policy is
-- `USING (true)` — world-readable, anon included — so a phone number added there
-- would be published to the open internet by every existing profile query.
-- Here the row is readable only by its owner and by admins / league managers
-- (who need it to run the game), and writable only by its owner.

create table if not exists public.user_contact (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  updated_at timestamptz not null default now()
);

alter table public.user_contact enable row level security;

drop policy if exists "read own contact or manager" on public.user_contact;
create policy "read own contact or manager" on public.user_contact
  for select using (
    user_id = (select auth.uid())
    or public.is_admin()
    or public.is_league_manager()
  );

drop policy if exists "insert own contact" on public.user_contact;
create policy "insert own contact" on public.user_contact
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "update own contact" on public.user_contact;
create policy "update own contact" on public.user_contact
  for update using (user_id = (select auth.uid()) or public.is_admin());

-- Officials for a game, with the contact details the game sheet needs. Definer because
-- a league manager cannot read user_contact rows broadly via RLS on its own.
create or replace function public.game_officials_contact(p_game_id uuid)
returns table (role text, status text, user_id uuid, full_name text, phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then
    raise exception 'not authorized';
  end if;
  return query
    select go.role, go.status, go.user_id,
           coalesce(case when uc.full_name ~ '[[:alpha:]א-ת]' then btrim(uc.full_name) end, pr.display_name) as full_name, -- no-letter names (".") fall back
           uc.phone
    from public.game_officials go
    left join public.user_contact uc on uc.user_id = go.user_id
    left join public.profiles pr     on pr.id      = go.user_id
    where go.game_id = p_game_id
    order by go.role, full_name;
end;
$$;
revoke all on function public.game_officials_contact(uuid) from public, anon;
grant execute on function public.game_officials_contact(uuid) to authenticated;
