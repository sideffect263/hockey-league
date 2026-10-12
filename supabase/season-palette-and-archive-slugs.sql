-- Applied LIVE 2026-10-12 (migration season_palette_and_archive_slugs).
--
-- 1. seasons.palette: which colour scheme a season is shown in. The nav-bar season picker
--    re-skins the site when you browse an old season, so 2025-26 shows in the orange the
--    site wore that year, and the live season keeps the "Rink" blue. A new season gets
--    'rink' unless someone picks otherwise.
-- 2. season_games_detail gains slug + team slugs/crests (appended; callers decode by
--    name), so archived games link to their /games/<slug> page and crawlers can list them.
alter table public.seasons add column if not exists palette text not null default 'rink'
  check (palette in ('rink', 'classic'));
update public.seasons set palette = 'classic' where slug = '2025-26';

drop function if exists public.season_games_detail(uuid);
create function public.season_games_detail(p_season_id uuid)
returns table(id uuid, game_date timestamptz, venue text, home_team_id uuid, away_team_id uuid,
              home_team_name text, away_team_name text, home_score integer, away_score integer,
              status text, game_type text, playoff_round text, series_game integer,
              slug text, home_team_slug text, away_team_slug text, home_logo_url text, away_logo_url text)
language sql stable security definer set search_path to 'public'
as $$
  select g.id, g.game_date, g.venue,
         g.home_team_id, g.away_team_id,
         coalesce(ht.name, ''), coalesce(at.name, ''),
         g.home_score, g.away_score,
         g.status, g.game_type, g.playoff_round, g.series_game,
         g.slug, ht.slug, at.slug, ht.logo_url, at.logo_url
  from public.games g
  left join public.teams ht on ht.id = g.home_team_id
  left join public.teams at on at.id = g.away_team_id
  where g.season_id = p_season_id
    and (not g.is_test or public.can_see_test())
  order by g.game_date desc
$$;
grant execute on function public.season_games_detail(uuid) to anon, authenticated;

-- Applied LIVE 2026-10-12 (migration season_game_stats_rpc): box scores for one season,
-- so the archive's statistics tab can run the /statistics derivations on a past season.
create or replace function public.season_game_stats(p_season_id uuid)
returns setof public.game_stats
language sql stable security definer set search_path to 'public'
as $$
  select st.* from public.game_stats st
    join public.games g on g.id = st.game_id
   where g.season_id = p_season_id
     and (not g.is_test or public.can_see_test())
     and exists (select 1 from public.seasons s where s.id = p_season_id and s.status in ('active', 'archived'))
$$;
revoke all on function public.season_game_stats(uuid) from public;
grant execute on function public.season_game_stats(uuid) to anon, authenticated;
