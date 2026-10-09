-- 2026-10-09: ONE source of truth for "who judges this game" = public.game_officials
-- (account id, role='judge', status approved|assigned). games.referee_id (a player id)
-- becomes a DERIVED MIRROR kept by trg_mirror_referee so every reader of referee_id
-- (web game page/list/stats, shipped apps, form export, markets) stays right.
--
-- Loop control: the mirror and sync_referee_to_officials each set app.referee_sync='on'
-- while they write, and the other two triggers stand down when they see it.
--
-- Old app builds still PATCH games.referee_id from the edit form; that keeps working via
-- sync_referee_to_officials (admin/LM only). New clients call set_game_judge instead.

-- 1) Recompute games.referee_id from the approved judges of one game.
create or replace function public.mirror_referee_from_officials(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur text; v_new text;
begin
  select referee_id into v_cur from public.games where id = p_game;
  -- keep the current referee if he is still an approved judge here
  select pr.player_id::text into v_new
    from public.game_officials go join public.profiles pr on pr.id = go.user_id
   where go.game_id = p_game and go.role = 'judge' and go.status in ('approved','assigned')
     and pr.player_id is not null
   order by (pr.player_id::text = v_cur) desc, go.reviewed_at nulls last, go.created_at
   limit 1;
  if v_new is distinct from v_cur then
    perform set_config('app.referee_sync', 'on', true);
    update public.games
       set referee_id = v_new, referee_type = case when v_new is null then null else 'player' end
     where id = p_game;
    perform set_config('app.referee_sync', '', true);
  end if;
end; $$;
revoke all on function public.mirror_referee_from_officials(uuid) from public, anon, authenticated;

create or replace function public.trg_mirror_referee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.referee_sync', true), '') = 'on' then return null; end if;
  if tg_op in ('UPDATE','DELETE') and old.role = 'judge' then
    perform public.mirror_referee_from_officials(old.game_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.role = 'judge'
     and (tg_op = 'INSERT' or old.role <> 'judge' or new.game_id is distinct from old.game_id) then
    perform public.mirror_referee_from_officials(new.game_id);
  end if;
  return null;
end; $$;

drop trigger if exists trg_mirror_referee on public.game_officials;
create trigger trg_mirror_referee
  after insert or update or delete on public.game_officials
  for each row execute function public.trg_mirror_referee();

-- 2) referee_id -> officials sync (legacy direct writes from old app builds). Same body as
--    referee-officials-sync.sql, plus: stand down during the mirror, and suppress the
--    mirror while it rewrites the officials rows itself.
create or replace function public.sync_referee_to_officials()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new uuid; v_old uuid;
begin
  if coalesce(current_setting('app.referee_sync', true), '') = 'on' then return new; end if;
  if not (public.is_admin() or public.is_league_manager()) then return new; end if;
  if tg_op = 'UPDATE' and new.referee_id is not distinct from old.referee_id then return new; end if;

  if new.referee_id is not null and coalesce(new.referee_type, 'player') = 'player' then
    select id into v_new from public.profiles where player_id::text = new.referee_id limit 1;
  end if;
  if tg_op = 'UPDATE' and old.referee_id is not null and coalesce(old.referee_type, 'player') = 'player' then
    select id into v_old from public.profiles where player_id::text = old.referee_id limit 1;
  end if;

  perform set_config('app.referee_sync', 'on', true);
  if v_old is not null and v_old is distinct from v_new then
    delete from public.game_officials
     where game_id = new.id and role = 'judge' and user_id = v_old and status in ('assigned', 'approved');
  end if;
  if v_new is not null and not exists (
    select 1 from public.game_officials
     where game_id = new.id and role = 'judge' and user_id = v_new and status in ('assigned', 'approved')
  ) then
    insert into public.game_officials (game_id, user_id, role, status, created_by, reviewed_by, reviewed_at)
      values (new.id, v_new, 'judge', 'approved', auth.uid(), auth.uid(), now())
      on conflict (game_id, role, user_id)
      do update set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now();
    perform public.create_notification(v_new, 'official_assigned', auth.uid(), 'game', new.id::text,
      jsonb_build_object('role', 'judge'));
  end if;
  perform set_config('app.referee_sync', '', true);
  return new;
end; $$;

-- 3) Self-assign guard (referee-self-assign-guard.sql) also stands down for the mirror.
create or replace function public.guard_referee_self_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_my_player uuid;
begin
  if coalesce(current_setting('app.referee_sync', true), '') = 'on' then return new; end if;
  if v_me is null or new.referee_id is not distinct from old.referee_id then return new; end if;
  select player_id into v_my_player from public.profiles where id = v_me;
  if v_my_player is null or new.referee_id is distinct from v_my_player::text then return new; end if;
  if exists (select 1 from public.game_officials
              where game_id = new.id and role = 'judge' and user_id = v_me
                and status in ('assigned','approved')) then
    return new;
  end if;
  new.referee_id := old.referee_id;
  new.referee_type := old.referee_type;
  return new;
end; $$;

-- 4) assign/remove no longer touch referee_id themselves: the mirror does it.
create or replace function public.assign_official(p_game_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  if p_role not in ('judge','medic') then raise exception 'bad role'; end if;
  insert into public.game_officials (game_id, user_id, role, status, created_by, reviewed_by, reviewed_at)
    values (p_game_id, p_user_id, p_role, 'approved', auth.uid(), auth.uid(), now())
    on conflict (game_id, role, user_id)
    do update set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now();
  perform public.create_notification(p_user_id, 'official_assigned', auth.uid(), 'game', p_game_id::text,
    jsonb_build_object('role', p_role));
end; $$;

create or replace function public.remove_official(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  delete from public.game_officials where id = p_id;
end; $$;

-- 5) Edit-form semantics: "THE judge of this game is X" (null = nobody). Replaces any
--    other approved/assigned judge; pending applications are left for the officials tab.
create or replace function public.set_game_judge(p_game_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_had boolean;
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  if p_user_id is not null and not exists (
    select 1 from public.user_roles where user_id = p_user_id and role = 'judge') then
    raise exception 'not a judge';
  end if;
  delete from public.game_officials
   where game_id = p_game_id and role = 'judge' and status in ('approved','assigned')
     and user_id is distinct from p_user_id;
  if p_user_id is null then return; end if;
  select exists (select 1 from public.game_officials where game_id = p_game_id and role = 'judge'
                  and user_id = p_user_id and status in ('approved','assigned')) into v_had;
  if not v_had then
    perform public.assign_official(p_game_id, p_user_id, 'judge');
  end if;
end; $$;
grant execute on function public.set_game_judge(uuid, uuid) to authenticated;

-- 6) Picker for the edit form: every judge account, flagged when his own team plays.
create or replace function public.game_judge_options(p_game_id uuid)
returns table(user_id uuid, display_name text, player_id uuid, plays_in_game boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_league_manager()) then raise exception 'not authorized'; end if;
  return query
    select ur.user_id,
           coalesce(nullif(btrim(pl.first_name || ' ' || coalesce(pl.last_name,'')), ''), pr.display_name),
           pr.player_id,
           coalesce(exists (
             select 1 from public.games g
              where g.id = p_game_id
                and (pl.team_id in (g.home_team_id, g.away_team_id)
                     or exists (select 1 from public.player_teams pt
                                 where pt.player_id = pr.player_id
                                   and pt.team_id in (g.home_team_id, g.away_team_id)))), false)
      from public.user_roles ur
      left join public.profiles pr on pr.id = ur.user_id
      left join public.players pl on pl.id = pr.player_id
     where ur.role = 'judge'
     order by 4, 2;
end; $$;
grant execute on function public.game_judge_options(uuid) to authenticated;

-- 7) Public read of the judges' NAMES (game_officials itself is admin/LM/self only).
create or replace function public.game_judges(p_game_ids uuid[])
returns table(game_id uuid, user_id uuid, name text, player_id uuid, player_slug text)
language sql stable security definer set search_path = public as $$
  select go.game_id, go.user_id,
         coalesce(nullif(btrim(pl.first_name || ' ' || coalesce(pl.last_name,'')), ''), pr.display_name),
         pr.player_id, pl.slug
    from public.game_officials go
    join public.games g on g.id = go.game_id
    left join public.profiles pr on pr.id = go.user_id
    left join public.players pl on pl.id = pr.player_id
   where go.game_id = any(p_game_ids)
     and go.role = 'judge' and go.status in ('approved','assigned')
     and (not coalesce(g.is_test, false) or public.can_see_test())
   order by go.game_id, go.reviewed_at nulls last, go.created_at;
$$;
grant execute on function public.game_judges(uuid[]) to anon, authenticated;

-- 8) Backfill: completed games that only had referee_id (all 2025-26, so this season's
--    officials_paylog is unaffected). No notifications.
insert into public.game_officials (game_id, user_id, role, status, created_at, reviewed_at)
select g.id, pr.id, 'judge', 'approved', g.game_date, g.game_date
  from public.games g
  join lateral (select id from public.profiles where player_id::text = g.referee_id limit 1) pr on true
 where g.referee_id is not null and coalesce(g.referee_type,'player') = 'player'
   and not exists (select 1 from public.game_officials go where go.game_id = g.id and go.role = 'judge')
on conflict (game_id, role, user_id) do nothing;
