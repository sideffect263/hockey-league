-- Video ingest (2026-10-18): /creators "העלאת וידאו" (?tab=ingest). An editor gives a game's footage (a YouTube link,
-- or a file uploaded through the existing game-media-upload -> Cloudflare path), picks the game and the pipelines to
-- run. Processing runs OFF-site: video-analysis/ingest_worker.py (Mac, service role) polls this table, downloads the
-- video into data/ingest/<job_id>/ and runs each chosen pipeline with the existing scripts.
--
-- pipelines (text[]):  goals      הדגשי גולים  -> goal clips in the video lab (video_lab_clips) + feed drafts
--                      reel       תקציר גולים  -> countdown video of the game's goal clips -> feed draft
--                      stats      סטטיסטיקה    -> needs the GPU machine (kookisnooki) + a rink calibration: never run on the Mac
--                      full_video וידאו מלא    -> game_videos row (provider youtube | cloudflare)
--                      story      סיפור המשחק  -> the game story writer (scripts/game-story/ROUTINE.md)
-- steps (jsonb): { "<pipeline>": { "status": queued|processing|done|error|needs_gpu|needs_review|skipped,
--                                  "note": "<Hebrew>", "output": {...links/ids...}, "input": {...editor input...} } }
-- An editor may set a step back to queued (and the job to queued) — e.g. after typing goal times for a
-- needs_review goals step; the worker then runs only the queued steps.
-- Additive + idempotent. Undo: supabase/video-ingest-down.sql.

create table if not exists public.video_ingest_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  source_kind   text not null check (source_kind in ('youtube','upload')),
  source_url    text check (char_length(source_url) <= 500),        -- youtube link
  storage_path  text check (char_length(storage_path) <= 500),      -- upload: 'game_media:<media_id>' (Cloudflare Stream via game-media-upload)
  media_id      uuid references public.game_media(id) on delete set null,  -- upload: the game_media row it created
  game_id       uuid not null references public.games(id) on delete cascade,
  title         text check (char_length(title) <= 200),
  pipelines     text[] not null check (cardinality(pipelines) between 1 and 5
                  and pipelines <@ array['goals','reel','stats','full_video','story']::text[]),
  status        text not null default 'queued'
                  check (status in ('queued','downloading','processing','done','needs_attention','error')),
  steps         jsonb not null default '{}'::jsonb,
  local_path    text check (char_length(local_path) <= 500),        -- the Mac's copy (for hive-transfer to kookisnooki)
  error         text check (char_length(error) <= 2000),
  check ((source_kind = 'youtube' and source_url is not null) or (source_kind = 'upload' and storage_path is not null))
);
create index if not exists video_ingest_jobs_status_idx on public.video_ingest_jobs(status, created_at);
create index if not exists video_ingest_jobs_game_idx on public.video_ingest_jobs(game_id);

-- same pattern as video_lab_* (video-lab.sql / video-lab-reels.sql): editors + admins, nobody else
alter table public.video_ingest_jobs enable row level security;
drop policy if exists "Editors manage video ingest jobs" on public.video_ingest_jobs;
create policy "Editors manage video ingest jobs" on public.video_ingest_jobs for all
  using (public.is_admin() or public.is_content_editor())
  with check (public.is_admin() or public.is_content_editor());
revoke all on public.video_ingest_jobs from anon;
grant select, insert, update, delete on public.video_ingest_jobs to authenticated;

drop trigger if exists video_ingest_jobs_set_updated_at on public.video_ingest_jobs;
create trigger video_ingest_jobs_set_updated_at before update on public.video_ingest_jobs
  for each row execute function public.set_updated_at();
