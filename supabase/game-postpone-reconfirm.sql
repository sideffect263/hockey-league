-- Postponed games + re-confirming sign-ups after a game moves (2026-10-26).
--
-- Before this:
--  * Marking a game נדחה (status 'postponed') told nobody, and run_game_reminders kept
--    firing "sign up for the game" on the OLD date (it included 'postponed').
--  * Moving a game kept every מגיע / לא מגיע as-is. A player who said "coming" on
--    Saturday still counted as coming on the new date, and nobody asked him.
--
-- Now:
--  1. status → 'postponed' sends `game_postponed` (bell + push) to the game's audience
--     and its judges/medics. Reminders, the coach nudge and the sign-up panel stop:
--     they only run for 'scheduled' games.
--  2. Giving a postponed game a new future date flips it back to 'scheduled'
--     (the manager edits the date and forgets the status — that must not leave the
--     fixture stuck with no reminders and a closed market).
--  3. A REAL move (another day, or more than 2 hours) flags every answer for that game
--     `needs_reconfirm`. The answer stays (the coach keeps a picture of the squad) but
--     it counts as "hasn't answered" in the nudge and the squad digests until the
--     player answers again. Any new write to the row clears the flag.
--     The `game_moved` notification goes to the officials too and carries
--     `reconfirm: true` so the text asks for a new answer.
--
-- Additive: one column with a default, replaced function bodies, two new triggers.
-- Down: game-postpone-reconfirm-down.sql

alter table public.game_availability
  add column if not exists needs_reconfirm boolean not null default false;

-- Any write to an answer is a fresh answer, so it clears the flag. The one write that
-- must not clear it is the flagging itself (a second move while still flagged), which
-- runs with app.flag_reconfirm = 'on'.
create or replace function public.game_availability_clear_reconfirm()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.flag_reconfirm', true), '') = 'on' then
    return new;
  end if;
  if old.needs_reconfirm then
    new.needs_reconfirm := false;
  end if;
  return new;
end $$;

drop trigger if exists trg_game_availability_clear_reconfirm on public.game_availability;
create trigger trg_game_availability_clear_reconfirm
  before update on public.game_availability
  for each row execute function public.game_availability_clear_reconfirm();

-- A postponed game that gets a new future date is scheduled again.
create or replace function public.games_reschedule_postponed()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'postponed' and new.status = 'postponed'
     and new.game_date is distinct from old.game_date
     and new.game_date > now() then
    new.status := 'scheduled';
  end if;
  return new;
end $$;

drop trigger if exists trg_games_reschedule_postponed on public.games;
create trigger trg_games_reschedule_postponed
  before update of game_date on public.games
  for each row execute function public.games_reschedule_postponed();

-- Who hears about a moved / postponed game: the game's audience (both rosters, anyone
-- signed up incl. loans, both teams' coaches) + its judges and medics. Device accounts
-- (the club phone) are not people.
create or replace function public.game_change_recipients(p_game uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select a.user_id from public.game_audience(p_game) a
  union
  select go.user_id from public.game_officials go
   where go.game_id = p_game and go.status in ('assigned', 'approved')
     and go.user_id is not null
     and not public.is_device_account(go.user_id)
$$;
revoke all on function public.game_change_recipients(uuid) from public, anon, authenticated;

create or replace function public.notify_game_moved()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_what text;
  v_home text; v_away text;
  v_reconfirm boolean := false;
  rec record;
begin
  if new.status = 'completed' then return null; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;

  -- Postponed, no new date yet.
  if new.status = 'postponed' and old.status is distinct from 'postponed' then
    for rec in select user_id from public.game_change_recipients(new.id) loop
      perform public.create_notification(
        rec.user_id, 'game_postponed', null, 'game', new.id::text,
        jsonb_build_object(
          'home_team', coalesce(v_home, ''), 'away_team', coalesce(v_away, ''),
          'old_game_date', old.game_date));
    end loop;
    return null;
  end if;
  if new.status = 'postponed' then return null; end if;

  if new.venue is distinct from old.venue and new.game_date is distinct from old.game_date then
    v_what := 'both';
  elsif new.venue is distinct from old.venue then
    v_what := 'venue';
  elsif new.game_date is distinct from old.game_date then
    v_what := 'time';
  else
    return null;
  end if;

  -- A real move: another day, or more than two hours. Half an hour later on the same
  -- evening does not make thirty people answer again.
  if new.game_date is distinct from old.game_date and new.game_date > now()
     and ((new.game_date at time zone 'Asia/Jerusalem')::date
            <> (old.game_date at time zone 'Asia/Jerusalem')::date
          or abs(extract(epoch from (new.game_date - old.game_date))) > 2 * 3600) then
    v_reconfirm := true;
    perform set_config('app.flag_reconfirm', 'on', true);
    update public.game_availability set needs_reconfirm = true where game_id = new.id;
    perform set_config('app.flag_reconfirm', '', true);
  end if;

  for rec in select user_id from public.game_change_recipients(new.id) loop
    perform public.create_notification(
      rec.user_id, 'game_moved', null, 'game', new.id::text,
      jsonb_build_object(
        'what', v_what,
        'home_team', coalesce(v_home, ''), 'away_team', coalesce(v_away, ''),
        'venue', new.venue, 'old_venue', old.venue,
        'game_date', new.game_date, 'old_game_date', old.game_date,
        'reconfirm', v_reconfirm,
        'from_postponed', old.status = 'postponed'));
  end loop;
  return null;
exception when others then
  perform set_config('app.flag_reconfirm', '', true);
  return null;
end $$;

drop trigger if exists trg_notify_game_moved on public.games;
create trigger trg_notify_game_moved
  after update of venue, game_date, status on public.games
  for each row execute function public.notify_game_moved();

-- Reminders: scheduled games only. A postponed game has no date to sign up for.
create or replace function public.run_game_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := now();
  v_sent   int := 0;
  g        record;
  rule     record;
  t        record;
  d        int;
  v_lead   int;
  v_target timestamptz;
begin
  for g in
    select id, game_date, home_team_id, away_team_id from public.games
     where status = 'scheduled'
       and not is_test
       and game_date > v_now
       and game_date < v_now + interval '30 days'
  loop
    for rule in select * from public.notification_rules where enabled loop
      if rule.kind = 'register_reminder' then
        for t in select tm.id, tm.register_lead_days from public.teams tm
                  where tm.id in (g.home_team_id, g.away_team_id)
        loop
          v_lead := greatest(rule.days_before, coalesce(t.register_lead_days, 0));
          v_target := (((g.game_date at time zone 'Asia/Jerusalem')::date - v_lead)
                       + make_interval(hours => rule.hour_local)) at time zone 'Asia/Jerusalem';
          if date_trunc('hour', v_target) = date_trunc('hour', v_now) or v_target < v_now then
            v_sent := v_sent + public.send_game_reminder(
              'register_reminder', g.id, (v_target at time zone 'Asia/Jerusalem')::date, t.id);
          end if;
          if v_lead > rule.days_before then
            v_target := (((g.game_date at time zone 'Asia/Jerusalem')::date - rule.days_before)
                         + make_interval(hours => rule.hour_local)) at time zone 'Asia/Jerusalem';
            if date_trunc('hour', v_target) = date_trunc('hour', v_now) then
              v_sent := v_sent + public.send_game_reminder(
                'register_nudge', g.id, (v_target at time zone 'Asia/Jerusalem')::date, t.id);
            end if;
          end if;
        end loop;
        continue;
      end if;

      for d in select generate_series(case when rule.repeats then 1 else rule.days_before end,
                                      rule.days_before)
      loop
        v_target := (((g.game_date at time zone 'Asia/Jerusalem')::date - d)
                     + make_interval(hours => rule.hour_local)) at time zone 'Asia/Jerusalem';
        if date_trunc('hour', v_target) = date_trunc('hour', v_now)
           or (not rule.repeats and v_target < v_now)
        then
          v_sent := v_sent + public.send_game_reminder(
            rule.kind, g.id, (v_target at time zone 'Asia/Jerusalem')::date);
        end if;
      end loop;
    end loop;
  end loop;
  return v_sent;
end $$;

-- Reminders and digests: an answer flagged needs_reconfirm counts as "hasn't answered".
-- Only the four marked lines differ from the previous body.
create or replace function public.send_game_reminder(p_kind text, p_game uuid, p_for date, p_team uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g       record;
  rec     record;
  base    jsonb;
  n       int := 0;
  v_teams uuid[];
  v_yes   int; v_no int; v_pending int;
  v_home_yes int; v_away_yes int;
  v_judges int; v_medics int;
begin
  select gm.id, gm.game_date, gm.home_team_id, gm.away_team_id,
         th.name as home_name, ta.name as away_name
    into g
    from public.games gm
    left join public.teams th on th.id = gm.home_team_id
    left join public.teams ta on ta.id = gm.away_team_id
   where gm.id = p_game;
  if not found then return 0; end if;

  base := jsonb_build_object(
    'home_team', coalesce(g.home_name, ''),
    'away_team', coalesce(g.away_name, ''),
    'game_date', g.game_date
  );

  if p_kind in ('register_reminder', 'register_nudge') then
    v_teams := case when p_team is null then array[g.home_team_id, g.away_team_id]
                    else array[p_team] end;
    for rec in
      select distinct pr.id as user_id
      from public.players p
      join public.profiles pr on pr.player_id = p.id
      where (
              p.team_id = any(v_teams)
              or exists (select 1 from public.player_teams pt
                         where pt.player_id = p.id
                           and pt.team_id = any(v_teams))
            )
        and public.can_register_for_game(p.id, g.id)
        and (p_kind = 'register_reminder'
             or not exists (select 1 from public.game_availability ga
                            where ga.game_id = g.id and ga.player_id = p.id
                              and not ga.needs_reconfirm))                       -- changed
        and (p_kind <> 'register_reminder'
             or not exists (select 1 from public.game_reminder_log l
                            where l.game_id = g.id and l.kind = 'register_reminder'
                              and l.user_id = pr.id))
    loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id,
          case p_kind when 'register_reminder' then 'game_register_reminder'
                      else 'game_register_nudge' end,
          null, 'game', p_game::text, base);
        n := n + 1;
      end if;
    end loop;

  elsif p_kind = 'coach_digest' then
    for rec in
      select ur.user_id, ur.team_id
      from public.user_roles ur
      where ur.role = 'coach' and ur.team_id in (g.home_team_id, g.away_team_id)
    loop
      select count(*) filter (where ga.status = 'available' and not ga.needs_reconfirm),     -- changed
             count(*) filter (where ga.status = 'unavailable' and not ga.needs_reconfirm),   -- changed
             count(*) filter (where (ga.id is null and public.can_register_for_game(p.id, g.id))
                                 or ga.needs_reconfirm)                                      -- changed
        into v_yes, v_no, v_pending
        from public.players p
        left join public.game_availability ga
               on ga.game_id = g.id and ga.player_id = p.id
       where p.team_id = rec.team_id
          or exists (select 1 from public.player_teams pt
                     where pt.player_id = p.id and pt.team_id = rec.team_id);

      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'coach_squad_digest', null, 'game', p_game::text,
          base || jsonb_build_object('yes', v_yes, 'no', v_no, 'pending', v_pending));
        n := n + 1;
      end if;
    end loop;

  elsif p_kind = 'lm_squads' then
    select count(*) filter (where ga.status = 'available' and coalesce(ga.team_id, p.team_id) = g.home_team_id),
           count(*) filter (where ga.status = 'available' and coalesce(ga.team_id, p.team_id) = g.away_team_id)
      into v_home_yes, v_away_yes
      from public.game_availability ga
      join public.players p on p.id = ga.player_id
     where ga.game_id = g.id and not ga.needs_reconfirm;                               -- changed

    for rec in select user_id from public.manager_user_ids() loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'lm_squad_digest', null, 'game', p_game::text,
          base || jsonb_build_object('home_count', coalesce(v_home_yes, 0),
                                     'away_count', coalesce(v_away_yes, 0)));
        n := n + 1;
      end if;
    end loop;

  elsif p_kind in ('lm_officials_early', 'lm_officials_late') then
    select count(*) filter (where go.role = 'judge'),
           count(*) filter (where go.role = 'medic')
      into v_judges, v_medics
      from public.game_officials go
     where go.game_id = g.id and go.status in ('assigned', 'approved')
       and not public.is_device_account(go.user_id);

    for rec in select user_id from public.manager_user_ids() loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'lm_officials_digest', null, 'game', p_game::text,
          base || jsonb_build_object('judges', coalesce(v_judges, 0),
                                     'medics', coalesce(v_medics, 0)));
        n := n + 1;
      end if;
    end loop;
  elsif p_kind = 'follower_game_alert' then
    for rec in select user_id from public.game_fans(p_game, true) loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'follow_game_alert', null, 'game', p_game::text, base);
        n := n + 1;
      end if;
    end loop;
  end if;

  return n;
end $$;

-- The coach's "remind who hasn't answered" button reaches flagged answers too.
create or replace function public.coach_nudge_game(p_game_id uuid, p_team_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  g    record;
  rec  record;
  base jsonb;
  n    int := 0;
begin
  if not (coalesce(public.is_admin(), false)
          or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_coach_of(p_team_id), false)) then
    raise exception 'not authorized';
  end if;
  select gm.id, gm.game_date, gm.status, gm.home_team_id, gm.away_team_id,
         th.name as home_name, ta.name as away_name
    into g
    from public.games gm
    left join public.teams th on th.id = gm.home_team_id
    left join public.teams ta on ta.id = gm.away_team_id
   where gm.id = p_game_id;
  if not found then raise exception 'game not found'; end if;
  if p_team_id not in (g.home_team_id, g.away_team_id) then raise exception 'team not in game'; end if;
  if g.status <> 'scheduled' or g.game_date < now() then raise exception 'game not upcoming'; end if;
  base := jsonb_build_object('home_team', coalesce(g.home_name, ''),
                             'away_team', coalesce(g.away_name, ''),
                             'game_date', g.game_date);
  for rec in
    select distinct pr.id as user_id
      from public.players p
      join public.profiles pr on pr.player_id = p.id
     where (p.team_id = p_team_id
            or exists (select 1 from public.player_teams pt
                        where pt.player_id = p.id and pt.team_id = p_team_id))
       and public.can_register_for_game(p.id, g.id)
       and not exists (select 1 from public.game_availability ga
                        where ga.game_id = g.id and ga.player_id = p.id
                          and not ga.needs_reconfirm)
  loop
    insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
    values (p_game_id, 'coach_nudge', rec.user_id, current_date) on conflict do nothing;
    if found then
      perform public.create_notification(rec.user_id, 'game_register_nudge', auth.uid(),
                                         'game', p_game_id::text, base);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
