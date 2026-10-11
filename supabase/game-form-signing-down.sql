-- Reverses supabase/game-form-signing.sql. Drops recorded signatures, captains and the
-- archived fouls/timeouts — export them first if they matter.
drop trigger if exists live_game_state_archive on public.live_game_state;
drop trigger if exists games_stamp_captains on public.games;
drop function if exists public.game_form_signatures(uuid);
drop function if exists public.clear_game_signature(uuid, text);
drop function if exists public.sign_game_form(uuid, text, text);
drop function if exists public.game_sign_roles(uuid);
drop function if exists public._can_sign_game(uuid, text, uuid);
drop function if exists public.set_game_captain(uuid, text, uuid);
drop function if exists public.set_team_captain(uuid, uuid);
drop function if exists public._player_on_team(uuid, uuid);
drop function if exists public.game_captain(uuid, text);
drop function if exists public._stamp_game_captains();
drop function if exists public._archive_live_state();
drop function if exists public._game_event_key(jsonb);
drop table if exists public.game_signatures;
drop table if exists public.game_reports;
alter table public.teams drop column if exists captain_player_id;
