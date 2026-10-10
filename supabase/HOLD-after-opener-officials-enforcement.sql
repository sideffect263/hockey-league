-- ============================================================================================
-- HOLD — DO NOT APPLY BEFORE THE 2026-10-10 SEASON OPENER IS OVER (Ariel, 2026-10-09).
-- 2026-10-11: parts B and C APPLIED via supabase/opener-followups.sql (B with a re-save fix).
--             Part A (judge assignment enforcement) still NOT applied — awaiting Ariel.
-- Written + dry-run tested in a rolled-back transaction on 2026-10-09. Apply as one migration.
-- Three behaviour changes:
--   A) A plain judge may only act on games he is ASSIGNED to (approved/assigned game_officials
--      row). League managers keep acting on every game — managing fixtures is their job, and
--      until now they could only edit league games BECAUSE they also hold the judge role.
--   B) Red card ↔ suspension: a red card recorded through ANY path issues a 1-game suspension;
--      removing it cancels that suspension while it is still unserved.
--   C) A market closed by a status flip re-opens when the game goes back to 'scheduled'.
-- ============================================================================================

-- ---------- A) assignment enforcement ----------------------------------------------------------
-- "May officiate THIS game": a league manager (any game), or a judge assigned to it. Admin
-- access is unchanged — every function below keeps its own is_admin() clause; only the generic
-- is_judge() ("any judge, any game") becomes can_officiate_game(p_game_id).
create or replace function public.can_officiate_game(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_league_manager(), false)
      or (coalesce(public.is_judge(), false) and exists (
            select 1 from public.game_officials
             where game_id = p_game_id and user_id = (select auth.uid())
               and role = 'judge' and status in ('approved','assigned')))
$$;
grant execute on function public.can_officiate_game(uuid) to authenticated;

-- Rewrite the 7 per-game functions from their LIVE definitions so nothing else in them changes.
do $$
declare r record; v_def text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('broadcast_game_state','judge_save_game_result','save_game_stats',
                                'set_game_mvp','set_game_status','add_player_to_squad','remove_player_from_squad')
  loop
    v_def := pg_get_functiondef(r.oid);
    if regexp_count(v_def, 'public\.is_judge\(\)') <> 1 then
      raise exception '% has % is_judge() calls — expected exactly 1; re-check before applying',
        r.proname, regexp_count(v_def, 'public\.is_judge\(\)');
    end if;
    execute replace(v_def, 'public.is_judge()', 'public.can_officiate_game(p_game_id)');
  end loop;
end $$;

-- Direct table writes: a judge could UPDATE/DELETE ANY game row and ANY game's stats.
drop policy if exists "Judge update games" on public.games;
create policy "Judge update games" on public.games for update
  using (public.can_officiate_game(id)) with check (public.can_officiate_game(id));
drop policy if exists "Judge delete games" on public.games;
create policy "Judge delete games" on public.games for delete using (public.can_officiate_game(id));
drop policy if exists "Judge insert game_stats" on public.game_stats;
create policy "Judge insert game_stats" on public.game_stats for insert with check (public.can_officiate_game(game_id));
drop policy if exists "Judge update game_stats" on public.game_stats;
create policy "Judge update game_stats" on public.game_stats for update
  using (public.can_officiate_game(game_id)) with check (public.can_officiate_game(game_id));
drop policy if exists "Judge delete game_stats" on public.game_stats;
create policy "Judge delete game_stats" on public.game_stats for delete using (public.can_officiate_game(game_id));
-- ("Judge insert games" is left as is: creating a fixture is not acting on someone else's game.)

-- ---------- B) red card ↔ suspension ------------------------------------------------------------
-- apply_game_form_result has its own p_suspend_red switch; it sets app.no_auto_suspend so this
-- trigger stands down for its writes and the switch keeps meaning what it says.
create or replace function public.sync_red_card_suspension()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_player uuid; v_red int;
begin
  if coalesce(current_setting('app.no_auto_suspend', true), '') = 'on' then return null; end if;
  v_game   := coalesce(new.game_id, old.game_id);
  v_player := coalesce(new.player_id, old.player_id);
  if v_player is null then return null; end if;                 -- guest rows have no player
  if exists (select 1 from public.games where id = v_game and is_test) then return null; end if;

  select coalesce(sum(red_cards), 0) into v_red
    from public.game_stats where game_id = v_game and player_id = v_player;

  if v_red > 0 then
    insert into public.player_suspensions (player_id, issued_game_id, reason, games_remaining, created_by)
    select v_player, v_game, 'כרטיס אדום', 1, (select auth.uid())
     where not exists (select 1 from public.player_suspensions
                        where player_id = v_player and issued_game_id = v_game);
  else
    -- red card taken back: cancel the suspension it caused, if not served yet
    update public.player_suspensions
       set cleared_at = now()
     where player_id = v_player and issued_game_id = v_game
       and cleared_at is null and games_remaining > 0
       and reason like 'כרטיס אדום%';
  end if;
  return null;
end; $$;

drop trigger if exists trg_sync_red_card_suspension on public.game_stats;
create trigger trg_sync_red_card_suspension
  after insert or update of red_cards or delete on public.game_stats
  for each row execute function public.sync_red_card_suspension();

-- apply_game_form_result: keep its own p_suspend_red semantics (stand the trigger down).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_game_form_result';
  if position('delete from public.game_stats where game_id = p_game;' in v_def) = 0 then
    raise exception 'apply_game_form_result changed — re-check before applying';
  end if;
  v_def := replace(v_def, 'delete from public.game_stats where game_id = p_game;',
    E'perform set_config(''app.no_auto_suspend'', ''on'', true);\n  delete from public.game_stats where game_id = p_game;');
  v_def := replace(v_def, '  perform public.recompute_team_standings(g.home_team_id);',
    E'  perform set_config(''app.no_auto_suspend'', '''', true);\n  perform public.recompute_team_standings(g.home_team_id);');
  execute v_def;
end $$;

-- ---------- C) markets re-open on a status flip-back -------------------------------------------
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'market_games_after_update';
  if position('  elsif new.status <> ''scheduled'' and v_status = ''open'' then' in v_def) = 0 then
    raise exception 'market_games_after_update changed — re-check before applying';
  end if;
  v_def := replace(v_def, '  elsif new.status <> ''scheduled'' and v_status = ''open'' then',
E'  -- Put back to scheduled (opened by mistake, the Apple reviewer, a board peek): the market
  -- a status flip closed must re-open, or the fixture loses its betting window for good.
  elsif new.status = ''scheduled'' and old.status is distinct from ''scheduled''
        and v_status = ''closed'' and new.game_date > now() then
    update markets set status = ''open'' where id = v_market;

  elsif new.status <> ''scheduled'' and v_status = ''open'' then');
  execute v_def;
end $$;
