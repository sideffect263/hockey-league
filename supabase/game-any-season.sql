-- Applied LIVE 2026-10-12 (migrations game_any_season_rpc, _no_planned, _embeds).
-- One game + its box score, from ANY season. The games / game_stats RLS keeps archived
-- seasons out of every list (standings, statistics, calendars) on purpose; this only
-- answers "show me THIS game", so an old link opens the game instead of "not found".
-- Read-only; 🧪 test games stay hidden; a PLANNED season stays admin / LM only.
create or replace function public.game_any_season(p_game_id uuid default null, p_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with g as (
    select g.* from public.games g
     where (p_game_id is not null and g.id = p_game_id)
        or (p_game_id is null and p_slug is not null and g.slug = p_slug)
     limit 1
  )
  select case when g.id is null then null else jsonb_build_object(
           -- team name + crest embedded like the apps' games select, so one call is enough
           'game', to_jsonb(g) || jsonb_build_object(
               'home_team', (select jsonb_build_object('name', t.name, 'logo_url', t.logo_url) from public.teams t where t.id = g.home_team_id),
               'away_team', (select jsonb_build_object('name', t.name, 'logo_url', t.logo_url) from public.teams t where t.id = g.away_team_id)),
           'season_name', (select s.name from public.seasons s where s.id = g.season_id),
           'stats', coalesce((
               select jsonb_agg(to_jsonb(st) || jsonb_build_object('player',
                        (select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name,
                                                   'jersey_number', p.jersey_number, 'team_id', p.team_id)
                           from public.players p where p.id = st.player_id)))
                 from public.game_stats st where st.game_id = g.id), '[]'::jsonb)
         ) end
    from g
   where (not g.is_test or public.can_see_test())
     and (g.tournament_id is not null
          or exists (select 1 from public.seasons s where s.id = g.season_id and s.status in ('active', 'archived'))
          or public.is_admin() or public.is_league_manager());
$$;

revoke all on function public.game_any_season(uuid, text) from public;
grant execute on function public.game_any_season(uuid, text) to anon, authenticated;
