-- Attach every finished app-stream recording to its game, even if nobody watched (2026-10-24).
--
-- stream-replay only swaps a row when the app or a viewer calls it, so a hidden camera whose
-- app died kept its recording invisible (game 09b5bba8's 58-min video), and a phone that
-- reconnected to the same input after the swap left its next recording with no row.
-- pg_cron calls the stream-sweep edge function every 5 min; see its header.
-- Undo: stream-sweep-down.sql.

-- One row per Cloudflare video, so a sweep racing stream-replay can't attach a recording
-- twice. A row still on its live input holds the input uid, also unique per row.
create unique index if not exists game_videos_cf_video_uniq
  on public.game_videos (video_id) where provider = 'cloudflare';

create or replace function public.run_stream_sweep()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then
    raise warning 'ingest_service_key missing from vault — skipping stream sweep';
    return;
  end if;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/stream-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke execute on function public.run_stream_sweep() from public, anon, authenticated;

select cron.unschedule('stream-sweep') where exists (select 1 from cron.job where jobname = 'stream-sweep');
select cron.schedule('stream-sweep', '*/5 * * * *', 'select public.run_stream_sweep();');
