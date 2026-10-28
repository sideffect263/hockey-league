-- 2026-10-28: every game-clip post carries BOTH cuts. posts.video_uid stays the 16:9 cut (feed, game page, media);
-- vertical_video_uid is the 9:16 action-following cut that the full-screen viewer plays in portrait.
-- Same Cloudflare account as video_uid, so clients reuse posts.video_cf_code. Null = no vertical cut (viewer fits 16:9).
-- Filled by the video worker (video-analysis/vertical_feed.py): lab clips linked to a post (video_lab_clips.post_id +
-- vertical_path) and studio kits (feed_drafts.assets.vertical.url) are uploaded to Cloudflare Stream.
-- Additive only; rollback = post-vertical-video-down.sql.
alter table public.posts add column if not exists vertical_video_uid text
  check (vertical_video_uid ~ '^[0-9a-f]{32}$');   -- pasted into a URL by the clients, like video_uid
alter table public.feed_drafts add column if not exists vertical_video_uid text;
-- which lab vertical render is in the post (vertical_path changes on every re-render → the worker re-uploads)
alter table public.video_lab_clips add column if not exists vertical_feed_path text;

-- publishing a kit carries its vertical cut into the post
create or replace function public.publish_feed_draft(p_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d public.feed_drafts; new_id uuid;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_content_editor()) then
    raise exception 'forbidden';
  end if;
  delete from public.feed_drafts where id = p_id returning * into d;
  if d.id is null then raise exception 'draft_not_found'; end if;
  insert into public.posts (author_id, body, team_id, video_uid, video_cf_code, video_ratio, vertical_video_uid, game_id, image_url)
  values (coalesce(public.league_account_id(), auth.uid()), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio,
          d.vertical_video_uid, d.game_id, d.image_url)
  returning id into new_id;
  return new_id;
end $function$;
