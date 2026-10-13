-- Rollback of live-activity-team-switch.sql. Deploy the previous live-activity-push
-- (filters follows.notify) FIRST, then run this.
create or replace function public._live_activity_on_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
begin
  if exists (select 1 from public.live_activity_tokens where game_id = g) then
    perform public._live_activity_kick(g, case tg_op when 'DELETE' then 'deleted' else 'state' end);
  elsif tg_op <> 'DELETE' and coalesce(new.is_running, false)
        and not exists (select 1 from public.live_activity_games where game_id = g and start_sent_at is not null)
        and exists (
          select 1 from public.live_activity_start_tokens st
            join public.follows f on f.user_id = st.user_id and f.target_type = 'team' and f.notify
            join public.games gm on gm.id = g and f.target_id in (gm.home_team_id, gm.away_team_id)) then
    perform public._live_activity_kick(g, 'state');
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public._live_activity_on_state() from public, anon, authenticated;
drop function if exists public.set_team_live_updates(uuid, boolean);
alter table public.follows drop column if exists live_updates;
