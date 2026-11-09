-- ליגת הפנטזי — fantasy league over the real league's game_stats.
--
-- Shape (docs in src/pages/Fantasy.jsx header):
--   · One entry per user per season: a squad of 7 = 2 goalkeepers + 5 field players.
--     Lineup = 1 GK + 4 field starting, 1 GK + 1 field on the bench, one captain (×2).
--   · A ROUND is a calendar day (Israel time) with league games. It locks at its
--     first kickoff. Every save writes the lineup for the NEXT OPEN round; the
--     lineup that counts for round R is the latest save whose round_date <= R.
--     No cron, no snapshots: history is just the saved rows.
--   · Points are computed live from game_stats + games, so a judge correcting a
--     sheet re-flows every score. Nothing is stored except picks.
--   · Budget 50 (prices in fantasy_prices, snapshot by fantasy_reprice), max 2
--     players from one team, you can't pick yourself, 1 free transfer per round
--     and −3 for each extra.
--   · Every read and write goes through SECURITY DEFINER RPCs. The tables have RLS
--     on and only an owner-read policy, so nobody can see another manager's
--     lineup before the round locks.
--   · Gate: league_settings.feature_fantasy = 'on' opens it to everyone; anything
--     else = admins + developers only (so it can be tested live first).
--
-- Additive only. Down: supabase/fantasy-down.sql.

-- ---------------------------------------------------------------- tables

create table if not exists public.fantasy_prices (
  season_id uuid not null references public.seasons(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  price numeric(4,1) not null check (price between 3 and 15),
  updated_at timestamptz not null default now(),
  primary key (season_id, player_id)
);

create table if not exists public.fantasy_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 24),
  created_at timestamptz not null default now(),
  unique (season_id, user_id)
);

create table if not exists public.fantasy_lineups (
  entry_id uuid not null references public.fantasy_entries(id) on delete cascade,
  round_date date not null,
  saved_at timestamptz not null default now(),
  primary key (entry_id, round_date)
);

create table if not exists public.fantasy_lineup_players (
  entry_id uuid not null,
  round_date date not null,
  player_id uuid not null references public.players(id) on delete cascade,
  slot text not null check (slot in ('gk','f','bgk','bf')),
  is_captain boolean not null default false,
  primary key (entry_id, round_date, player_id),
  foreign key (entry_id, round_date) references public.fantasy_lineups(entry_id, round_date) on delete cascade
);
create index if not exists fantasy_lineup_players_player_idx on public.fantasy_lineup_players(player_id);

create table if not exists public.fantasy_leagues (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 32),
  code text not null unique,
  owner_entry_id uuid not null references public.fantasy_entries(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists fantasy_leagues_owner_idx on public.fantasy_leagues(owner_entry_id);

create table if not exists public.fantasy_league_members (
  league_id uuid not null references public.fantasy_leagues(id) on delete cascade,
  entry_id uuid not null references public.fantasy_entries(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, entry_id)
);
create index if not exists fantasy_league_members_entry_idx on public.fantasy_league_members(entry_id);

alter table public.fantasy_prices enable row level security;
alter table public.fantasy_entries enable row level security;
alter table public.fantasy_lineups enable row level security;
alter table public.fantasy_lineup_players enable row level security;
alter table public.fantasy_leagues enable row level security;
alter table public.fantasy_league_members enable row level security;

drop policy if exists fantasy_prices_read on public.fantasy_prices;
create policy fantasy_prices_read on public.fantasy_prices for select using (true);

drop policy if exists fantasy_entries_own on public.fantasy_entries;
create policy fantasy_entries_own on public.fantasy_entries for select
  using (user_id = (select auth.uid()));

drop policy if exists fantasy_lineups_own on public.fantasy_lineups;
create policy fantasy_lineups_own on public.fantasy_lineups for select
  using (exists (select 1 from public.fantasy_entries e where e.id = entry_id and e.user_id = (select auth.uid())));

drop policy if exists fantasy_lineup_players_own on public.fantasy_lineup_players;
create policy fantasy_lineup_players_own on public.fantasy_lineup_players for select
  using (exists (select 1 from public.fantasy_entries e where e.id = entry_id and e.user_id = (select auth.uid())));

-- leagues + members: RPC only (no policies → no direct reads).

-- ---------------------------------------------------------------- helpers

create or replace function public.fantasy_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value from league_settings where key = 'feature_fantasy'), 'off') = 'on'
      or coalesce(public.is_admin(), false)
      or coalesce(public.is_developer(), false)
$$;

create or replace function public.fantasy_season()
returns uuid language sql stable security definer set search_path = public as $$
  select id from seasons where status = 'active' order by starts_on desc nulls last limit 1
$$;

-- League games that make up the fantasy season (no tests, no postponed/cancelled
-- unless they were played after all).
create or replace function public.fantasy_games(p_season uuid)
returns table (game_id uuid, round_date date, game_date timestamptz, status text,
               home_team_id uuid, away_team_id uuid, home_score int, away_score int, mvp_player_id uuid)
language sql stable security definer set search_path = public as $$
  select g.id, (g.game_date at time zone 'Asia/Jerusalem')::date, g.game_date, g.status,
         g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.mvp_player_id
  from games g
  where g.season_id = p_season
    and g.game_type = 'ליגה'
    and not coalesce(g.is_test, false)
    and g.game_date is not null
    and (g.status = 'completed' or g.status not in ('postponed','cancelled'))
$$;

create or replace function public.fantasy_rounds(p_season uuid)
returns table (round_no int, round_date date, lock_at timestamptz, games int, completed int)
language sql stable security definer set search_path = public as $$
  select (row_number() over (order by round_date))::int, round_date, min(game_date),
         count(*)::int, count(*) filter (where status = 'completed')::int
  from public.fantasy_games(p_season)
  group by round_date
$$;

create or replace function public.fantasy_open_round(p_season uuid)
returns date language sql stable security definer set search_path = public as $$
  select min(round_date) from public.fantasy_rounds(p_season) where lock_at > now()
$$;

-- Points per player per completed game. The scoring table, all in one place:
--   played +1 · goal: field +2, GK +6 · win +2, draw +1
--   GK goals against: 0 → +6, 1–2 → +4, 3–4 → +2, 5–6 → +1, 7+ → 0
--   blue −1 · yellow −2 · red −3 · game MVP +3
create or replace function public.fantasy_player_game_points(p_season uuid)
returns table (player_id uuid, game_id uuid, round_date date, is_gk boolean,
               goals int, against int, result text, cards int, mvp boolean, points int)
language sql stable security definer set search_path = public as $$
  with g as (select * from public.fantasy_games(p_season) where status = 'completed'),
  s as (
    select gs.player_id, g.game_id, g.round_date, (p.position = 'Goalkeeper') as is_gk,
           coalesce(gs.goals, 0) as goals,
           coalesce(gs.blue_cards,0) as blue, coalesce(gs.yellow_cards,0) as yellow, coalesce(gs.red_cards,0) as red,
           (g.mvp_player_id = gs.player_id) as mvp,
           case coalesce(gs.played_for_team_id, p.team_id)
             when g.home_team_id then 'home' when g.away_team_id then 'away' end as side,
           g.home_score, g.away_score
    from g
    join game_stats gs on gs.game_id = g.game_id and gs.player_id is not null
    join players p on p.id = gs.player_id
  ),
  r as (
    select s.*,
      case side when 'home' then away_score when 'away' then home_score end as against,
      case
        when side is null or home_score is null or away_score is null then null
        when home_score = away_score then 'D'
        when (side = 'home') = (home_score > away_score) then 'W' else 'L' end as result
    from s
  )
  select player_id, game_id, round_date, is_gk, goals, against, result,
         blue + yellow + red,
         coalesce(mvp, false),
         ( 1
         + goals * case when is_gk then 6 else 2 end
         + case result when 'W' then 2 when 'D' then 1 else 0 end
         + case when not is_gk or against is null then 0
                when against = 0 then 6 when against <= 2 then 4
                when against <= 4 then 2 when against <= 6 then 1 else 0 end
         - blue - 2*yellow - 3*red
         + case when coalesce(mvp, false) then 3 else 0 end )::int
  from r
$$;

-- The lineup that counts for a round: the latest save on or before it.
create or replace function public.fantasy_effective_round(p_entry uuid, p_round date)
returns date language sql stable security definer set search_path = public as $$
  select max(round_date) from fantasy_lineups where entry_id = p_entry and round_date <= p_round
$$;

-- One entry's round, player by player, with auto-subs and the captain applied.
-- A starter who has no game_stats row that day is replaced by the bench player
-- of the same kind, if that bench player did play.
create or replace function public.fantasy_round_detail(p_entry uuid, p_round date)
returns table (player_id uuid, slot text, is_captain boolean, played boolean,
               base_points int, counted boolean, points int)
language sql stable security definer set search_path = public as $$
  with e as (select season_id from fantasy_entries where id = p_entry),
  lp as (
    select l.player_id, l.slot, l.is_captain
    from fantasy_lineup_players l
    where l.entry_id = p_entry and l.round_date = public.fantasy_effective_round(p_entry, p_round)
  ),
  pp as (
    select x.player_id, sum(x.points)::int as pts
    from public.fantasy_player_game_points((select season_id from e)) x
    where x.round_date = p_round
    group by x.player_id
  ),
  b as (select lp.*, (pp.player_id is not null) as played, coalesce(pp.pts, 0) as pts
        from lp left join pp on pp.player_id = lp.player_id),
  need as (
    select bool_or(slot = 'gk' and not played) as gk_out,
           bool_or(slot = 'f' and not played) as f_out
    from b
  )
  select b.player_id, b.slot, b.is_captain, b.played, b.pts,
         c.counted,
         (case when c.counted then b.pts * (case when b.is_captain and b.played then 2 else 1 end) else 0 end)::int
  from b, need,
  lateral (select (b.played and (b.slot in ('gk','f')
                                 or (b.slot = 'bgk' and coalesce(need.gk_out,false))
                                 or (b.slot = 'bf'  and coalesce(need.f_out,false)))) as counted) c
$$;

-- Transfers made FOR a round = players in that round's save not in the previous
-- save. First squad is free; 1 free per round; −3 each after.
create or replace function public.fantasy_round_transfers(p_entry uuid, p_round date)
returns int language sql stable security definer set search_path = public as $$
  with prev as (select max(round_date) d from fantasy_lineups where entry_id = p_entry and round_date < p_round)
  select case
    when not exists (select 1 from fantasy_lineups where entry_id = p_entry and round_date = p_round) then 0
    when (select d from prev) is null then 0
    else (select count(*)::int from fantasy_lineup_players a
          where a.entry_id = p_entry and a.round_date = p_round
            and not exists (select 1 from fantasy_lineup_players b
                            where b.entry_id = p_entry and b.round_date = (select d from prev)
                              and b.player_id = a.player_id))
  end
$$;

create or replace function public.fantasy_round_score(p_entry uuid, p_round date)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select sum(points) from public.fantasy_round_detail(p_entry, p_round)), 0)::int
       - greatest(public.fantasy_round_transfers(p_entry, p_round) - 1, 0) * 3
$$;

-- Every entry × every locked round, set-based (one pass over the games, not
-- one per entry per round). Same rules as fantasy_round_detail/_transfers —
-- scripts/check-fantasy.sql asserts the two agree.
create or replace function public.fantasy_scores(p_season uuid, p_entry uuid default null)
returns table (entry_id uuid, round_date date, points int)
language sql stable security definer set search_path = public as $$
  with r as (select round_date from public.fantasy_rounds(p_season) where lock_at <= now()),
  pts as (select x.player_id, x.round_date, sum(x.points)::int pts
          from public.fantasy_player_game_points(p_season) x group by 1, 2),
  e as (select id from fantasy_entries where season_id = p_season and (p_entry is null or id = p_entry)),
  eff as (
    select e.id entry_id, r.round_date,
           (select max(l.round_date) from fantasy_lineups l where l.entry_id = e.id and l.round_date <= r.round_date) lr
    from e cross join r
  ),
  b as (
    select eff.entry_id, eff.round_date, l.slot, l.is_captain,
           (pts.player_id is not null) played, coalesce(pts.pts, 0) pts
    from eff
    join fantasy_lineup_players l on l.entry_id = eff.entry_id and l.round_date = eff.lr
    left join pts on pts.player_id = l.player_id and pts.round_date = eff.round_date
  ),
  need as (
    select entry_id, round_date,
           bool_or(slot = 'gk' and not played) gk_out, bool_or(slot = 'f' and not played) f_out
    from b group by 1, 2
  ),
  sc as (
    select b.entry_id, b.round_date,
           sum(case when b.played and (b.slot in ('gk','f')
                                       or (b.slot = 'bgk' and n.gk_out) or (b.slot = 'bf' and n.f_out))
                    then b.pts * (case when b.is_captain then 2 else 1 end) else 0 end)::int pts
    from b join need n using (entry_id, round_date)
    group by 1, 2
  ),
  saves as (
    select l.entry_id, l.round_date,
           (select max(p.round_date) from fantasy_lineups p where p.entry_id = l.entry_id and p.round_date < l.round_date) prev
    from fantasy_lineups l join e on e.id = l.entry_id
    where l.round_date in (select round_date from r)
  ),
  tr as (
    select s.entry_id, s.round_date,
           case when s.prev is null then 0 else
             (select count(*)::int from fantasy_lineup_players a
              where a.entry_id = s.entry_id and a.round_date = s.round_date
                and not exists (select 1 from fantasy_lineup_players o
                                where o.entry_id = s.entry_id and o.round_date = s.prev and o.player_id = a.player_id))
           end n
    from saves s
  )
  select sc.entry_id, sc.round_date,
         (sc.pts - greatest(coalesce(tr.n, 0) - 1, 0) * 3)::int
  from sc left join tr using (entry_id, round_date)
$$;

-- ---------------------------------------------------------------- prices

-- Snapshot prices from every completed league game of the previous + current
-- season. Field: 4.5 + 4 × goals-per-game (≥3 games, else 5.0), 4.5–12.
-- GK: by his team's goals against per game, 9 − 0.6 × GA, 4.5–8.
create or replace function public.fantasy_reprice(p_season uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_season uuid := coalesce(p_season, public.fantasy_season()); v_n int;
begin
  if auth.uid() is not null and not coalesce(public.is_admin(), false) then
    raise exception 'admin only';
  end if;
  with recent as (
    select s.id from seasons s
    where s.id = v_season
       or s.id = (select id from seasons where status = 'archived' order by ends_on desc nulls last, starts_on desc nulls last limit 1)
  ),
  g as (select g.* from games g where g.season_id in (select id from recent) and g.status = 'completed'
        and g.game_type = 'ליגה' and not coalesce(g.is_test, false)),
  field as (
    select gs.player_id, count(*) gp, sum(coalesce(gs.goals,0)) goals
    from g join game_stats gs on gs.game_id = g.id where gs.player_id is not null group by 1
  ),
  ga as (
    select t, avg(c) ga from (
      select home_team_id t, away_score c from g union all select away_team_id, home_score from g) x
    group by t
  ),
  pool as (
    select p.id, p.position, p.team_id from players p join teams t on t.id = p.team_id
    where t.status = 'active' and not coalesce(t.is_test, false)
  ),
  priced as (
    select pool.id,
      case when pool.position = 'Goalkeeper' then
        least(8.0, greatest(4.5, round(2 * (9 - 0.6 * coalesce(ga.ga, 6))) / 2.0))
      else
        case when coalesce(f.gp, 0) < 3 then 5.0
             else least(12.0, greatest(4.5, round(2 * (4.5 + 4.0 * f.goals::numeric / f.gp)) / 2.0)) end
      end as price
    from pool left join field f on f.player_id = pool.id left join ga on ga.t = pool.team_id
  )
  insert into fantasy_prices (season_id, player_id, price, updated_at)
  select v_season, id, price, now() from priced
  on conflict (season_id, player_id) do update set price = excluded.price, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------- read RPCs

-- Everything the page needs in one round trip.
create or replace function public.fantasy_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_season uuid := public.fantasy_season();
  v_open date;
  v_entry fantasy_entries;
  v_uid uuid := auth.uid();
  v_last date;
  v_res jsonb;
begin
  if v_season is null then return jsonb_build_object('enabled', public.fantasy_enabled(), 'season', null); end if;
  v_open := public.fantasy_open_round(v_season);
  select max(round_date) into v_last from public.fantasy_rounds(v_season) where lock_at <= now() and completed > 0;
  if v_uid is not null then
    select * into v_entry from fantasy_entries where season_id = v_season and user_id = v_uid;
  end if;

  with pts as (select * from public.fantasy_player_game_points(v_season)),
  agg as (select player_id, sum(points)::int total, count(*)::int gp, sum(goals)::int goals,
                 sum(points) filter (where round_date = v_last)::int last_pts
          from pts group by player_id),
  pool as (
    select p.id, p.first_name, p.last_name, p.jersey_number, p.position, p.team_id, p.slug,
           coalesce(fp.price, 5.0) price, coalesce(a.total,0) total, coalesce(a.gp,0) gp,
           coalesce(a.goals,0) goals, a.last_pts,
           (select count(distinct l.entry_id) from fantasy_lineup_players l
             join fantasy_entries e on e.id = l.entry_id and e.season_id = v_season
            where l.player_id = p.id
              and l.round_date = public.fantasy_effective_round(l.entry_id, coalesce(v_last, v_open))) as picked
    from players p
    join teams t on t.id = p.team_id and t.status = 'active' and not coalesce(t.is_test, false)
    left join fantasy_prices fp on fp.season_id = v_season and fp.player_id = p.id
    left join agg a on a.player_id = p.id
  )
  select jsonb_build_object(
    'enabled', public.fantasy_enabled(),
    'season', (select jsonb_build_object('id', id, 'name', name) from seasons where id = v_season),
    'budget', 50,
    'max_per_team', 2,
    'transfer_cost', 3,
    'now', now(),
    'open_round', v_open,
    'last_round', v_last,
    'entries', (select count(*) from fantasy_entries where season_id = v_season),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('no', round_no, 'date', round_date, 'lock_at', lock_at,
                       'games', games, 'completed', completed) order by round_date), '[]'::jsonb)
               from public.fantasy_rounds(v_season)),
    'fixtures', (select coalesce(jsonb_agg(jsonb_build_object('game_id', game_id, 'round_date', round_date, 'at', game_date,
                       'home', home_team_id, 'away', away_team_id, 'home_score', home_score, 'away_score', away_score,
                       'status', status) order by game_date), '[]'::jsonb)
                 from public.fantasy_games(v_season)),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'logo_url', t.logo_url,
                       'color', t.primary_color, 'slug', t.slug) order by t.name), '[]'::jsonb)
              from teams t where t.status = 'active' and not coalesce(t.is_test, false)),
    'pool', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'first_name', first_name, 'last_name', last_name,
                       'number', jersey_number, 'gk', position = 'Goalkeeper', 'team_id', team_id, 'slug', slug,
                       'price', price, 'total', total, 'gp', gp, 'goals', goals, 'last', last_pts, 'picked', picked)
                       order by total desc, price desc), '[]'::jsonb) from pool),
    'my_player_id', case when v_uid is null then null else public.my_player_id() end,
    'me', case when v_entry.id is null then null else jsonb_build_object(
        'entry_id', v_entry.id,
        'name', v_entry.name,
        'lineup_round', public.fantasy_effective_round(v_entry.id, coalesce(v_open, '9999-12-31'::date)),
        'lineup', (select coalesce(jsonb_agg(jsonb_build_object('player_id', l.player_id, 'slot', l.slot, 'captain', l.is_captain)), '[]'::jsonb)
                   from fantasy_lineup_players l
                   where l.entry_id = v_entry.id
                     and l.round_date = public.fantasy_effective_round(v_entry.id, coalesce(v_open, '9999-12-31'::date))),
        -- The squad the next round's transfers are counted against.
        'base_squad', (select coalesce(jsonb_agg(l.player_id), '[]'::jsonb) from fantasy_lineup_players l
                       where l.entry_id = v_entry.id
                         and l.round_date = (select max(round_date) from fantasy_lineups
                                             where entry_id = v_entry.id and round_date < coalesce(v_open, '9999-12-31'::date))),
        'rounds', (select coalesce(jsonb_agg(jsonb_build_object('date', round_date, 'points', points) order by round_date), '[]'::jsonb)
                   from public.fantasy_scores(v_season, v_entry.id)),
        'leagues', (select coalesce(jsonb_agg(jsonb_build_object('id', fl.id, 'name', fl.name, 'code', fl.code,
                          'owner', fl.owner_entry_id = v_entry.id,
                          'members', (select count(*) from fantasy_league_members m2 where m2.league_id = fl.id))
                          order by fl.created_at), '[]'::jsonb)
                    from fantasy_leagues fl join fantasy_league_members m on m.league_id = fl.id
                    where m.entry_id = v_entry.id)
      ) end
  ) into v_res;
  return v_res;
end $$;

-- Overall or private-league table. Public (it is a league table).
create or replace function public.fantasy_leaderboard(p_league uuid default null, p_limit int default 100)
returns table (rank int, entry_id uuid, name text, manager text, total int, last_round int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with s as (select public.fantasy_season() id),
  lr as (select max(round_date) d from public.fantasy_rounds((select id from s)) where lock_at <= now() and completed > 0),
  sc as (select * from public.fantasy_scores((select id from s))),
  e as (
    select e.id, e.name, e.user_id from fantasy_entries e
    where e.season_id = (select id from s)
      and (p_league is null or exists (select 1 from fantasy_league_members m where m.league_id = p_league and m.entry_id = e.id))
  ),
  t as (
    select e.id, e.name, e.user_id,
           coalesce((select sum(points) from sc where sc.entry_id = e.id), 0)::int total,
           coalesce((select points from sc where sc.entry_id = e.id and sc.round_date = (select d from lr)), 0)::int last_round
    from e
  )
  select (rank() over (order by total desc))::int, t.id, t.name,
         coalesce(nullif(btrim(pr.display_name), ''), 'מנהל'), t.total, t.last_round,
         t.user_id = auth.uid()
  from t left join profiles pr on pr.id = t.user_id
  order by total desc, t.name
  limit greatest(1, least(p_limit, 500))
$$;

-- One manager's lineup for a round. Others' lineups only once the round locked.
create or replace function public.fantasy_entry_round(p_entry uuid, p_round date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_e fantasy_entries; v_lock timestamptz;
begin
  select * into v_e from fantasy_entries where id = p_entry;
  if v_e.id is null then return null; end if;
  select lock_at into v_lock from public.fantasy_rounds(v_e.season_id) where round_date = p_round;
  if v_lock is null then return null; end if;
  if v_e.user_id is distinct from auth.uid() and v_lock > now() then
    raise exception 'locked' using hint = 'הרכב של מנהל אחר נחשף רק כשהמחזור ננעל';
  end if;
  return jsonb_build_object(
    'entry_id', v_e.id, 'name', v_e.name, 'round_date', p_round,
    'manager', (select display_name from profiles where id = v_e.user_id),
    'transfers', public.fantasy_round_transfers(p_entry, p_round),
    'score', public.fantasy_round_score(p_entry, p_round),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('player_id', d.player_id, 'slot', d.slot,
                  'captain', d.is_captain, 'played', d.played, 'base', d.base_points, 'counted', d.counted,
                  'points', d.points)), '[]'::jsonb) from public.fantasy_round_detail(p_entry, p_round) d)
  );
end $$;

create or replace function public.fantasy_league_by_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'name', l.name, 'code', l.code,
           'members', (select count(*) from fantasy_league_members m where m.league_id = l.id),
           'owner', (select e.name from fantasy_entries e where e.id = l.owner_entry_id))
  from fantasy_leagues l
  where l.code = upper(btrim(p_code)) and l.season_id = public.fantasy_season()
$$;

-- ---------------------------------------------------------------- write RPCs

create or replace function public.fantasy_save_lineup(p_name text, p_lineup jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_season uuid := public.fantasy_season();
  v_open date;
  v_entry uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_bad text;
  v_cost numeric;
  v_me uuid := public.my_player_id();
begin
  if v_uid is null then raise exception 'צריך להתחבר כדי לשחק'; end if;
  if not public.fantasy_enabled() then raise exception 'ליגת הפנטזי עוד לא נפתחה'; end if;
  if v_season is null then raise exception 'אין עונה פעילה'; end if;
  v_open := public.fantasy_open_round(v_season);
  if v_open is null then raise exception 'אין עוד מחזורים פתוחים העונה'; end if;
  if char_length(v_name) not between 2 and 24 then raise exception 'שם הקבוצה צריך 2–24 תווים'; end if;
  if jsonb_typeof(p_lineup) <> 'array' or jsonb_array_length(p_lineup) <> 7 then
    raise exception 'צריך בדיוק 7 שחקנים';
  end if;

  drop table if exists _fl;
  create temp table _fl on commit drop as
    select (x->>'player_id')::uuid player_id, x->>'slot' slot, coalesce((x->>'captain')::boolean, false) captain
    from jsonb_array_elements(p_lineup) x;

  if (select count(distinct player_id) from _fl) <> 7 then raise exception 'אותו שחקן נבחר פעמיים'; end if;
  if (select count(*) from _fl where slot = 'gk') <> 1 or (select count(*) from _fl where slot = 'f') <> 4
     or (select count(*) from _fl where slot = 'bgk') <> 1 or (select count(*) from _fl where slot = 'bf') <> 1 then
    raise exception 'הרכב: שוער + 4 שחקני שדה בפתיחה, שוער ושחקן שדה על הספסל';
  end if;
  if (select count(*) from _fl where captain) <> 1 or exists (select 1 from _fl where captain and slot not in ('gk','f')) then
    raise exception 'בחרו קפטן אחד מתוך החמישייה הפותחת';
  end if;

  select string_agg(coalesce(p.first_name || ' ' || p.last_name, '?'), ', ') into v_bad
  from _fl f left join players p on p.id = f.player_id
  left join teams t on t.id = p.team_id
  where p.id is null or t.id is null or t.status <> 'active' or coalesce(t.is_test, false)
     or (f.slot in ('gk','bgk')) <> (p.position = 'Goalkeeper');
  if v_bad is not null then raise exception 'שחקן לא מתאים לעמדה או לא בליגה: %', v_bad; end if;

  if v_me is not null and exists (select 1 from _fl where player_id = v_me) then
    raise exception 'אי אפשר לבחור את עצמך';
  end if;

  select string_agg(t.name, ', ') into v_bad from (
    select p.team_id from _fl f join players p on p.id = f.player_id group by p.team_id having count(*) > 2
  ) x join teams t on t.id = x.team_id;
  if v_bad is not null then raise exception 'עד 2 שחקנים מאותה קבוצה (%)', v_bad; end if;

  select sum(coalesce(fp.price, 5.0)) into v_cost
  from _fl f left join fantasy_prices fp on fp.season_id = v_season and fp.player_id = f.player_id;
  if v_cost > 50 then raise exception 'חריגה מהתקציב: % מתוך 50', v_cost; end if;

  insert into fantasy_entries (season_id, user_id, name) values (v_season, v_uid, v_name)
  on conflict (season_id, user_id) do update set name = excluded.name
  returning id into v_entry;

  insert into fantasy_lineups (entry_id, round_date, saved_at) values (v_entry, v_open, now())
  on conflict (entry_id, round_date) do update set saved_at = now();
  delete from fantasy_lineup_players where entry_id = v_entry and round_date = v_open;
  insert into fantasy_lineup_players (entry_id, round_date, player_id, slot, is_captain)
  select v_entry, v_open, player_id, slot, captain from _fl;

  return jsonb_build_object('entry_id', v_entry, 'round_date', v_open, 'cost', v_cost,
                            'transfers', public.fantasy_round_transfers(v_entry, v_open));
end $$;

create or replace function public.fantasy_create_league(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_code text; v_id uuid; v_name text := btrim(coalesce(p_name, ''));
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select id into v_entry from fantasy_entries where season_id = public.fantasy_season() and user_id = auth.uid();
  if v_entry is null then raise exception 'קודם בונים קבוצה, אחר כך פותחים ליגה'; end if;
  if char_length(v_name) not between 2 and 32 then raise exception 'שם הליגה צריך 2–32 תווים'; end if;
  if (select count(*) from fantasy_leagues where owner_entry_id = v_entry) >= 10 then
    raise exception 'אפשר לפתוח עד 10 ליגות';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists (select 1 from fantasy_leagues where code = v_code);
  end loop;
  insert into fantasy_leagues (season_id, name, code, owner_entry_id)
  values (public.fantasy_season(), v_name, v_code, v_entry) returning id into v_id;
  insert into fantasy_league_members (league_id, entry_id) values (v_id, v_entry);
  return jsonb_build_object('id', v_id, 'code', v_code, 'name', v_name);
end $$;

create or replace function public.fantasy_join_league(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry uuid; v_l fantasy_leagues;
begin
  select id into v_entry from fantasy_entries where season_id = public.fantasy_season() and user_id = auth.uid();
  if v_entry is null then raise exception 'קודם בונים קבוצה, אחר כך מצטרפים לליגה'; end if;
  select * into v_l from fantasy_leagues where code = upper(btrim(p_code)) and season_id = public.fantasy_season();
  if v_l.id is null then raise exception 'לא מצאנו ליגה עם הקוד הזה'; end if;
  if (select count(*) from fantasy_league_members where league_id = v_l.id) >= 200 then raise exception 'הליגה מלאה'; end if;
  insert into fantasy_league_members (league_id, entry_id) values (v_l.id, v_entry) on conflict do nothing;
  return jsonb_build_object('id', v_l.id, 'name', v_l.name, 'code', v_l.code);
end $$;

create or replace function public.fantasy_leave_league(p_league uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  select id into v_entry from fantasy_entries where season_id = public.fantasy_season() and user_id = auth.uid();
  if exists (select 1 from fantasy_leagues where id = p_league and owner_entry_id = v_entry) then
    raise exception 'מי שפתח את הליגה לא יכול לעזוב אותה';
  end if;
  delete from fantasy_league_members where league_id = p_league and entry_id = v_entry;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.fantasy_reprice(uuid) from public, anon;
grant execute on function public.fantasy_reprice(uuid) to authenticated;

revoke all on function public.fantasy_save_lineup(text, jsonb) from public, anon;
revoke all on function public.fantasy_create_league(text) from public, anon;
revoke all on function public.fantasy_join_league(text) from public, anon;
revoke all on function public.fantasy_leave_league(uuid) from public, anon;
grant execute on function public.fantasy_save_lineup(text, jsonb) to authenticated;
grant execute on function public.fantasy_create_league(text) to authenticated;
grant execute on function public.fantasy_join_league(text) to authenticated;
grant execute on function public.fantasy_leave_league(uuid) to authenticated;

grant execute on function public.fantasy_state() to anon, authenticated;
grant execute on function public.fantasy_leaderboard(uuid, int) to anon, authenticated;
grant execute on function public.fantasy_entry_round(uuid, date) to anon, authenticated;
grant execute on function public.fantasy_league_by_code(text) to anon, authenticated;

-- Internals: not callable from the API (they take an entry id and would leak
-- a lineup before lock).
revoke all on function public.fantasy_round_detail(uuid, date) from public, anon, authenticated;
revoke all on function public.fantasy_round_transfers(uuid, date) from public, anon, authenticated;
revoke all on function public.fantasy_round_score(uuid, date) from public, anon, authenticated;
revoke all on function public.fantasy_scores(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fantasy_effective_round(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------- seed

insert into public.league_settings (key, value, updated_at)
values ('feature_fantasy', 'off', now())
on conflict (key) do nothing;

select public.fantasy_reprice(public.fantasy_season());
