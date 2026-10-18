-- Rollback of team-register-lead-days.sql: league-wide first reminder again.
drop function if exists public.set_team_register_lead_days(uuid, int);
drop function if exists public.send_game_reminder(text, uuid, date, uuid);

create or replace function public.send_game_reminder(p_kind text, p_game uuid, p_for date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  g       record;
  rec     record;
  base    jsonb;
  n       int := 0;
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
    for rec in
      select distinct pr.id as user_id
      from public.players p
      join public.profiles pr on pr.player_id = p.id
      where (
              p.team_id in (g.home_team_id, g.away_team_id)
              or exists (select 1 from public.player_teams pt
                         where pt.player_id = p.id
                           and pt.team_id in (g.home_team_id, g.away_team_id))
            )
        -- A2: suspended, medically unapproved, or on an approved absence — the gate
        -- would refuse him, so the reminder is only noise.
        and public.can_register_for_game(p.id, g.id)
        and (p_kind = 'register_reminder'
             or not exists (select 1 from public.game_availability ga
                            where ga.game_id = g.id and ga.player_id = p.id))
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
      -- A2, two fixes. The roster is now the same set the recipient loop above uses —
      -- players.team_id OR player_teams — so a multi-age squad member is no longer
      -- invisible to his own coach's digest. And "pending" means players who could
      -- still answer: counting a suspended or medical-less player as "טרם הגיב" told
      -- the coach to go chase someone the server will refuse.
      select count(*) filter (where ga.status = 'available'),
             count(*) filter (where ga.status = 'unavailable'),
             count(*) filter (where ga.id is null
                                and public.can_register_for_game(p.id, g.id))
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
     where ga.game_id = g.id;

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
     where go.game_id = g.id and go.status in ('assigned', 'approved');

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
    for rec in select user_id from public.game_followers(p_game) loop
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
end;
$function$;
revoke all on function public.send_game_reminder(text, uuid, date) from public, anon, authenticated;

create or replace function public.run_game_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_now    timestamptz := now();
  v_sent   int := 0;
  g        record;
  rule     record;
  d        int;
  v_target timestamptz;
begin
  for g in
    select id, game_date from public.games
     where status in ('scheduled', 'postponed')
       and not is_test
       and game_date > v_now
       and game_date < v_now + interval '30 days'
  loop
    for rule in select * from public.notification_rules where enabled loop
      for d in select generate_series(case when rule.repeats then 1 else rule.days_before end,
                                      rule.days_before)
      loop
        v_target := (((g.game_date at time zone 'Asia/Jerusalem')::date - d)
                     + make_interval(hours => rule.hour_local)) at time zone 'Asia/Jerusalem';
        if date_trunc('hour', v_target) = date_trunc('hour', v_now)
           -- Repeating rules stay excluded from catch-up: otherwise a late or moved
           -- fixture would fire one nudge per missed day all at once.
           or (not rule.repeats and v_target < v_now)
        then
          v_sent := v_sent + public.send_game_reminder(
            rule.kind, g.id, (v_target at time zone 'Asia/Jerusalem')::date);
        end if;
      end loop;
    end loop;
  end loop;
  return v_sent;
end;
$function$;

alter table public.teams drop column if exists register_lead_days;

notify pgrst, 'reload schema';
