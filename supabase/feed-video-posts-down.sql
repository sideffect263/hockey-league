drop trigger if exists posts_guard_video on public.posts;
drop function if exists public.guard_post_video();
drop index if exists public.posts_game_id_idx;
alter table public.posts
  drop column if exists video_uid,
  drop column if exists video_cf_code,
  drop column if exists video_ratio,
  drop column if exists game_id;
