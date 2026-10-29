-- OPTIONAL, LATER — 2026-10-29. NOT APPLIED. Apply only after card-unlink-requests.sql
-- AND once every supported app (iOS + Android) files "זה לא הכרטיס שלי" as a request:
-- older builds still call disconnect_my_pairing and would start showing "ניתוק נכשל".
-- Undo: card-unlink-requests-enforce-down.sql.
--
-- Closes the two server paths that let an account drop its APPROVED card link by itself:
--   1. disconnect_my_pairing() — now refuses while the account is linked (every link is
--      approved) with 'unlink-needs-request'; admins / league managers keep it.
--   2. guard_profile_player_id — the "own row, set player_id to null" exemption is removed,
--      so a direct PATCH profiles {player_id: null} is refused too.
-- Approved requests are unaffected (decide_card_unlink_request runs as the LM/admin).

create or replace function public.disconnect_my_pairing()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not (public.is_admin() or public.is_league_manager())
     and exists (select 1 from public.profiles where id = uid and player_id is not null) then
    raise exception 'unlink-needs-request';
  end if;
  update public.profiles set player_id = null where id = uid;
  delete from public.user_roles where user_id = uid and role = 'player';
  delete from public.player_claims where profile_id = uid and status = 'approved';
end; $$;

create or replace function public.guard_profile_player_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.player_id is distinct from old.player_id
     and not public.is_admin()
     and not public.is_league_manager()
     and not (
       new.player_id is not null
       and public.is_coach_of((select team_id from public.players where id = new.player_id))
     ) then
    raise exception 'player_id can only be changed by an admin';
  end if;
  return new;
end; $$;
