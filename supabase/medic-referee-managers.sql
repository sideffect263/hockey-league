-- Medic manager + referee manager roles (2026-11-04).
--
-- Until now one person ran both: the league manager / admin had the single "בעלי תפקיד"
-- tab — rates, judge + medic assignment, applications, the pay log. Ariel wants it split:
--   medic_manager   (מנהל חובשים)  assigns medics, decides medic applications, gets the
--                                   medic notifications. Sees nothing about referees.
--   referee_manager (מנהל שופטים)  the same for referees (judges), plus the referee /
--                                   secretary role requests.
-- NEITHER sees or sets rates or the pay log — those stay admin / league manager only
-- (official_rates RLS, set_official_rate, officials_paylog are untouched by this file).
--
-- Every gate is in the DB, not the screen. can_manage_official(role) is the one check:
-- admin / league manager → any role; medic_manager → 'medic'; referee_manager → 'judge'.
-- The read RPCs filter rows by it, so a medic manager's overview simply has no judge rows.
--
-- Notifications:
--   official_application  (an official applies for a game) → also that role's managers.
--   official_role_request (someone asks to become referee/secretary) → also referee managers.
--   lm_officials_digest   (the before-game "who is missing" reminder) → also each role's
--                         managers, ONLY when their role is missing, data.scope = the role,
--                         so the text says "חסר חובש" and nothing about referees.
--
-- Free-tier cost: nothing stored beyond the role rows.
-- Rollback: medic-referee-managers-down.sql

-- ---- roles ---------------------------------------------------------------------------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role = any (array[
  'player','coach','content_editor','judge','league_manager','medic','developer',
  'medic_manager','referee_manager']));

create or replace function public.is_medic_manager()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'medic_manager');
$$;

create or replace function public.is_referee_manager()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'referee_manager');
$$;

-- May the caller manage officials of this role? NULL role = "any role at all" (tab access).
create or replace function public.can_manage_official(p_role text default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.is_admin(), false)
      or coalesce(public.is_league_manager(), false)
      or ((p_role is null or p_role = 'medic') and public.is_medic_manager())
      or ((p_role is null or p_role = 'judge') and public.is_referee_manager());
$$;

-- Who should hear about a role's officials work: that role's managers (not admins / LMs —
-- callers add manager_user_ids() themselves where they already did).
create or replace function public.official_role_manager_ids(p_role text)
returns table(user_id uuid) language sql stable security definer set search_path to 'public' as $$
  select ur.user_id from public.user_roles ur
   where ur.role = case p_role when 'medic' then 'medic_manager'
                               when 'judge' then 'referee_manager' end;
$$;
revoke all on function public.official_role_manager_ids(text) from public, anon, authenticated;

-- ---- reads ---------------------------------------------------------------------------
create or replace function public.list_assignable_officials()
returns table(user_id uuid, display_name text, role text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.can_manage_official() then raise exception 'not authorized'; end if;
  return query
    select ur.user_id, pr.display_name, ur.role
    from public.user_roles ur left join public.profiles pr on pr.id = ur.user_id
    where ur.role in ('judge','medic')
      and public.can_manage_official(ur.role)
    order by ur.role, pr.display_name;
end; $function$;

create or replace function public.game_officials_overview()
returns table(id uuid, game_id uuid, user_id uuid, display_name text, full_name text, phone text, role text, status text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.can_manage_official() then raise exception 'not authorized'; end if;
  return query
    select go.id, go.game_id, go.user_id, pr.display_name,
           -- a "full name" with no letters (Itay typed ".") is no name: callers fall back
           -- to display_name. Same rule as game_officials_contact (5c49f99).
           case when uc.full_name ~ '[[:alpha:]א-ת]' then btrim(uc.full_name) end as full_name,
           uc.phone,
           go.role, go.status
    from public.game_officials go
    join public.games g on g.id = go.game_id and g.status <> 'completed'
    left join public.profiles pr     on pr.id      = go.user_id
    left join public.user_contact uc on uc.user_id = go.user_id
    where not public.is_device_account(go.user_id)
      and public.can_manage_official(go.role);
end; $function$;

create or replace function public.game_officials_contact(p_game_id uuid)
returns table(role text, status text, user_id uuid, full_name text, phone text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.can_manage_official() then
    raise exception 'not authorized';
  end if;
  return query
    select go.role, go.status, go.user_id,
           -- A contact name with no letters (e.g. "." typed to get past a required
           -- field) is not a name: fall back to the profile's display name.
           coalesce(case when uc.full_name ~ '[[:alpha:]א-ת]' then btrim(uc.full_name) end,
                    pr.display_name) as full_name,
           uc.phone
    from public.game_officials go
    left join public.user_contact uc on uc.user_id = go.user_id
    left join public.profiles pr     on pr.id      = go.user_id
    where go.game_id = p_game_id
      and not public.is_device_account(go.user_id)
      and public.can_manage_official(go.role)
    order by go.role, full_name;
end; $function$;

-- ---- writes --------------------------------------------------------------------------
create or replace function public.assign_official(p_game_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_role not in ('judge','medic') then raise exception 'bad role'; end if;
  if not public.can_manage_official(p_role) then raise exception 'not authorized'; end if;
  insert into public.game_officials (game_id, user_id, role, status, created_by, reviewed_by, reviewed_at)
    values (p_game_id, p_user_id, p_role, 'approved', auth.uid(), auth.uid(), now())
    on conflict (game_id, role, user_id)
    do update set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now();
  perform public.create_notification(p_user_id, 'official_assigned', auth.uid(), 'game', p_game_id::text,
    jsonb_build_object('role', p_role));
end; $function$;

create or replace function public.remove_official(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_role text;
begin
  select role into v_role from public.game_officials where id = p_id;
  if not public.can_manage_official(coalesce(v_role, '-')) then raise exception 'not authorized'; end if;
  delete from public.game_officials where id = p_id;
end; $function$;

create or replace function public.review_official_application(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_user uuid; v_game uuid; v_role text;
begin
  select role into v_role from public.game_officials where id = p_id;
  if not public.can_manage_official(coalesce(v_role, '-')) then raise exception 'not authorized'; end if;
  update public.game_officials
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'applied'
   returning user_id, game_id, role into v_user, v_game, v_role;
  if v_user is not null then
    perform public.create_notification(v_user,
      case when p_approve then 'official_application_approved' else 'official_application_rejected' end,
      auth.uid(), 'game', v_game::text, jsonb_build_object('role', v_role));
  end if;
end; $function$;

-- ---- applications: tell that role's managers too -------------------------------------
create or replace function public.apply_as_official(p_game_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_phone text; v_player uuid; v_uid uuid := (select auth.uid());
begin
  if p_role not in ('judge','medic') then raise exception 'bad role'; end if;
  if p_role = 'judge' and not (public.is_admin() or public.is_judge()) then raise exception 'not authorized'; end if;
  if p_role = 'medic' and not (public.is_admin() or public.is_medic()) then raise exception 'not authorized'; end if;

  -- conflict of interest: his own team is playing
  select player_id into v_player from public.profiles where id = v_uid;
  if v_player is not null and exists (
    select 1 from public.games g
    where g.id = p_game_id
      and (exists (select 1 from public.players p
                   where p.id = v_player and p.team_id in (g.home_team_id, g.away_team_id))
           or exists (select 1 from public.player_teams pt
                      where pt.player_id = v_player and pt.team_id in (g.home_team_id, g.away_team_id)))
  ) then
    raise exception 'own team';
  end if;

  -- one person cannot cover both roles in the same game
  if exists (select 1 from public.game_officials
             where game_id = p_game_id and user_id = v_uid
               and role <> p_role and status in ('applied','approved','assigned')) then
    raise exception 'other role taken';
  end if;

  -- the medic's number is what the game sheet needs; his name comes from the account
  if p_role = 'medic' then
    select phone into v_phone from public.user_contact where user_id = v_uid;
    if coalesce(btrim(v_phone), '') = '' then raise exception 'missing phone'; end if;
  end if;

  insert into public.game_officials (game_id, user_id, role, status, created_by)
    values (p_game_id, v_uid, p_role, 'applied', v_uid)
    on conflict (game_id, role, user_id) do update
      -- re-applying after a decline is allowed; an approved row is left alone
      set status = case when public.game_officials.status = 'approved' then 'approved' else 'applied' end,
          reviewed_by = null, reviewed_at = null;

  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, data)
  select distinct u, 'official_application', v_uid, 'game', p_game_id::text,
         jsonb_build_object('role', p_role)
  from ( select ur.user_id as u from public.user_roles ur where ur.role = 'league_manager'
         union
         select usr.id from public.admin_users au
           join auth.users usr on lower(usr.email) = lower(au.email)
         union
         select m.user_id from public.official_role_manager_ids(p_role) m ) t(u)
  where u is not null and u <> v_uid;
end;
$function$;

-- ---- referee / secretary role requests: referee managers decide them too -------------
create or replace function public.pending_official_role_requests()
returns table(id uuid, user_id uuid, wants_referee boolean, wants_secretary boolean, note text, created_at timestamp with time zone, requester text, avatar_url text, player_id uuid, player_name text)
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.can_manage_official('judge') then raise exception 'not authorized'; end if;
  return query
    select r.id, r.user_id, r.wants_referee, r.wants_secretary, r.note, r.created_at,
           pr.display_name as requester, pr.avatar_url,
           pr.player_id,
           nullif(btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')), '') as player_name
      from public.official_role_requests r
      left join public.profiles pr on pr.id = r.user_id
      left join public.players pl on pl.id = pr.player_id
     where r.status = 'pending'
     order by r.created_at asc;
end; $function$;

create or replace function public.decide_official_role_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_user uuid; v_ref boolean; v_sec boolean; v_granted int := 0;
begin
  if not public.can_manage_official('judge') then raise exception 'not authorized'; end if;
  select user_id, wants_referee, wants_secretary into v_user, v_ref, v_sec
    from public.official_role_requests where id = p_id and status = 'pending'
    for update;
  if v_user is null then raise exception 'request not found'; end if;

  if p_approve then
    insert into public.user_roles (user_id, role, team_id)
    select v_user, 'judge', null
     where not exists (select 1 from public.user_roles where user_id = v_user and role = 'judge');
    get diagnostics v_granted = row_count;
  end if;

  update public.official_role_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  if not p_approve then
    perform public.create_notification(v_user, 'official_role_rejected', auth.uid(), 'official_role_request', p_id::text,
      jsonb_build_object('wants_referee', v_ref, 'wants_secretary', v_sec));
  elsif v_granted = 0 then
    perform public.create_notification(v_user, 'official_role_approved', auth.uid(), 'official_role_request', p_id::text,
      jsonb_build_object('wants_referee', v_ref, 'wants_secretary', v_sec));
  end if;
end; $function$;

create or replace function public.notify_admins_new_official_role_request()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_name text;
begin
  select display_name into v_name from public.profiles where id = NEW.user_id;
  insert into public.notifications(user_id, type, actor_id, entity_type, entity_id, data)
  select distinct r.uid, 'official_role_request', NEW.user_id, 'official_role_request', NEW.id::text,
         jsonb_build_object('requester', coalesce(v_name, ''),
                            'wants_referee', NEW.wants_referee, 'wants_secretary', NEW.wants_secretary)
  from (
    select au.id as uid from public.admin_users a join auth.users au on au.email = a.email
    union
    select ur.user_id as uid from public.user_roles ur where ur.role = 'league_manager'
    union
    select m.user_id from public.official_role_manager_ids('judge') m
  ) r
  where r.uid <> NEW.user_id;
  return null;
exception when others then return null;
end; $function$;

drop policy if exists "Read own official role requests" on public.official_role_requests;
create policy "Read own official role requests" on public.official_role_requests
  for select using (user_id = auth.uid() or public.is_admin() or public.is_league_manager()
                    or public.is_referee_manager());

-- ---- the before-game "who is missing" reminder: send_game_reminder -------------------
-- Same function as game-postpone-reconfirm.sql / fan-game-day-push.sql; only the
-- lm_officials_* branch changes (managers of a MISSING role get a scoped copy).
create or replace function public.send_game_reminder(p_kind text, p_game uuid, p_for date, p_team uuid default null::uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
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

    -- Medic / referee managers: only when THEIR role is missing, and only their role's
    -- count (scope), so a medic manager never reads about referees. Someone who is also
    -- an admin / LM already got the full digest above (the log row stops a second one).
    for rec in
      select m.user_id, 'medic'::text as scope from public.official_role_manager_ids('medic') m
       where coalesce(v_medics, 0) = 0
      union
      select m.user_id, 'judge' from public.official_role_manager_ids('judge') m
       where coalesce(v_judges, 0) = 0
    loop
      insert into public.game_reminder_log (game_id, kind, user_id, sent_for)
      values (p_game, p_kind, rec.user_id, p_for) on conflict do nothing;
      if found then
        perform public.create_notification(
          rec.user_id, 'lm_officials_digest', null, 'game', p_game::text,
          base || case rec.scope
                    when 'medic' then jsonb_build_object('scope', 'medic', 'medics', 0)
                    else jsonb_build_object('scope', 'judge', 'judges', 0) end);
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
