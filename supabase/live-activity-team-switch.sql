-- Per-team live switch: "התראה חיה במשחקים" (Ariel, 2026-10-13).
--
-- Who automatically gets the live score at kickoff (iOS push-to-start of the Live Activity,
-- Android's FCM live notification) = users who follow either team AND have this team's
-- switch ON. The switch defaults ON when following. It replaces the bell rule
-- (`follows.notify`) for live updates only; the bell keeps meaning "notifications".
--
-- ADDITIVE ONLY: one column with a default (existing follows → ON), one RPC, and the
-- live_game_state trigger function re-created with `live_updates` in place of `notify`.
-- RLS on follows already limits every user to their own rows (select/insert/update/delete),
-- so the apps may also write the column directly; the RPC is the documented path.
-- Rollback: live-activity-team-switch-down.sql.

alter table public.follows add column if not exists live_updates boolean not null default true;

-- The apps' toggle. Returns true when a team follow of the caller was updated (false = the
-- caller does not follow that team: follow first, the switch then starts ON).
-- SECURITY INVOKER: it runs under the caller's own follows RLS (own rows only).
create or replace function public.set_team_live_updates(p_team_id uuid, p_on boolean)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_n integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  update public.follows set live_updates = coalesce(p_on, true)
   where user_id = auth.uid() and target_type = 'team' and target_id = p_team_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.set_team_live_updates(uuid, boolean) from public, anon;
grant execute on function public.set_team_live_updates(uuid, boolean) to authenticated;

-- Same body as supabase/live-activity.sql, the follower test now `f.live_updates`.
create or replace function public._live_activity_on_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g uuid := coalesce(new.game_id, old.game_id);
begin
  if exists (select 1 from public.live_activity_tokens where game_id = g) then
    perform public._live_activity_kick(g, case tg_op when 'DELETE' then 'deleted' else 'state' end);
  elsif tg_op <> 'DELETE' and coalesce(new.is_running, false)
        and not exists (select 1 from public.live_activity_games where game_id = g and start_sent_at is not null)
        and exists (
          select 1 from public.live_activity_start_tokens st
            join public.follows f on f.user_id = st.user_id and f.target_type = 'team' and f.live_updates
            join public.games gm on gm.id = g and f.target_id in (gm.home_team_id, gm.away_team_id)) then
    perform public._live_activity_kick(g, 'state');
  end if;
  return null;
exception when others then
  return null;   -- never break the judge's broadcast
end $$;
revoke all on function public._live_activity_on_state() from public, anon, authenticated;
