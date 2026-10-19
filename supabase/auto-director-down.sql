drop function if exists public.report_camera_activity(uuid, int);
drop function if exists public.auto_director_pick(smallint, smallint[], real[], real);
drop table if exists public.game_camera_activity;
alter table public.game_broadcast
  drop column if exists auto_switched_at,
  drop column if exists auto_cameras,
  drop column if exists auto_delay_s,
  drop column if exists auto_director;
