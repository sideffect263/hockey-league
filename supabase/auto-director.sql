-- Auto-director (2026-10-12): two (or more) phones, each covering part of the rink, and
-- the server cuts to whichever one has the play — no human director needed.
--
-- Every broadcasting phone with "מעקב אוטומטי" on counts the players inside the rink zone
-- it sees (on-device person detector) and reports that once a second through
-- report_camera_activity(). When the director turned auto_director on (control room),
-- the same call decides the program camera: the camera that had the most players
-- `auto_delay_s` seconds ago (= roughly how far viewers' video lags behind real time, so
-- the cut lands on their screens when the play actually crosses), averaged over 3s, with
-- hysteresis — a challenger needs clearly more players and the last cut must be ≥4s old.
-- The new program_camera_no reaches viewers over realtime like a manual cut.
--
-- auto_cameras = which cameras take part (empty = every approved camera that reports).
-- Hidden (unapproved) cameras never go on air automatically.

alter table public.game_broadcast
  add column if not exists auto_director boolean not null default false,
  add column if not exists auto_delay_s smallint not null default 15
    check (auto_delay_s between 0 and 60),
  add column if not exists auto_cameras smallint[] not null default '{}'
    check (cardinality(auto_cameras) <= 4),
  add column if not exists auto_switched_at timestamptz;

create table if not exists public.game_camera_activity (
  game_id   uuid not null references public.games(id) on delete cascade,
  camera_no smallint not null,
  at        timestamptz not null default now(),
  players   smallint not null check (players between 0 and 60),
  primary key (game_id, camera_no, at)
);
alter table public.game_camera_activity enable row level security;
-- Written only through report_camera_activity (security definer); the control room reads it.
drop policy if exists "Admin reads game_camera_activity" on public.game_camera_activity;
create policy "Admin reads game_camera_activity" on public.game_camera_activity for select
  using ((select public.is_admin()));
grant select on public.game_camera_activity to authenticated;

-- Pure decision step, separated so it can be tested with plain values.
--   cur      = program camera now (null = none)
--   cams     = candidate cameras, avgs = their average players in the window (same order)
--   since_s  = seconds since the last automatic cut (null = never)
-- Returns the camera that should be on air.
create or replace function public.auto_director_pick(cur smallint, cams smallint[], avgs real[], since_s real)
returns smallint language plpgsql immutable as $$
declare
  best smallint; best_avg real := -1; cur_avg real; i int;
begin
  if cams is null or cardinality(cams) = 0 then return cur; end if;
  for i in 1..cardinality(cams) loop
    if avgs[i] > best_avg then best := cams[i]; best_avg := avgs[i]; end if;
    if cams[i] = cur then cur_avg := avgs[i]; end if;
  end loop;
  -- The program camera isn't one of the candidates (stopped, hidden, or nothing chosen yet).
  if cur is null or cur_avg is null then return best; end if;
  if best = cur then return cur; end if;
  if since_s is not null and since_s < 4 then return cur; end if;
  -- A clear majority of the play: at least 1.5 players more AND 30% more.
  if best_avg >= cur_avg + 1.5 and best_avg >= cur_avg * 1.3 then return best; end if;
  return cur;
end $$;

create or replace function public.report_camera_activity(p_video uuid, p_players int)
returns smallint
language plpgsql security definer set search_path = public as $$
declare
  v record; b record; t timestamptz; cams smallint[]; avgs real[]; pick smallint;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- Only the streamer of that camera reports for it.
  select game_id, camera_no, hidden into v from game_videos
    where id = p_video and created_by = auth.uid() and camera_no is not null;
  if not found then raise exception 'not your camera' using errcode = '42501'; end if;

  -- One sample per camera per ~second is plenty (a retry storm can't flood the table).
  if not exists (select 1 from game_camera_activity
                 where game_id = v.game_id and camera_no = v.camera_no and at > now() - interval '800 milliseconds') then
    insert into game_camera_activity (game_id, camera_no, players)
      values (v.game_id, v.camera_no, greatest(0, least(60, coalesce(p_players, 0))));
  end if;
  delete from game_camera_activity where game_id = v.game_id and at < now() - interval '10 minutes';

  select * into b from game_broadcast where game_id = v.game_id;
  if not found or not b.auto_director then return b.program_camera_no; end if;

  t := now() - make_interval(secs => b.auto_delay_s);
  select array_agg(a.camera_no order by a.camera_no), array_agg(a.avg_players order by a.camera_no)
    into cams, avgs
  from (
    select ca.camera_no, avg(ca.players)::real as avg_players
    from game_camera_activity ca
    where ca.game_id = v.game_id
      and ca.at between t - interval '3 seconds' and t
      and (cardinality(b.auto_cameras) = 0 or ca.camera_no = any(b.auto_cameras))
      -- approved cameras only: some part of the camera is visible
      and exists (select 1 from game_videos gv where gv.game_id = v.game_id
                  and gv.camera_no = ca.camera_no and not gv.hidden)
    group by ca.camera_no
  ) a;
  if cams is null then return b.program_camera_no; end if;

  pick := public.auto_director_pick(b.program_camera_no, cams, avgs,
            extract(epoch from now() - b.auto_switched_at)::real);
  if pick is distinct from b.program_camera_no then
    update game_broadcast set program_camera_no = pick, auto_switched_at = now()
      where game_id = v.game_id;
  end if;
  return pick;
end $$;

revoke all on function public.report_camera_activity(uuid, int) from public, anon;
grant execute on function public.report_camera_activity(uuid, int) to authenticated;
