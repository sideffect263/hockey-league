-- הוקי מרקט cards in the feed (2026-10-10).
--
-- The feed builds its league cards (results, milestones…) client-side from data;
-- market cards follow the same pattern, but their data comes from ONE gated RPC
-- so the 18+ rule is enforced by the server, not by a component that can be
-- skipped: anyone who is not market_eligible() (signed in, linked player card,
-- birth date ≥ 18 years ago) gets an empty array and the feed simply has no
-- market cards for them.
--
-- Four kinds, each naturally capped so the feed is not flooded:
--   matchday — the next round's odds, from ~3 days before its first kickoff (1)
--   swing    — the biggest odds move of the last 48h, if ≥ 15 points (0–1)
--   results  — one card per settled matchday, last 7 days (0–1 a week)
--   podium   — weekly top 3, dated Sunday 10:00 (1 a week)
-- Every item's `date` is ≤ now() so it ranks among real posts, never above them
-- from the future.

-- Current LMSR price of every outcome (shifted exponent, as in lib/market.js).
-- Internal: no client grant; market_feed is the only reader.
create or replace function public._market_outcome_prices()
returns table (market_id uuid, outcome_id uuid, okey text, label text, team_id uuid,
               player_id uuid, ord int, price numeric)
language sql stable security definer set search_path to 'public' as $$
  select o.market_id, o.id, o.okey, o.label, o.team_id, o.player_id, o.ord,
         (o.e / sum(o.e) over (partition by o.market_id))::numeric
    from (
      select o.*, exp(o.q / m.b - max(o.q / m.b) over (partition by o.market_id)) as e
        from public.market_outcomes o join public.markets m on m.id = o.market_id
    ) o
$$;
revoke all on function public._market_outcome_prices() from public, anon, authenticated;

create or replace function public.market_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_next  date;
  v_first timestamptz;
  v_item  jsonb;
  v_sun   timestamptz;
begin
  if v_uid is null or not coalesce(public.market_eligible(v_uid), false) then
    return '[]'::jsonb;
  end if;

  -- ---- matchday ----------------------------------------------------------
  select min((g.game_date at time zone 'Asia/Jerusalem')::date)
    into v_next
    from public.markets m join public.games g on g.id = m.game_id
   where m.status = 'open' and g.status = 'scheduled' and g.game_date > now()
     and not coalesce(g.is_test, false);

  if v_next is not null then
    select min(g.game_date) into v_first
      from public.markets m join public.games g on g.id = m.game_id
     where m.status = 'open' and not coalesce(g.is_test, false)
       and (g.game_date at time zone 'Asia/Jerusalem')::date = v_next;

    if now() >= v_first - interval '3 days' then
      select jsonb_build_object(
               'kind', 'matchday',
               'key', 'matchday-' || v_next,
               'date', least(now(), greatest(v_first - interval '36 hours',
                         coalesce(max(x.last_trade), v_first - interval '36 hours'))),
               'matchday', v_next,
               'games', jsonb_agg(x.game order by x.game_date))
        into v_item
        from (
          select g.game_date,
                 (select max(created_at) from public.market_trades where market_id = m.id) as last_trade,
                 jsonb_build_object(
                   'market_id', m.id, 'slug', m.slug, 'game_date', g.game_date, 'venue', g.venue,
                   'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id,
                   'traders', (select count(distinct user_id) from public.market_trades where market_id = m.id),
                   'outcomes', (select jsonb_agg(jsonb_build_object('id', p.outcome_id, 'okey', p.okey,
                                  'label', p.label, 'team_id', p.team_id, 'price', round(p.price, 4)) order by p.ord)
                                  from public._market_outcome_prices() p where p.market_id = m.id)) as game
            from public.markets m join public.games g on g.id = m.game_id
           where m.status = 'open' and not coalesce(g.is_test, false)
             and (g.game_date at time zone 'Asia/Jerusalem')::date = v_next
        ) x;
      if v_item is not null then v_items := v_items || jsonb_build_array(v_item); end if;
    end if;
  end if;

  -- ---- swing: biggest move in an open market over the last 48h ------------
  with recent as (
    select m.id as market_id, m.slug, m.title, m.game_id,
           (select prices from public.market_trades t where t.market_id = m.id
             order by created_at desc limit 1) as now_px,
           (select prices from public.market_trades t where t.market_id = m.id
               and t.created_at < now() - interval '48 hours'
             order by created_at desc limit 1) as was_px,
           (select max(created_at) from public.market_trades t where t.market_id = m.id) as last_trade,
           (select count(*) from public.market_outcomes o where o.market_id = m.id) as n_out
      from public.markets m
      left join public.games g on g.id = m.game_id
     where m.status = 'open' and not coalesce(g.is_test, false)
       and exists (select 1 from public.market_trades t where t.market_id = m.id
                    and t.created_at >= now() - interval '48 hours')
  ),
  moves as (
    select r.*, p.outcome_id, p.label, p.team_id, p.okey,
           coalesce((r.was_px ->> p.outcome_id::text)::numeric, 1.0 / nullif(r.n_out, 0)) as from_p,
           (r.now_px ->> p.outcome_id::text)::numeric as to_p
      from recent r join public._market_outcome_prices() p on p.market_id = r.market_id
  )
  select jsonb_build_object(
           'kind', 'swing', 'key', 'swing-' || mv.market_id || '-' || to_char(mv.last_trade, 'YYYYMMDDHH24'),
           'date', mv.last_trade, 'market_id', mv.market_id, 'slug', mv.slug, 'title', mv.title,
           'game_id', mv.game_id,
           'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id, 'game_date', g.game_date,
           'outcome', jsonb_build_object('id', mv.outcome_id, 'label', mv.label, 'team_id', mv.team_id, 'okey', mv.okey),
           'from', round(mv.from_p, 4), 'to', round(mv.to_p, 4))
    into v_item
    from moves mv left join public.games g on g.id = mv.game_id
   where mv.to_p is not null and abs(mv.to_p - mv.from_p) >= 0.15
   order by abs(mv.to_p - mv.from_p) desc, mv.last_trade desc
   limit 1;
  if v_item is not null then v_items := v_items || jsonb_build_array(v_item); end if;

  -- ---- results: one card per settled matchday in the last 7 days ---------
  for v_item in
    select jsonb_build_object(
             'kind', 'results',
             'key', 'results-' || d.matchday,
             'date', d.last_resolved,
             'matchday', d.matchday,
             'games', d.games)
      from (
        select (g.game_date at time zone 'Asia/Jerusalem')::date as matchday,
               max(m.resolved_at) as last_resolved,
               jsonb_agg(jsonb_build_object(
                 'market_id', m.id, 'slug', m.slug, 'game_date', g.game_date,
                 'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id,
                 'home_score', g.home_score, 'away_score', g.away_score,
                 'winner', jsonb_build_object('label', w.label, 'okey', w.okey, 'team_id', w.team_id,
                                              'price', round(w.price, 4)),
                 'traders', (select count(distinct user_id) from public.market_trades t where t.market_id = m.id),
                 'called',  (select count(distinct user_id) from public.market_trades t
                              where t.market_id = m.id and t.outcome_id = m.resolved_outcome_id and t.side = 'buy'))
                 order by g.game_date) as games
          from public.markets m
          join public.games g on g.id = m.game_id
          join public._market_outcome_prices() w on w.outcome_id = m.resolved_outcome_id
         where m.status = 'resolved' and m.resolved_at >= now() - interval '7 days'
           and not coalesce(g.is_test, false)
         group by 1
      ) d
  loop
    v_items := v_items || jsonb_build_array(v_item);
  end loop;

  -- ---- podium: weekly top 3, dated the most recent Sunday 10:00 IL --------
  v_sun := ((date_trunc('week', (now() at time zone 'Asia/Jerusalem') + interval '1 day') - interval '1 day')
            + interval '10 hours') at time zone 'Asia/Jerusalem';
  if v_sun > now() then v_sun := v_sun - interval '7 days'; end if;

  select jsonb_build_object(
           'kind', 'podium', 'key', 'podium-' || to_char(v_sun at time zone 'Asia/Jerusalem', 'YYYY-MM-DD'),
           'date', v_sun,
           'top', jsonb_agg(jsonb_build_object('user_id', l.user_id, 'name', l.display_name,
                    'avatar_url', l.avatar_url, 'total', round(l.total::numeric)) order by l.total desc))
    into v_item
    from (select * from public.market_leaderboard() where trades > 0 order by total desc limit 3) l
  having count(*) = 3;
  if v_item is not null then v_items := v_items || jsonb_build_array(v_item); end if;

  return v_items;
end $$;

revoke all on function public.market_feed() from public, anon;
grant execute on function public.market_feed() to authenticated;
