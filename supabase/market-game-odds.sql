-- הוקי מרקט on the game page: one game's market, for the game page card (web, iOS, Android).
--
-- Returns NULL unless the viewer is market_eligible (linked player card, DOB, 18+) — the
-- same server-side gate as market_feed(). The market tables are readable by any signed-in
-- user under RLS, so the gate MUST live here, not in the clients: if this returns a row,
-- the server already said yes, and no client decides who sees odds.
--
-- Shape (jsonb):
--   market_id, slug, status ('open' | 'closed' | 'resolved' | 'void'), closes_at,
--   traders (distinct users), trades, volume (coins staked on buys),
--   outcomes: [{ id, okey, label, team_id, price, was }]   -- was = 48 h ago (or the opening 1/n)
--   history:  [{ t, home, draw, away }]                     -- opening point + every trade, oldest first (max 60)
--   resolved_okey, called (users who bought the winner),
--   my:       [{ okey, shares, cost }]                      -- the viewer's open position
--   block:    null | 'conflict' | market_block_reason()     -- why the viewer can't trade it
--
-- 'closed' is derived: a game market's closes_at IS games.game_date and the flip to closed
-- happens lazily on the next trade attempt, so status can still read 'open' after kickoff.

create or replace function public.market_game_odds(p_game uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_m     public.markets%rowtype;
  v_test  boolean;
  v_n     int;
  v_ids   jsonb;      -- okey -> outcome id text
  v_out   jsonb;
  v_hist  jsonb;
  v_my    jsonb;
  v_block text;
begin
  if v_uid is null or not coalesce(public.market_eligible(v_uid), false) then
    return null;
  end if;

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

  -- Current price + the price 48 h ago (last trade before then, else the opening 1/n).
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

  -- Opening point, then each trade's post-trade snapshot (the last 60).
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

  select jsonb_agg(jsonb_build_object('okey', o.okey, 'shares', round(mp.shares, 2),
                                      'cost', round(mp.cost_basis, 2)) order by o.ord)
    into v_my
    from public.market_positions mp
    join public.market_outcomes o on o.id = mp.outcome_id
   where mp.user_id = v_uid and o.market_id = v_m.id and mp.shares > 0;

  v_block := case
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

-- Default PUBLIC execute is fine here (the body gates on auth.uid()), but be explicit.
revoke all on function public.market_game_odds(uuid) from public;
grant execute on function public.market_game_odds(uuid) to anon, authenticated;
