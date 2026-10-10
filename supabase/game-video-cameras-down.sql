drop index if exists public.game_videos_game_camera_idx;
alter table public.game_videos drop column if exists camera_label, drop column if exists camera_no;
