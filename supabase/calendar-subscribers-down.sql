-- Rollback of calendar-subscribers.sql
drop function if exists public.analytics_calendar(int);
drop function if exists public.log_calendar_fetch(text, text, text);
drop function if exists public.calendar_client(text);
drop table if exists public.calendar_fetches;
drop table if exists public.calendar_fetch_salt;
