-- Video lab (2026-10-19): Ariel's new ball look "dark" (black-grey thin ring, NHL-style) + the action-following
-- 9:16 render per clip. Applied via MCP.
alter table public.video_lab_clips drop constraint if exists video_lab_clips_mark_style_check;
alter table public.video_lab_clips add constraint video_lab_clips_mark_style_check
  check (mark_style = any (array['dark'::text, 'paint'::text, 'outline'::text, 'none'::text]));
alter table public.video_lab_clips alter column mark_style set default 'dark';
-- storage path (public bucket video-lab) of the 9:16 version that follows the play; null = none yet
alter table public.video_lab_clips add column if not exists vertical_path text;
-- every clip was re-rendered in the dark look on 2026-10-19 (std_batch.py)
update public.video_lab_clips set mark_style = 'dark' where mark_style = 'paint';
