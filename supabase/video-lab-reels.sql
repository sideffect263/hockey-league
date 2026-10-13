-- 2026-10-13: "תקציר גולים" — /creators → טיוטות לפיד → one button builds a "top 5 goals of the week" reel
-- from the latest game day that has goal clips in the video lab. Editors REQUEST a reel (status queued); the Mac
-- lab_worker picks the goals automatically (shot speed + distance), renders a 9:16 countdown edit (highlight_reel.py),
-- uploads it to Cloudflare Stream and leaves it as a feed DRAFT for review.
create table if not exists public.video_lab_reels (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'queued' check (status in ('queued','processing','done','error')),
  game_day    date,                 -- filled by the worker (latest day with goal clips)
  picks       jsonb,                -- [{rank, clip_id, title, scorer, team, score, ...}] what the worker chose
  draft_id    uuid references public.feed_drafts(id) on delete set null,
  video_path  text,                 -- full-quality mp4 in the video-lab bucket (download for Instagram/TikTok)
  note        text,                 -- worker progress / error text, Hebrew
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.video_lab_reels enable row level security;
drop policy if exists "Editors manage video lab reels" on public.video_lab_reels;
create policy "Editors manage video lab reels" on public.video_lab_reels for all
  using (public.is_admin() or public.is_content_editor())
  with check (public.is_admin() or public.is_content_editor());
revoke all on public.video_lab_reels from anon;
grant select, insert, update, delete on public.video_lab_reels to authenticated;
drop trigger if exists video_lab_reels_set_updated_at on public.video_lab_reels;
create trigger video_lab_reels_set_updated_at before update on public.video_lab_reels
  for each row execute function public.set_updated_at();
