-- 2026-10-09: the iOS/Android judge board PATCHes games.referee_id to the signed-in
-- user's own player on open. For an admin/LM that fired trg_sync_referee_to_officials
-- and silently REPLACED the assigned judge (Saturday 10/10 games lost איתי this way).
-- Guard: a direct write that makes YOURSELF the referee is ignored unless you already
-- hold an approved/assigned judge row for that game. assign_official inserts that row
-- before it touches referee_id, so it still works. Fixes shipped apps with no release.
create or replace function public.guard_referee_self_assign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_my_player uuid;
begin
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

drop trigger if exists trg_guard_referee_self_assign on public.games;
create trigger trg_guard_referee_self_assign
  before update of referee_id on public.games
  for each row execute function public.guard_referee_self_assign();
