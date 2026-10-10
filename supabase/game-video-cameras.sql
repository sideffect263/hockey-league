-- Multi-camera, phase 1 (2026-10-11): every streamer in a game gets a camera number.
-- stream-golive assigns it (the same person restarting keeps theirs, so a dropped and
-- restarted phone is part 2 of the same camera, not a new angle); stream-replay copies
-- it onto the extra parts it inserts. Clients group a game's videos camera -> parts.
-- A row without camera_no (an uploaded full game) is a camera of its own.
-- Public read like the rest of game_videos: a number and a label, never who streamed.
alter table public.game_videos
  add column if not exists camera_no smallint check (camera_no between 1 and 99),
  add column if not exists camera_label text check (char_length(camera_label) <= 40);

create index if not exists game_videos_game_camera_idx on public.game_videos (game_id, camera_no);

-- Backfill: each existing streamer's broadcasts in a game become one numbered camera,
-- numbered by when they first went live.
with firsts as (
  select game_id, created_by, min(created_at) first_at
  from public.game_videos
  where provider = 'cloudflare' and created_by is not null
  group by game_id, created_by
), numbered as (
  select game_id, created_by, row_number() over (partition by game_id order by first_at)::smallint n
  from firsts
)
update public.game_videos v set camera_no = n.n
from numbered n
where v.game_id = n.game_id and v.created_by = n.created_by
  and v.provider = 'cloudflare' and v.camera_no is null;
