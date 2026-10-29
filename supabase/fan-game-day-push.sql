-- Fan game-day morning push — 2026-10-29 (Ariel: yes; on by default).
-- "Your team plays today": 09:00 Israel time on the game's day, to everyone who follows
-- either team and plays for neither (players get their own sign-up reminders). Rides the
-- existing game-reminders cron (hourly), a notification_rules row (edit hour_local /
-- enabled there) and game_reminder_log (one per person per game). Opt-out is per followed
-- team: follows.game_day (default on); the apps have no switch for it yet.
-- send_game_reminder below = the live definition + the fan_game_day branch.
alter table public.follows add column if not exists game_day boolean not null default true;

insert into public.notification_rules (kind, days_before, hour_local, repeats)
values ('fan_game_day', 0, 9, false)
on conflict (kind) do nothing;

CREATE OR REPLACE FUNCTION public.send_game_reminder(p_kind text, p_game uuid, p_for date, p_team uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                              and not ga.needs_reconfirm))
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
      select count(*) filter (where ga.status = 'available' and not ga.needs_reconfirm),
             count(*) filter (where ga.status = 'unavailable' and not ga.needs_reconfirm),
             count(*) filter (where (ga.id is null and public.can_register_for_game(p.id, g.id))
                                 or ga.needs_reconfirm)
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
     where ga.game_id = g.id and not ga.needs_reconfirm;

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
  elsif p_kind = 'fan_game_day' then
    for rec in
      select distinct f.user_id
        from public.follows f
       where f.target_type = 'team' and f.game_day
         and f.target_id in (g.home_team_id, g.away_team_id)
         and public.is_real_fan(f.user_id, 'team', g.home_team_id)
         and public.is_real_fan(f.user_id, 'team', g.away_team_id)
    loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'follow_game_today', null, 'game', p_game::text, base);
        n := n + 1;
      end if;
    end loop;
  end if;

  return n;
end $function$;

notify pgrst, 'reload schema';
