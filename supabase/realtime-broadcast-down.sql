-- Undo realtime-broadcast.sql (clients fall back to their 45s / refetch polls until redeployed).
drop trigger if exists zz_rt_broadcast on public.live_game_state;
drop trigger if exists zz_rt_broadcast on public.game_broadcast;
drop trigger if exists zz_rt_broadcast on public.game_videos;
drop function if exists public.rt_live_game_state();
drop function if exists public.rt_game_broadcast();
drop function if exists public.rt_game_videos();
drop function if exists public.rt_send(text, text, jsonb);
