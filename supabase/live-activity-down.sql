-- Rollback of live-activity.sql (2026-10-13). Removes the triggers first, so the judge's
-- broadcast and the save are exactly as before; then the RPCs and tables.
drop trigger if exists live_game_state_live_activity on public.live_game_state;
drop trigger if exists games_live_activity_final on public.games;
drop function if exists public._live_activity_on_state();
drop function if exists public._live_activity_on_game_status();
drop function if exists public.register_live_activity_token(uuid, text, text, text, text, integer);
drop function if exists public.unregister_live_activity_token(uuid, text, text);
drop function if exists public.register_live_activity_start_token(text, text, text, text, integer);
drop function if exists public.unregister_live_activity_start_token(text, text);
drop function if exists public._live_activity_kick(uuid, text, jsonb);
drop table if exists public.live_activity_games;
drop table if exists public.live_activity_tokens;
drop table if exists public.live_activity_start_tokens;
