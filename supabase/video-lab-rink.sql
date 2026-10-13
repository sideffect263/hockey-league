-- Video lab rink points (2026-10-13): /creators "מעבדת וידאו" → "נקודות מגרש".
-- Camera calibration per venue camera. The Mac/kookisnooki side (video-analysis/rink_points.py) fits one
-- rotation-camera model to a pan of the game video and uploads a handful of sharp frames WITH their camera
-- (cam = {K, R}). An editor taps known rink landmarks on them (goal posts at the floor, goal-box corners,
-- centre line ∩ boards…). "חשב מידות" queues a fit: floor plane + rink length/width from the taps, written
-- back to video_lab_rink_sets.fit with a per-point error so wrong taps can be fixed.
-- Result = pixel → metres on the rink for that camera: top-down maps, speeds, floor graphics, better tracking.

create table if not exists public.video_lab_rink_sets (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  venue        text check (char_length(venue) <= 120),
  game_id      uuid references public.games(id) on delete set null,
  source_note  text check (char_length(source_note) <= 500),          -- which video / time range the camera model came from
  status       text not null default 'tagging' check (status in ('tagging','queued','fitting','fitted','error')),
  fit          jsonb,                                                 -- {L, W, rms, points:[{frame_id, landmark, err_m}], ...}
  worker_note  text check (char_length(worker_note) <= 1000),
  fitted_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists video_lab_rink_sets_game_idx on public.video_lab_rink_sets(game_id);

create table if not exists public.video_lab_rink_frames (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.video_lab_rink_sets(id) on delete cascade,
  image_path  text not null,                                          -- public bucket video-lab: rink/<set>/<n>.jpg
  width       int not null check (width > 0),
  height      int not null check (height > 0),
  sort        int not null default 0,
  cam         jsonb,                                                  -- {K:[[...]], R:[[...]]} at this image's resolution
  created_at  timestamptz not null default now()
);
create index if not exists video_lab_rink_frames_set_idx on public.video_lab_rink_frames(set_id, sort);

create table if not exists public.video_lab_rink_points (
  frame_id     uuid not null references public.video_lab_rink_frames(id) on delete cascade,
  landmark     text not null check (landmark ~ '^[A-Za-z0-9_]{1,40}$'),
  x            real not null check (x between 0 and 1),
  y            real not null check (y between 0 and 1),
  labelled_by  uuid references auth.users(id) on delete set null default auth.uid(),
  labelled_at  timestamptz not null default now(),
  primary key (frame_id, landmark)
);
create index if not exists video_lab_rink_points_by_idx on public.video_lab_rink_points(labelled_by);

alter table public.video_lab_rink_sets   enable row level security;
alter table public.video_lab_rink_frames enable row level security;
alter table public.video_lab_rink_points enable row level security;

drop policy if exists "Editors manage rink sets" on public.video_lab_rink_sets;
create policy "Editors manage rink sets" on public.video_lab_rink_sets for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
drop policy if exists "Editors manage rink frames" on public.video_lab_rink_frames;
create policy "Editors manage rink frames" on public.video_lab_rink_frames for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
drop policy if exists "Editors manage rink points" on public.video_lab_rink_points;
create policy "Editors manage rink points" on public.video_lab_rink_points for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));

revoke all on public.video_lab_rink_sets, public.video_lab_rink_frames, public.video_lab_rink_points from anon;
grant select, insert, update, delete on public.video_lab_rink_sets, public.video_lab_rink_frames, public.video_lab_rink_points to authenticated;

drop trigger if exists video_lab_rink_sets_set_updated_at on public.video_lab_rink_sets;
create trigger video_lab_rink_sets_set_updated_at before update on public.video_lab_rink_sets
  for each row execute function public.set_updated_at();

-- The calibration frames are JPEGs in the existing public video-lab bucket (rink/<set>/<n>.jpg).
update storage.buckets set allowed_mime_types = array['video/mp4','video/quicktime','video/webm','image/jpeg'] where id = 'video-lab';
