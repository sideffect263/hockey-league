-- Creators studio (2026-10-19): /creators "סטודיו" — a guided flow for a (non-technical) content creator:
-- pick WHAT to make, pick media from the pool, pick the OUTPUTS (site feed, Instagram, Facebook, TikTok,
-- WhatsApp), get a "kit": the files in each format + a caption per platform to copy. Instagram/Facebook are
-- posted BY HAND by the creator (no Meta API); the site feed is published here (publish_feed_draft).
--
-- A kit is a feed_drafts row with the new columns below (the old columns keep feeding the site post):
--   content_type  goal | goals_summary | round_results | photo_post | game_story | round_preview | game_play
--   outputs       text[] of site | instagram | facebook | tiktok | whatsapp
--   media         [{ source: lab_clip|game_media|post|photo, id, label, start_s?, end_s? }] — what was picked
--   captions      { site?, instagram?, facebook?, tiktok?, whatsapp? } — per-platform text (site = body)
--   assets        { horizontal?: {url, uid?}, vertical?: {url, status}, images?: [url] } — downloadable files
--   brief         free text from the creator (e.g. the game-play description, "what did you see")
--   status        ready | queued | processing | error — queued = waits for the video worker (vertical
--                 render, game play, goals summary); ready = everything in the kit exists
--   image_url     a photo for the site post (photo posts)
-- Additive + idempotent. Undo: supabase/creators-studio-down.sql.

alter table public.feed_drafts
  add column if not exists content_type text check (content_type in
    ('goal','goals_summary','round_results','photo_post','game_story','round_preview','game_play')),
  add column if not exists outputs   text[] not null default array['site']::text[]
    check (outputs <@ array['site','instagram','facebook','tiktok','whatsapp']::text[]),
  add column if not exists media     jsonb not null default '[]'::jsonb,
  add column if not exists captions  jsonb not null default '{}'::jsonb,
  add column if not exists assets    jsonb not null default '{}'::jsonb,
  add column if not exists brief     text check (char_length(brief) <= 2000),
  add column if not exists status    text not null default 'ready'
    check (status in ('ready','queued','processing','error')),
  add column if not exists image_url text check (char_length(image_url) <= 1000);

create index if not exists feed_drafts_status_idx on public.feed_drafts(status, created_at);

-- Publishing now carries the photo too (photo posts). Author stays the league account.
create or replace function public.publish_feed_draft(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.feed_drafts; new_id uuid;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_content_editor()) then
    raise exception 'forbidden';
  end if;
  delete from public.feed_drafts where id = p_id returning * into d;
  if d.id is null then raise exception 'draft_not_found'; end if;
  insert into public.posts (author_id, body, team_id, video_uid, video_cf_code, video_ratio, game_id, image_url)
  values (coalesce(public.league_account_id(), auth.uid()), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio, d.game_id, d.image_url)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.publish_feed_draft(uuid) from public, anon;
grant execute on function public.publish_feed_draft(uuid) to authenticated;
