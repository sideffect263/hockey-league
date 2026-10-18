-- ============================================================================
-- Video facts Google needs, kept per Cloudflare Stream uid (2026-10-18).
--
-- Search Console: 7 of 7 feed videos "not indexed — video isn't on a watch page". Two
-- causes: Cloudflare's robots.txt disallows /*iframe$, so the only video URL we gave
-- Google (the player iframe) is one it may not fetch; and the pages said nothing a
-- watch page says — no duration, no file. The token that can ask Cloudflare lives only
-- in the edge function's secrets, so the function writes what it learns here and the
-- crawler pages (api/seo.js, api/sitemap.js) read it with the anon key.
--
--   duration_s / width / height — from GET /stream/<uid>
--   mp4_url / mp4_status        — the default MP4 download (POST /stream/<uid>/downloads;
--                                 free to store, billed only as minutes delivered)
--   chapters                    — [{ name, start_s, end_s }] key moments: the goals of a
--                                 highlight reel (video-analysis/highlight_reel.py writes them)
--
-- Filled by the `video-seo-sync` edge function, every 30 min via pg_cron (below), for
-- every post video and every Cloudflare full-game recording. Additive; down = drop.
-- ============================================================================

create table if not exists public.video_seo_meta (
  uid         text primary key,
  cf_code     text,
  duration_s  numeric,
  width       int,
  height      int,
  mp4_url     text,
  mp4_status  text,           -- inprogress | ready | error
  chapters    jsonb,
  checked_at  timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.video_seo_meta enable row level security;
drop policy if exists "Public read video seo meta" on public.video_seo_meta;
create policy "Public read video seo meta" on public.video_seo_meta for select using (true);
-- No write policies: only the service role (edge function, lab worker) writes.
revoke insert, update, delete, truncate on public.video_seo_meta from anon, authenticated;
grant select on public.video_seo_meta to anon, authenticated;

-- The job. Same vault secret the news ingest sends (the runtime's sb_secret_ key).
create or replace function public.run_video_seo_sync()
returns void language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then
    raise warning 'ingest_service_key missing from vault — skipping video seo sync';
    return;
  end if;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/video-seo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.run_video_seo_sync() from public, anon, authenticated;

select cron.unschedule('video-seo-sync') where exists (select 1 from cron.job where jobname = 'video-seo-sync');
select cron.schedule('video-seo-sync', '*/30 * * * *', 'select public.run_video_seo_sync()');

-- down:
--   select cron.unschedule('video-seo-sync');
--   drop function if exists public.run_video_seo_sync();
--   drop table if exists public.video_seo_meta;
