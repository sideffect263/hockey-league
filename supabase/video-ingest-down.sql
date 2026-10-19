-- Undo supabase/video-ingest.sql (drops the job list only; lab clips, drafts, game_videos it created stay).
drop table if exists public.video_ingest_jobs;
