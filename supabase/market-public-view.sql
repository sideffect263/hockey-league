-- סטופר מרקט: view-only for everyone (2026-10-27).
--
-- The market used to be invisible unless you were a linked league player aged 18+.
-- Now anybody, signed out included, can look: the board, each market's odds and
-- price history, the game-page card and the feed cards. Predicting is unchanged:
-- market_buy / market_sell / market_quote / market_wallet still go through
-- market_block_reason (signed-out / no-player / no-dob / under-18), plus the
-- own-team and referee conflicts.
--
-- What stays private:
--   * who traded: market_trades keeps its signed-in-only policy, and the two new
--     public reads below return prices, counts and times, never a user id;
--   * positions and wallets (own or admin, as before);
--   * names on the leaderboard: market_leaderboard stays signed-in only, and the
--     feed's podium card (names + avatars) is left out for signed-out viewers.
-- Test-game markets stay hidden by the restrictive "hide test games" policy and by
-- explicit is_test filters in the definer functions.
--
-- Down: market-public-view-down.sql

-- ── Board reads ───────────────────────────────────────────────────────────────
create policy "markets: public read" on public.markets
  for select to anon using (true);

create policy "outcomes: public read" on public.market_outcomes
  for select to anon using (true);

-- ── Activity per market, without traders' identities ─────────────────────────
-- Same numbers the board computed client-side from the whole tape
-- (src/lib/market.js getActivity), so a signed-out board ranks and labels markets
-- the same way.
create or replace function public.market_public_activity()
returns table(market_id uuid, trades int, volume numeric, traders int, last timestamptz)
language sql stable security definer set search_path = public as $$
  select t.market_id,
         count(*)::int,
         coalesce(sum(t.coins), 0),
         count(distinct t.user_id)::int,
         max(t.created_at)
    from market_trades t
    join markets m on m.id = t.market_id
    left join games g on g.id = m.game_id
   where not coalesce(g.is_test, false) or coalesce(public.is_admin(), false)
   group by t.market_id;
$$;

-- ── One market's price history, without traders' identities ──────────────────
create or replace function public.market_public_history(p_market uuid, p_limit int default 200)
returns table(created_at timestamptz, outcome_id uuid, side text, prices jsonb)
language sql stable security definer set search_path = public as $$
  select x.created_at, x.outcome_id, x.side, x.prices
    from (
      select t.created_at, t.outcome_id, t.side, t.prices
        from market_trades t
        join markets m on m.id = t.market_id
        left join games g on g.id = m.game_id
       where t.market_id = p_market
         and (not coalesce(g.is_test, false) or coalesce(public.is_admin(), false))
       order by t.created_at desc
       limit least(greatest(coalesce(p_limit, 200), 1), 500)
    ) x
   order by x.created_at desc;
$$;

revoke all on function public.market_public_activity() from public;
revoke all on function public.market_public_history(uuid, int) from public;
grant execute on function public.market_public_activity() to anon, authenticated;
grant execute on function public.market_public_history(uuid, int) to anon, authenticated;

-- ── Game-page card: odds for everyone; "my" and "block" only mean something signed in ──
create or replace function public.market_game_odds(p_game uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_m     public.markets%rowtype;
  v_test  boolean;
  v_n     int;
  v_ids   jsonb;
  v_out   jsonb;
  v_hist  jsonb;
  v_my    jsonb;
  v_block text;
begin
  select coalesce(g.is_test, false) into v_test from public.games g where g.id = p_game;
  if v_test is null then return null; end if;
  if v_test and not coalesce(public.is_admin(), false) then return null; end if;

  select * into v_m from public.markets m
   where m.game_id = p_game and m.kind = 'game'
   order by (m.status <> 'void'), m.created_at desc
   limit 1;
  if v_m.id is null then return null; end if;

  select count(*) into v_n from public.market_outcomes o where o.market_id = v_m.id;
  select jsonb_object_agg(o.okey, o.id::text) into v_ids
    from public.market_outcomes o where o.market_id = v_m.id and o.okey is not null;

  select jsonb_agg(jsonb_build_object(
           'id', p.outcome_id, 'okey', p.okey, 'label', p.label, 'team_id', p.team_id,
           'price', round(p.price, 4),
           'was', round(coalesce(
                    ((select t.prices from public.market_trades t
                       where t.market_id = v_m.id and t.created_at < now() - interval '48 hours'
                       order by t.created_at desc limit 1) ->> p.outcome_id::text)::numeric,
                    1.0 / nullif(v_n, 0)), 4))
           order by p.ord)
    into v_out
    from public._market_outcome_prices() p
   where p.market_id = v_m.id;

  select jsonb_agg(h.pt order by h.t) into v_hist
    from (
      select v_m.created_at as t,
             jsonb_build_object('t', v_m.created_at,
               'home', round(1.0 / nullif(v_n, 0), 4),
               'draw', case when v_ids ? 'draw' then round(1.0 / nullif(v_n, 0), 4) end,
               'away', round(1.0 / nullif(v_n, 0), 4)) as pt
      union all
      select x.created_at,
             jsonb_build_object('t', x.created_at,
               'home', round((x.prices ->> (v_ids ->> 'home'))::numeric, 4),
               'draw', round((x.prices ->> (v_ids ->> 'draw'))::numeric, 4),
               'away', round((x.prices ->> (v_ids ->> 'away'))::numeric, 4))
        from (select t.created_at, t.prices from public.market_trades t
               where t.market_id = v_m.id order by t.created_at desc limit 60) x
    ) h;

  if v_uid is not null then
    select jsonb_agg(jsonb_build_object('okey', o.okey, 'shares', round(mp.shares, 2),
                                        'cost', round(mp.cost_basis, 2)) order by o.ord)
      into v_my
      from public.market_positions mp
      join public.market_outcomes o on o.id = mp.outcome_id
     where mp.user_id = v_uid and o.market_id = v_m.id and mp.shares > 0;
  end if;

  v_block := case
    when v_uid is null then 'signed-out'
    when public.market_conflicted(v_uid, v_m.id) then 'conflict'
    else public.market_block_reason(v_uid)
  end;

  return jsonb_build_object(
    'market_id', v_m.id,
    'slug', v_m.slug,
    'status', case
                when v_m.status = 'open' and v_m.closes_at is not null and v_m.closes_at <= now() then 'closed'
                else v_m.status
              end,
    'closes_at', v_m.closes_at,
    'traders', (select count(distinct t.user_id) from public.market_trades t where t.market_id = v_m.id),
    'trades',  (select count(*) from public.market_trades t where t.market_id = v_m.id),
    'volume',  (select round(coalesce(sum(t.coins), 0)) from public.market_trades t
                 where t.market_id = v_m.id and t.side = 'buy'),
    'outcomes', coalesce(v_out, '[]'::jsonb),
    'history', coalesce(v_hist, '[]'::jsonb),
    'resolved_okey', (select o.okey from public.market_outcomes o where o.id = v_m.resolved_outcome_id),
    'called', case when v_m.resolved_outcome_id is not null then
                (select count(distinct t.user_id) from public.market_trades t
                  where t.market_id = v_m.id and t.outcome_id = v_m.resolved_outcome_id and t.side = 'buy')
              end,
    'my', coalesce(v_my, '[]'::jsonb),
    'block', v_block
  );
end
$function$;

-- ── Feed cards for everyone; the podium (names) only for signed-in viewers ────
create or replace function public.market_feed()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_next  date;
  v_first timestamptz;
  v_item  jsonb;
  v_sun   timestamptz;
begin
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

  -- Names and avatars: signed-in viewers only.
  if v_uid is not null then
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
  end if;

  return v_items;
end $function$;

grant execute on function public.market_feed() to anon;

-- Tidy: an admin RPC had EXECUTE for anon. Its body calls market_admin_guard(),
-- which already refuses anyone who isn't an admin; this just removes the surface.
revoke execute on function public.market_admin_set_closes(uuid, timestamptz) from anon;
