select cron.unschedule('weather-watch') where exists (select 1 from cron.job where jobname = 'weather-watch');
drop function if exists public.run_weather_watch();
drop function if exists public.weather_alert_recipients(boolean, boolean);
drop function if exists public.admin_weather_recipient_counts();
delete from public.league_settings where key = 'weather';
drop table if exists public.game_weather_checks;
