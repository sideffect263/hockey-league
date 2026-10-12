-- Undo video-surveys.sql
drop function if exists public.video_survey_results(uuid);
drop table if exists public.video_survey_responses;
drop table if exists public.video_survey_posts;
drop table if exists public.video_surveys;
drop function if exists public.video_survey_open(uuid, uuid);
drop function if exists public.video_surveys_touch();
