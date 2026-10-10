-- Follow-ups from the 2026-10-10 season opener (applied live 2026-10-11, all tested in
-- rolled-back transactions against real game data).
--   1) Goal pushes: no alert from a board whose clock was never started (after-the-fact entry),
--      and bursts within 90s refresh one notification instead of pushing again.
--   2) Markets: a corrected result re-settles (old payout taken back, never below 0; new winners
--      paid); a completed game re-opened unsettles; a status flip back to scheduled re-opens a
--      closed market; and NO market error can block saving a game (sub-transaction + warning).
--   3) Red card ↔ suspension from every save path (HOLD file part B, plus: a judge re-save —
--      DELETE + INSERT of the box score — restores the suspension instead of wiping it).
-- Live migrations: goal_push_burst_and_pregame_guard, market_resettle_unsettle_reopen,
-- market_unsettle_clamp_and_never_block_games, red_card_suspension_sync.

-- ---------- 1) goal pushes --------------------------------------------------------------------
create or replace function public.notify_followers_on_goal()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  rec record; v_home text; v_away text; v_scorer text; v_side text; v_data jsonb; v_recent uuid;
begin
  if coalesce(new.home_score,0) > coalesce(old.home_score,0) then v_side := 'home';
  elsif coalesce(new.away_score,0) > coalesce(old.away_score,0) then v_side := 'away';
  else return null; end if;

  -- A board whose clock was never started ('ready' in the first period) is a judge typing the
  -- goals in after the game (2026-10-10: 13 goals in 90s → one follower got 12 pushes), or a
  -- pre-game test. Nobody is watching a live goal there: no alert.
  if new.phase = 'ready' and not coalesce(new.is_running, false)
     and coalesce(new.period, '1') in ('1', '') then
    return null;
  end if;

  select th.name, ta.name into v_home, v_away
  from public.games g
  left join public.teams th on th.id = g.home_team_id
  left join public.teams ta on ta.id = g.away_team_id
  where g.id = new.game_id;

  v_scorer := case when v_side = 'home' then v_home else v_away end;
  v_data := jsonb_build_object('home_team', coalesce(v_home,''), 'away_team', coalesce(v_away,''),
                               'home_score', new.home_score, 'away_score', new.away_score,
                               'scoring_team', coalesce(v_scorer,''));

  for rec in select user_id from public.game_followers(new.game_id) loop
    -- Burst: a goal alert for this game reached this follower in the last 90s → refresh that
    -- one to the new score instead of a new row (a new row = a new push).
    select id into v_recent from public.notifications
     where user_id = rec.user_id and type = 'goal_scored' and entity_id = new.game_id::text
       and created_at > now() - interval '90 seconds'
     order by created_at desc limit 1;
    if v_recent is not null then
      update public.notifications set data = v_data where id = v_recent;
    else
      perform public.create_notification(
        rec.user_id, 'goal_scored', null::uuid, 'game', new.game_id::text, v_data);
    end if;
  end loop;
  return null;
exception when others then return null;
end;
$function$;

-- ---------- 2) markets ------------------------------------------------------------------------
create or replace function public.market_unsettle(p_market uuid, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m markets;
begin
  select * into m from markets where id = p_market for update;
  if m.id is null or m.status <> 'resolved' or m.resolved_outcome_id is null then return; end if;
  -- Take the payout back, but never below zero (wallets are checked >= 0): coins already
  -- spent on other bets stay spent.
  update market_wallets w
     set balance = greatest(w.balance - round(pos.shares, 2), 0)
    from market_positions pos
   where pos.user_id = w.user_id and pos.outcome_id = m.resolved_outcome_id and pos.shares > 0;
  update markets
     set status = 'closed', resolved_outcome_id = null, resolved_at = null,
         resolution_note = coalesce(p_note, 'התוצאה בוטלה — ממתין לתוצאה מתוקנת')
   where id = p_market;
end $$;
revoke all on function public.market_unsettle(uuid, text) from public, anon, authenticated;

create or replace function public.market_resettle(p_market uuid, p_outcome uuid, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m markets;
begin
  select * into m from markets where id = p_market for update;
  if m.id is null or m.status <> 'resolved' or m.resolved_outcome_id = p_outcome then return; end if;
  perform public.market_unsettle(p_market, null);
  perform public.market_settle(p_market, p_outcome, coalesce(p_note, 'התוצאה תוקנה — המרקט נסגר מחדש'));
end $$;
revoke all on function public.market_resettle(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.market_games_after_update_body(new public.games, old public.games)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_market uuid; v_status text; v_win uuid; v_res uuid;
begin
  if new.is_test then return; end if;
  select id, status, resolved_outcome_id into v_market, v_status, v_res from markets where game_id = new.id;
  if v_market is null then
    if new.status = 'scheduled' and new.game_date > now()
       and new.home_team_id is not null and new.away_team_id is not null then
      perform market_create_for_game(new.id);
    end if;
    return;
  end if;

  if new.game_date is distinct from old.game_date and v_status in ('open','closed') then
    update markets set closes_at = new.game_date,
           status = case when new.game_date > now() then 'open' else 'closed' end
     where id = v_market;
    v_status := case when new.game_date > now() then 'open' else 'closed' end;
  end if;

  -- The winning outcome for the current score (own goals are already inside the scores).
  if new.home_score is not null and new.away_score is not null then
    select id into v_win from market_outcomes
     where market_id = v_market
       and okey = case when new.home_score > new.away_score then 'home'
                       when new.home_score < new.away_score then 'away'
                       else 'draw' end;
  end if;

  if new.status = 'completed' and v_status in ('open','closed') and v_win is not null then
    perform market_settle(v_market, v_win, 'נסגר לפי התוצאה הסופית');
  -- Result corrected on a completed game whose market already paid out.
  elsif new.status = 'completed' and v_status = 'resolved' and v_win is not null
        and v_win is distinct from v_res then
    perform market_resettle(v_market, v_win, 'התוצאה תוקנה — המרקט נסגר מחדש');
  -- A completed game re-opened: take the payout back until it is completed again.
  elsif old.status = 'completed' and new.status <> 'completed' and new.status <> 'cancelled'
        and v_status = 'resolved' then
    perform market_unsettle(v_market, null);
    if new.status = 'scheduled' and new.game_date > now() then
      update markets set status = 'open' where id = v_market;
    end if;
  elsif new.status = 'cancelled' and v_status in ('open','closed') then
    perform market_void(v_market, 'המשחק בוטל — כל המטבעות הוחזרו');
  -- Put back to scheduled (opened by mistake, the Apple reviewer, a board peek): the market a
  -- status flip closed must re-open, or the fixture loses its betting window for good.
  elsif new.status = 'scheduled' and old.status is distinct from 'scheduled'
        and v_status = 'closed' and new.game_date > now() then
    update markets set status = 'open' where id = v_market;
  elsif new.status <> 'scheduled' and v_status = 'open' then
    update markets set status = 'closed' where id = v_market;
  end if;
end $function$;
revoke all on function public.market_games_after_update_body(public.games, public.games) from public, anon, authenticated;

-- The market must never block saving a game result.
create or replace function public.market_games_after_update_safe()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    perform public.market_games_after_update_body(new, old);
  exception when others then
    raise warning 'market_games_after_update failed for game %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists market_games_upd on public.games;
create trigger market_games_upd after update on public.games
  for each row execute function public.market_games_after_update_safe();
-- (public.market_games_after_update() — the old trigger function — is left in place, unused.)

-- ---------- 3) red card ↔ suspension ----------------------------------------------------------
create or replace function public.sync_red_card_suspension()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_game uuid; v_player uuid; v_red int;
begin
  if coalesce(current_setting('app.no_auto_suspend', true), '') = 'on' then return null; end if;
  v_game   := coalesce(new.game_id, old.game_id);
  v_player := coalesce(new.player_id, old.player_id);
  if v_player is null then return null; end if;
  if exists (select 1 from public.games where id = v_game and is_test) then return null; end if;

  select coalesce(sum(red_cards), 0) into v_red
    from public.game_stats where game_id = v_game and player_id = v_player;

  if v_red > 0 then
    -- restore one this trigger cancelled (re-save), else create one if none exists
    update public.player_suspensions
       set cleared_at = null
     where player_id = v_player and issued_game_id = v_game
       and cleared_at is not null and games_remaining > 0
       and reason like 'כרטיס אדום%';
    insert into public.player_suspensions (player_id, issued_game_id, reason, games_remaining, created_by)
    select v_player, v_game, 'כרטיס אדום', 1, (select auth.uid())
     where not exists (select 1 from public.player_suspensions
                        where player_id = v_player and issued_game_id = v_game);
  else
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

-- apply_game_form_result keeps its own p_suspend_red switch: it now sets app.no_auto_suspend
-- around its box-score rewrite (patched in place from the live definition; see HOLD file part B).

-- ---------- 4) error-sweep fixes (2026-10-11, live migration podium_fns_service_role_only_and_face_clusters_fk)
-- podium_match_athletes / podium_unmatched_athletes admitted `auth.uid() is null` to let the
-- service-role Mac sync in — but the public ANON key has a null uid too, so anyone could read
-- unmatched athletes' name / DOB / club / medical expiry and trigger the matcher. Both now admit
-- `auth.role() = 'service_role'` instead (patched in place from the live definitions), and anon
-- has no EXECUTE. Verified: the sync's call after the change returned 200.
revoke execute on function public.podium_match_athletes() from anon, public;
revoke execute on function public.podium_unmatched_athletes() from anon, public;
grant execute on function public.podium_match_athletes() to authenticated, service_role;
grant execute on function public.podium_unmatched_athletes() to authenticated, service_role;

-- Deleting a player 409'd on face_clusters (the only FK to players with no ON DELETE rule).
alter table public.face_clusters drop constraint if exists face_clusters_player_id_fkey;
alter table public.face_clusters add constraint face_clusters_player_id_fkey
  foreign key (player_id) references public.players(id) on delete set null;
