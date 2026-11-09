-- Rollback for fans-sister-teams.sql: back to the fans_v2 rule (own team only).

do $$
declare
  v_def text;
begin
  foreach v_def in array array[
    pg_get_functiondef('public.game_fans(uuid,boolean)'::regprocedure),
    pg_get_functiondef('public.set_game_watch(uuid,boolean)'::regprocedure),
    pg_get_functiondef('public.send_game_reminder(text,uuid,date,uuid)'::regprocedure),
    pg_get_functiondef('public.game_fan_summary(uuid)'::regprocedure)
  ] loop
    execute replace(v_def, 'public.is_not_own_team(', 'public.is_real_fan(');
  end loop;
end $$;

create or replace function public.is_real_fan(p_user uuid, p_type text, p_target uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not exists (
    select 1 from public.profiles pr
     where pr.id = p_user and pr.player_id is not null
       and (
         (p_type = 'player' and pr.player_id = p_target)
         or (p_type = 'team' and (
               exists (select 1 from public.players p
                        where p.id = pr.player_id and p.team_id = p_target)
               or exists (select 1 from public.player_teams pt
                           where pt.player_id = pr.player_id and pt.team_id = p_target)))
       )
  )
$$;

drop function if exists public.is_not_own_team(uuid, text, uuid);
drop table if exists public.team_clubs;
