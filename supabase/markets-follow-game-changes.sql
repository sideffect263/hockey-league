-- סטופר מרקט follows its game — 2026-10-29 (Ariel: "fix the markets, move the predictions
-- with the markets as the dates change"). Applied 2026-10-29 (team-replaced = reset in place; a game market cannot leave its game).
--
-- Already true before this file: a game's DATE change moves its market's closes_at, and
-- the predictions stay on it (market_games_after_update_body). What was missing:
--
-- 1. The TEAMS of a game change. 7.11 16:30 was בלג אריות–גבעת עדה נוער; the game row was
--    edited to קריית ביאליק–גבעת עדה נוער and its market (with 2 predictions, one of them
--    1,000 סטופרים on בלג אריות) stayed on it, still titled for the old pairing.
--    Now: same two teams, home/away swapped → the outcomes follow their team (every
--    prediction stays on the team it was made for). A team replaced → the market is reset in place
--    (everyone gets back exactly what they put in, each gets a bell row saying why, and
--    the market starts over at even odds for the new pairing).
-- 2. A team is RENAMED (בלג בוגרים → בלג אריות): outcome labels and game-market titles kept
--    the old name. Now they follow teams.name.
-- 3. One-time data fix for both, below.

-- ---------------------------------------------------------------------------------------
-- Titles / labels from the current team names.
create or replace function public.market_refresh_game_labels(p_market uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_home text; v_away text;
begin
  select ga.* into g from markets m join games ga on ga.id = m.game_id where m.id = p_market;
  if g.id is null then return; end if;
  select name into v_home from teams where id = g.home_team_id;
  select name into v_away from teams where id = g.away_team_id;
  update markets set title = coalesce(v_home, 'בית') || ' נגד ' || coalesce(v_away, 'חוץ') where id = p_market;
  update market_outcomes o set label = t.name
    from teams t where o.market_id = p_market and o.team_id = t.id and o.label is distinct from t.name;
end $$;
revoke all on function public.market_refresh_game_labels(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- A game's teams changed: swap → follow; replaced → refund + reset in place.
create or replace function public.market_follow_team_change(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g games; v_market uuid; v_status text; v_title text; v_teams uuid[];
begin
  select * into g from games where id = p_game;
  select id, status, title into v_market, v_status, v_title from markets where game_id = p_game;
  if v_market is null or v_status not in ('open', 'closed') then return; end if;

  select array_agg(team_id order by team_id) into v_teams
    from market_outcomes where market_id = v_market and team_id is not null;

  if v_teams = (select array_agg(x order by x) from unnest(array[g.home_team_id, g.away_team_id]) x) then
    -- Same two teams, home/away swapped: each prediction stays on its team; only the
    -- home/away keys (which settlement reads) move with them.
    update market_outcomes set okey = case
        when team_id = g.home_team_id then 'home'
        when team_id = g.away_team_id then 'away'
        else okey end
      where market_id = v_market and team_id is not null;
    -- (market_id, ord) is unique and not deferrable: park the rows first, then settle.
    update market_outcomes set ord = ord + 100 where market_id = v_market;
    update market_outcomes set ord = case okey when 'home' then 0 when 'draw' then 1 else 2 end
      where market_id = v_market;
    perform market_refresh_game_labels(v_market);
    return;
  end if;

  -- A team was replaced: the predictions were about a game that no longer exists.
  -- A game market keeps its game_id (markets_game_id_matches_kind, unique), so the market
  -- is reset in place: everyone gets back exactly what they put in, with a bell row
  -- saying why, and the market starts over for the new pairing.
  insert into notifications (user_id, type, entity_type, entity_id, data)
  select pos.user_id, 'market_coins', 'market', v_market::text,
         jsonb_build_object('delta', round(sum(pos.cost_basis)),
                            'reason', 'המשחק ' || coalesce(v_title, '') || ' השתנה — הסטופרים שחזית הוחזרו')
    from market_positions pos join market_outcomes o on o.id = pos.outcome_id
   where o.market_id = v_market and pos.cost_basis > 0
   group by pos.user_id;

  update market_wallets w set balance = w.balance + agg.refund
    from (select pos.user_id, sum(pos.cost_basis) as refund
            from market_positions pos join market_outcomes o on o.id = pos.outcome_id
           where o.market_id = v_market group by pos.user_id) agg
   where agg.user_id = w.user_id;

  delete from market_positions pos using market_outcomes o
   where o.id = pos.outcome_id and o.market_id = v_market;
  delete from market_trades where market_id = v_market;

  -- (market_id, ord) is unique and not deferrable: park the rows first, then settle.
  update market_outcomes set q = 0, ord = ord + 100 where market_id = v_market;
  update market_outcomes set team_id = g.home_team_id, ord = 0 where market_id = v_market and okey = 'home';
  update market_outcomes set ord = 1 where market_id = v_market and okey = 'draw';
  update market_outcomes set team_id = g.away_team_id, ord = 2 where market_id = v_market and okey = 'away';
  update markets set status = 'open' where id = v_market and status = 'closed' and closes_at > now();
  perform market_refresh_game_labels(v_market);
end $$;
revoke all on function public.market_follow_team_change(uuid) from public, anon, authenticated;

create or replace function public.market_games_team_change_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_team_id is distinct from old.home_team_id or new.away_team_id is distinct from old.away_team_id then
    begin
      perform public.market_follow_team_change(new.id);
    exception when others then
      raise warning 'market_follow_team_change failed for game %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function public.market_games_team_change_trg() from public, anon, authenticated;

drop trigger if exists trg_market_games_team_change on public.games;
create trigger trg_market_games_team_change
  after update of home_team_id, away_team_id on public.games
  for each row execute function public.market_games_team_change_trg();

-- ---------------------------------------------------------------------------------------
-- A team renamed: its labels and its games' market titles follow.
create or replace function public.market_teams_rename_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.name is distinct from old.name then
    update market_outcomes set label = new.name where team_id = new.id and label is distinct from new.name;
    for m in select mk.id from markets mk join games g on g.id = mk.game_id
              where g.home_team_id = new.id or g.away_team_id = new.id loop
      perform public.market_refresh_game_labels(m.id);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'market_teams_rename failed for team %: %', new.id, sqlerrm;
  return null;
end $$;
revoke all on function public.market_teams_rename_trg() from public, anon, authenticated;

drop trigger if exists trg_market_teams_rename on public.teams;
create trigger trg_market_teams_rename
  after update of name on public.teams
  for each row execute function public.market_teams_rename_trg();

-- ---------------------------------------------------------------------------------------
-- One-time fix (2026-10-29).
-- (a) FIRST, while its title still names the old pairing (the refund notice quotes it).
-- 7.11 16:30: the market for בלג אריות–גבעת עדה נוער sits on a game that is now
--     קריית ביאליק–גבעת עדה נוער → refund both predictions, reset the market.
update markets set title = 'בלג אריות נגד גבעת עדה נוער' where id = '5120f9a9-bf57-4a1a-8968-fb69cf2be148';
select public.market_follow_team_change('530cbbed-1fa0-4960-b5f2-301001cc72c7');


-- (b) every game market's title + team labels from the current names (בלג בוגרים → בלג אריות)
do $$ declare m record; begin
  for m in select id from markets where game_id is not null loop
    perform public.market_refresh_game_labels(m.id);
  end loop;
end $$;
update market_outcomes o set label = t.name from teams t
 where o.team_id = t.id and o.label is distinct from t.name;

notify pgrst, 'reload schema';
