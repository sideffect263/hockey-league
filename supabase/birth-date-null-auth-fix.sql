-- set_player_birth_date: close the NULL hole in its authorization check (2026-10-30).
--
-- The check ended with `or p_player = public.my_player_id()`. For a caller with no player card
-- my_player_id() is NULL, so that term is NULL, the whole `not (… or NULL)` is NULL, and
-- `if NULL then raise` does not raise. Any signed-in account without a card (fans, staff not
-- linked to a card) could set ANY player's birth date, minors included. Anonymous callers were
-- never affected: anon has no EXECUTE on this function.
--
-- Found by the leaguekit platform's cross-league scan (leaguekit-web supabase/tests/
-- p3_rpc_byid.sql). The body below is the live one with only that term wrapped in coalesce;
-- CREATE OR REPLACE keeps the existing grants (authenticated only).

create or replace function public.set_player_birth_date(p_player uuid, p_birth date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_birth is not null then
    if p_birth > current_date then raise exception 'birth date in future'; end if;
    if p_birth < current_date - interval '100 years' then raise exception 'birth date too old'; end if;
  end if;
  if not (
    coalesce(public.is_admin(), false)
    or coalesce(public.is_league_manager(), false)
    or coalesce(public.is_coach_of_player(p_player), false)
    or coalesce(p_player = public.my_player_id(), false)
  ) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.players where id = p_player) then
    raise exception 'player not found';
  end if;
  update public.players set birth_date = p_birth where id = p_player;
end;
$function$;
