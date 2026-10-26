-- Undo stream-sweep.sql (then delete the stream-sweep edge function).
select cron.unschedule('stream-sweep') where exists (select 1 from cron.job where jobname = 'stream-sweep');
drop function if exists public.run_stream_sweep();
drop index if exists public.game_videos_cf_video_uniq;
