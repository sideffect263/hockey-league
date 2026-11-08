select cron.unschedule('weather-watch') where exists (select 1 from cron.job where jobname = 'weather-watch');
drop function if exists public.run_weather_watch();
drop function if exists public.weather_alert_recipients();
drop table if exists public.game_weather_checks;
