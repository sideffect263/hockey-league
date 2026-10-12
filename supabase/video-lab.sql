-- Video lab (2026-10-11): /creators "מעבדת וידאו". Editors review a clip frame by frame with the AI's
-- ball track drawn on top, fix it (tap the real ball / "no ball" / goal + strike frame), and queue it
-- for re-render. Labels double as training data for the ball models (video-analysis/ on the Mac).
-- Processing runs OFF-site: video-analysis/lab_worker.py polls this table with the service key.
--
-- Status flow: new (uploaded, waiting for the AI) -> review (AI track ready, humans label)
--              -> queued (re-render requested) -> processing -> done (processed_path updated) -> review again if edited
-- Coordinates are NORMALISED 0..1 of the original clip frame, so any display size works.

create table if not exists public.video_lab_clips (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 1 and 200),
  game_id        uuid references public.games(id) on delete set null,
  source_path    text not null,                 -- video-lab bucket: original clip
  processed_path text,                          -- video-lab bucket: latest render (tint ball + replay)
  fps            real check (fps > 0 and fps <= 240),
  width          int, height int, n_frames int,
  track          jsonb,                         -- AI ball per frame: [x, y, r, kind] (normalised) or null
  goal_frame     int,                           -- frame the ball crosses the line (human)
  strike_frame   int,                           -- frame of the shot (AI guess, human can fix)
  no_replay      boolean not null default false,-- not a goal (handshake, move) -> no slow-mo replay
  status         text not null default 'review' check (status in ('new','review','queued','processing','done','error')),
  worker_note    text check (char_length(worker_note) <= 2000),
  note           text check (char_length(note) <= 1000),
  sort           int not null default 0,
  created_by     uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.video_lab_labels (
  clip_id    uuid not null references public.video_lab_clips(id) on delete cascade,
  frame      int  not null check (frame >= 0),
  kind       text not null check (kind in ('ball','none','unsure')),
  x          real check (x between 0 and 1),
  y          real check (y between 0 and 1),
  labelled_by uuid references auth.users(id) on delete set null default auth.uid(),
  labelled_at timestamptz not null default now(),
  primary key (clip_id, frame),
  check (kind <> 'ball' or (x is not null and y is not null))
);

alter table public.video_lab_clips  enable row level security;
alter table public.video_lab_labels enable row level security;
drop policy if exists "Editors manage video lab clips" on public.video_lab_clips;
create policy "Editors manage video lab clips" on public.video_lab_clips for all
  using (public.is_admin() or public.is_content_editor())
  with check (public.is_admin() or public.is_content_editor());
drop policy if exists "Editors manage video lab labels" on public.video_lab_labels;
create policy "Editors manage video lab labels" on public.video_lab_labels for all
  using (public.is_admin() or public.is_content_editor())
  with check (public.is_admin() or public.is_content_editor());
revoke all on public.video_lab_clips, public.video_lab_labels from anon;
grant select, insert, update, delete on public.video_lab_clips, public.video_lab_labels to authenticated;

drop trigger if exists video_lab_clips_set_updated_at on public.video_lab_clips;
create trigger video_lab_clips_set_updated_at before update on public.video_lab_clips
  for each row execute function public.set_updated_at();

-- Bucket: clips of league games (already public in the feed) -> public read; editors write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('video-lab', 'video-lab', true, 52428800, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

drop policy if exists "video-lab public read" on storage.objects;
create policy "video-lab public read" on storage.objects for select using (bucket_id = 'video-lab');
drop policy if exists "video-lab editors insert" on storage.objects;
create policy "video-lab editors insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'video-lab' and (public.is_admin() or public.is_content_editor()));
drop policy if exists "video-lab editors update" on storage.objects;
create policy "video-lab editors update" on storage.objects for update to authenticated
  using (bucket_id = 'video-lab' and (public.is_admin() or public.is_content_editor()));
drop policy if exists "video-lab editors delete" on storage.objects;
create policy "video-lab editors delete" on storage.objects for delete to authenticated
  using (bucket_id = 'video-lab' and (public.is_admin() or public.is_content_editor()));

-- 2026-10-12: "החלף בפיד" — a lab clip knows its feed post; editors REQUEST a swap (feed_status), the Mac worker
-- (service role) does it: uploads the render to Cloudflare, points posts.video_uid at it, keeps the previous uid for revert.
alter table public.video_lab_clips
  add column if not exists post_id uuid references public.posts(id) on delete set null,
  add column if not exists feed_status text check (feed_status in ('requested','replacing','replaced','revert_requested','reverting','reverted','error')),
  add column if not exists feed_uid text,               -- CF uid currently in the post (set by the worker)
  add column if not exists feed_prev_uid text,          -- what the post showed before -> "החזר את הסרטון הקודם"
  add column if not exists feed_prev_cf text,
  add column if not exists feed_processed_path text,    -- which lab render is in the feed (vs processed_path = newest)
  add column if not exists feed_replaced_at timestamptz,
  add column if not exists feed_note text check (char_length(feed_note) <= 500);
create index if not exists video_lab_clips_post_id_idx on public.video_lab_clips(post_id);

-- 2026-10-12: most clips hold the play AND the broadcast's own zoomed replay of the same goal (a second camera
-- angle after an edit cut). Angle 2 gets its own strike/goal marks; our slow-mo replay is built from it.
-- cuts = frame numbers where the clip switches shot (computed on the Mac), drawn on the editor timeline.
alter table public.video_lab_clips
  add column if not exists goal2_frame int,
  add column if not exists strike2_frame int,
  add column if not exists cuts jsonb;
