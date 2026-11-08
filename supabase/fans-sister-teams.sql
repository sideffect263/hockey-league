-- Fans: sister teams (2026-11-09)
-- Ariel's rule: a player of one Givat Ada team who follows the OTHER Givat Ada team
-- is not counted as a fan (same as following his own team).
--
-- Only COUNTING changes. Pushes ("plays today", day-before alert) and "coming to watch"
-- keep the old own-team rule, so a נוער player can still follow איחוד, get its game
-- pushes and mark that he is coming to watch.
--
-- team_clubs groups teams of the same club. Add more rows for future clubs with two teams.
-- Rollback: fans-sister-teams-down.sql

create table if not exists public.team_clubs (
  team_id uuid primary key references public.teams(id) on delete cascade,
  club    text not null
);
alter table public.team_clubs enable row level security;
drop policy if exists team_clubs_read on public.team_clubs;
create policy team_clubs_read on public.team_clubs for select using (true);

insert into public.team_clubs (team_id, club) values
  ('a1b2c3d4-0001-0000-0000-000000000001', 'givat-ada'),  -- גבעת עדה איחוד
  ('a1b2c3d4-0003-0000-0000-000000000003', 'givat-ada')   -- גבעת עדה נוער
on conflict (team_id) do update set club = excluded.club;

-- The old is_real_fan body: "not the player himself / not his own team".
create or replace function public.is_not_own_team(p_user uuid, p_type text, p_target uuid)
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

-- Counted fan = not own team AND not a sister team of his own team.
create or replace function public.is_real_fan(p_user uuid, p_type text, p_target uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_not_own_team(p_user, p_type, p_target)
     and not (p_type = 'team' and exists (
       select 1
         from public.profiles pr
         join public.team_clubs tt on tt.team_id = p_target
         join public.team_clubs tm on tm.club = tt.club and tm.team_id <> p_target
        where pr.id = p_user and pr.player_id is not null
          and (exists (select 1 from public.players p
                        where p.id = pr.player_id and p.team_id = tm.team_id)
               or exists (select 1 from public.player_teams pt
                           where pt.player_id = pr.player_id and pt.team_id = tm.team_id))))
$$;

-- Push + "coming to watch" paths keep the own-team rule only.
do $$
declare
  v_def text;
begin
  -- game_fans, set_game_watch, send_game_reminder: every is_real_fan call is a "player in this game" check
  foreach v_def in array array[
    pg_get_functiondef('public.game_fans(uuid,boolean)'::regprocedure),
    pg_get_functiondef('public.set_game_watch(uuid,boolean)'::regprocedure),
    pg_get_functiondef('public.send_game_reminder(text,uuid,date,uuid)'::regprocedure)
  ] loop
    execute replace(v_def, 'public.is_real_fan(', 'public.is_not_own_team(');
  end loop;
  -- game_fan_summary: only me_roster (the viewer's own check), fan counts stay on is_real_fan
  v_def := pg_get_functiondef('public.game_fan_summary(uuid)'::regprocedure);
  execute replace(v_def, 'public.is_real_fan(v_uid', 'public.is_not_own_team(v_uid');
end $$;
