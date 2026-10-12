-- Game form signing: saved signatures + an automatic "please sign" reminder (2026-10-12).
--
--  1. SAVED SIGNATURE. A signer may keep their finger-drawn signature on their account
--     (one per user). Next time the form card offers "אישור וחתימה" — one tap, no drawing.
--     The image never leaves the server on the one-tap path: sign_game_form_saved copies
--     it into game_signatures itself. Private: no table access, RPCs read/write only the
--     caller's own row.
--
--  2. REMINDER. When a game turns completed, everyone who may sign one of its six slots
--     (referee, medic, each coach, each captain) gets a `game_form_sign` notification
--     (bell + push via trg_notify_push) → the game page's טופס המשחק card. One per user
--     per game, listing their roles. Test games are dropped by
--     trg_notifications_skip_test_games, like every other notification.
--
-- Depends on supabase/game-form-signing.sql. Down: game-form-sign-reminder-down.sql

-- ---------------------------------------------------------------- saved signatures
create table if not exists public.saved_signatures (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  image      text not null,
  updated_at timestamptz not null default now()
);
alter table public.saved_signatures enable row level security;
-- No policies on purpose: RPCs only.

create or replace function public.my_saved_signature()
returns text language sql stable security definer set search_path = public as $$
  select image from saved_signatures where user_id = auth.uid()
$$;
grant execute on function public.my_saved_signature() to authenticated;

create or replace function public.save_my_signature(p_image text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  if p_image is null or p_image not like 'data:image/png;base64,%' or length(p_image) > 400000 then
    raise exception 'invalid signature image';
  end if;
  insert into saved_signatures (user_id, image, updated_at) values (auth.uid(), p_image, now())
  on conflict (user_id) do update set image = excluded.image, updated_at = now();
end $$;
grant execute on function public.save_my_signature(text) to authenticated;

create or replace function public.delete_my_signature()
returns void language sql security definer set search_path = public as $$
  delete from saved_signatures where user_id = auth.uid()
$$;
grant execute on function public.delete_my_signature() to authenticated;

-- One tap: sign with the saved signature. Same checks as sign_game_form (it IS that call).
create or replace function public.sign_game_form_saved(p_game_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare img text;
begin
  select image into img from saved_signatures where user_id = auth.uid();
  if img is null then raise exception 'no saved signature'; end if;
  perform public.sign_game_form(p_game_id, p_role, img);
end $$;
grant execute on function public.sign_game_form_saved(uuid, text) to authenticated;

-- ---------------------------------------------------------------- reminder
-- Every account that may sign `role` for game `gid` — the same rules as _can_sign_game,
-- turned around (user → roles becomes role → users).
create or replace function public._game_form_signers(gid uuid)
returns table(user_id uuid, role text) language sql stable security definer set search_path = public as $$
  with g as (select * from games where id = gid)
  select o.user_id, 'referee' from game_officials o
   where o.game_id = gid and o.role = 'judge' and o.status in ('assigned', 'approved') and o.user_id is not null
  union
  select pr.id, 'referee' from g join profiles pr on pr.player_id::text = g.referee_id
  union
  select o.user_id, 'medic' from game_officials o
   where o.game_id = gid and o.role = 'medic' and o.status in ('assigned', 'approved') and o.user_id is not null
  union
  select ur.user_id, 'home_coach' from g join user_roles ur on ur.role = 'coach' and ur.team_id = g.home_team_id
  union
  select ur.user_id, 'away_coach' from g join user_roles ur on ur.role = 'coach' and ur.team_id = g.away_team_id
  union
  select pr.id, 'home_captain' from profiles pr where pr.player_id = public.game_captain(gid, 'home')
  union
  select pr.id, 'away_captain' from profiles pr where pr.player_id = public.game_captain(gid, 'away')
$$;

create or replace function public.notify_game_form_sign()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_home text; v_away text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select name into v_home from teams where id = new.home_team_id;
    select name into v_away from teams where id = new.away_team_id;
    insert into notifications (user_id, type, actor_id, entity_type, entity_id, data)
    select s.user_id, 'game_form_sign', null::uuid, 'game', new.id::text,
           jsonb_build_object('home_team', coalesce(v_home, ''), 'away_team', coalesce(v_away, ''),
                              'roles', jsonb_agg(s.role order by s.role))
      from public._game_form_signers(new.id) s
     where s.user_id is not null
       and not exists (select 1 from game_signatures gs where gs.game_id = new.id and gs.role = s.role)
     group by s.user_id;
  end if;
  return null;
-- A reminder must never block finishing a game.
exception when others then return null;
end $$;

-- Name sorts after games_stamp_captains, so the game's captains are stamped first.
drop trigger if exists trg_notify_game_form_sign on public.games;
create trigger trg_notify_game_form_sign
  after update of status on public.games
  for each row execute function public.notify_game_form_sign();

revoke execute on function public._game_form_signers(uuid) from public, anon, authenticated;
revoke execute on function public.notify_game_form_sign() from public, anon, authenticated;
