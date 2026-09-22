-- ============================================================================
-- Podium sync — every 6 hours.
--
-- NOT APPLIED YET. Apply this only once a manual run of podium-sync has come back
-- ok:true; until PODIUM_USER / PODIUM_PASS are set as function secrets the job
-- would just log a failed run every six hours.
--
-- Reuses the `ingest_service_key` vault secret created for the news ingest (see
-- external-news-cron.sql) — the same service-role key, the same bearer-token check
-- inside the function.
--
-- To run one by hand:
--   curl -sX POST https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/podium-sync \
--     -H "Authorization: Bearer <service-role key>"
--
-- Every 6h, not hourly: Podium registrations trickle in a few a week, and this
-- makes ~100 requests per run (one per athlete for payments) against somebody
-- else's server. Six hours is well inside "fresh enough to approve a medical on".
-- ============================================================================
create or replace function public.run_podium_sync()
returns void language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then
    raise warning 'ingest_service_key missing from vault — skipping podium sync';
    return;
  end if;

  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/podium-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    -- One login + one athlete list + one payments call per athlete. At ~100
    -- athletes this runs far past net.http_post's 5s default, which would
    -- otherwise look like a silent failure every time (see external-news-cron.sql).
    timeout_milliseconds := 300000
  );
end; $$;

revoke execute on function public.run_podium_sync() from public, anon, authenticated;

-- 02:00 / 08:00 / 14:00 / 20:00 UTC. cron.schedule upserts by name.
select cron.schedule('podium-sync', '0 2,8,14,20 * * *',
                     $$select public.run_podium_sync();$$);

-- ---------- rollback ----------
-- select cron.unschedule('podium-sync');
-- drop function if exists public.run_podium_sync();
