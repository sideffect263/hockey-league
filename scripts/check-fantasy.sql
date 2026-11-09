-- Fantasy scoring self-check. Writes 40 random squads over the rounds already
-- played, then asserts the set-based table (fantasy_scores) agrees with the
-- per-entry path (fantasy_round_score) for every entry × round, and prints a
-- small balance summary. ALWAYS rolls back: it ends by raising an exception
-- whose message is the report. Run:
--   curl …/database/query with {"query": <this file>}
do $$
declare
  v_season uuid := public.fantasy_season();
  v_users uuid[];
  v_entry uuid;
  v_round date;
  v_rounds date[];
  i int; k int;
  v_bad int; v_rep text;
begin
  select array_agg(id) into v_users from (select id from auth.users order by created_at limit 40) u;
  select array_agg(round_date order by round_date) into v_rounds
    from public.fantasy_rounds(v_season) where lock_at <= now();

  for i in 1..coalesce(array_length(v_users,1),0) loop
    insert into fantasy_entries (season_id, user_id, name)
    values (v_season, v_users[i], 'בדיקה ' || i)
    on conflict (season_id, user_id) do update set name = excluded.name
    returning id into v_entry;
    -- a fresh random squad for round 1, and a partly changed one for each later round
    for k in 1..array_length(v_rounds,1) loop
      continue when k > 1 and random() < 0.5;
      v_round := v_rounds[k];
      insert into fantasy_lineups (entry_id, round_date) values (v_entry, v_round) on conflict do nothing;
      delete from fantasy_lineup_players where entry_id = v_entry and round_date = v_round;
      -- random 2 GK + 5 field
      insert into fantasy_lineup_players (entry_id, round_date, player_id, slot, is_captain)
      select v_entry, v_round, id,
             case when gk then (case when rn = 1 then 'gk' else 'bgk' end)
                  else (case when rn <= 4 then 'f' else 'bf' end) end,
             (not gk and rn = 1)
      from (
        select p.id, p.position = 'Goalkeeper' gk,
               row_number() over (partition by p.position = 'Goalkeeper' order by random()) rn
        from players p join fantasy_prices fp on fp.player_id = p.id and fp.season_id = v_season
      ) z
      where (gk and rn <= 2) or (not gk and rn <= 5);
    end loop;
  end loop;

  select count(*) into v_bad
  from public.fantasy_scores(v_season) s
  where s.points <> public.fantasy_round_score(s.entry_id, s.round_date);

  select format('mismatches=%s | entries=%s | rows=%s | avg/round=%s | min=%s | max=%s | penalised rows=%s',
                v_bad, count(distinct entry_id), count(*), round(avg(points),1), min(points), max(points),
                (select count(*) from fantasy_lineups l where public.fantasy_round_transfers(l.entry_id, l.round_date) > 1))
    into v_rep
  from public.fantasy_scores(v_season);

  raise exception 'CHECK-FANTASY %', v_rep;
end $$;
