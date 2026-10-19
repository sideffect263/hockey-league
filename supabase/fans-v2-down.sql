-- Rollback of fans-v2.sql: counts include every follow again, goal/result pushes go
-- to every follower with the bell on, and the watch marks are dropped.

-- send_game_reminder back to game_followers (before game_fans is dropped)
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.send_game_reminder(text,uuid,date,uuid)'::regprocedure);
  v_new := replace(v_def, 'public.game_fans(p_game, true)', 'public.game_followers(p_game)');
  if v_new <> v_def then execute v_new; end if;
end $$;

create or replace function public.game_followers(p_game uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select distinct f.user_id
  from public.follows f
  join public.games g on g.id = p_game
  where f.notify
    and (
      (f.target_type = 'team' and f.target_id in (g.home_team_id, g.away_team_id))
      or (f.target_type = 'player' and exists (
            select 1 from public.players p
            where p.id = f.target_id
              and (p.team_id in (g.home_team_id, g.away_team_id)
                   or exists (select 1 from public.player_teams pt
                              where pt.player_id = p.id
                                and pt.team_id in (g.home_team_id, g.away_team_id)))))
    )
$$;
revoke all on function public.game_followers(uuid) from public, anon;
grant execute on function public.game_followers(uuid) to authenticated;

create or replace function public.follower_counts(p_type text, p_ids uuid[])
returns table (target_id uuid, followers bigint)
language sql stable security definer set search_path = public as $$
  select f.target_id, count(*)::bigint
  from public.follows f
  where f.target_type = p_type and f.target_id = any(p_ids)
  group by f.target_id
$$;
grant execute on function public.follower_counts(text, uuid[]) to authenticated, anon;

drop function if exists public.admin_fan_overview();
drop function if exists public.team_fan_stats(uuid);
drop function if exists public.set_game_watch(uuid, boolean);
drop function if exists public.game_fan_summary(uuid);
drop table if exists public.game_watchers;
drop function if exists public.fan_badges(uuid[]);
drop function if exists public.game_fans(uuid, boolean);
drop function if exists public.my_roster_team_ids();
drop function if exists public.is_real_fan(uuid, text, uuid);
