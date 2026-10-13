-- Video lab: 3D scene replays (2026-10-13). video-analysis/scene3d/export_scene.py turns a window of a game video into
-- a scene (players + ball in rink metres, engine events, rink size) and upload_scene.py stores it here. The /creators
-- tab "שחזור תלת-ממד" renders it with Three.js next to the YouTube video, synced. `meta` records exactly which models,
-- video and calibration produced the scene, so an old scene can be compared with one from a newer engine.

create table if not exists public.video_lab_scenes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  game_id      uuid references public.games(id) on delete set null,
  youtube_id   text not null check (youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  t0           real not null check (t0 >= 0),                         -- scene start, seconds in the YouTube video
  dur          real not null check (dur > 0 and dur <= 600),
  score        jsonb,                                                 -- {"red": 1, "blue": 2} at t0
  scene        jsonb not null,                                        -- export_scene.py output (players, ball, events, rink)
  meta         jsonb,                                                 -- engine versions + video standard
  created_at   timestamptz not null default now()
);
create index if not exists video_lab_scenes_game_idx on public.video_lab_scenes(game_id);

alter table public.video_lab_scenes enable row level security;
drop policy if exists "Editors manage scenes" on public.video_lab_scenes;
create policy "Editors manage scenes" on public.video_lab_scenes for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
revoke all on public.video_lab_scenes from anon;
grant select, insert, update, delete on public.video_lab_scenes to authenticated;
