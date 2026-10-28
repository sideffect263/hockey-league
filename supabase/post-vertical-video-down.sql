-- rollback of post-vertical-video.sql
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
  insert into public.posts (author_id, body, team_id, video_uid, video_cf_code, video_ratio, game_id, image_url)
  values (coalesce(public.league_account_id(), auth.uid()), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio, d.game_id, d.image_url)
  returning id into new_id;
  return new_id;
end $function$;
alter table public.video_lab_clips drop column if exists vertical_feed_path;
alter table public.feed_drafts drop column if exists vertical_video_uid;
alter table public.posts drop column if exists vertical_video_uid;
