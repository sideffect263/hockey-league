-- Undo supabase/creators-studio.sql (drops the kit columns; publish goes back to no image_url).
create or replace function public.publish_feed_draft(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.feed_drafts; new_id uuid;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_content_editor()) then
    raise exception 'forbidden';
  end if;
  delete from public.feed_drafts where id = p_id returning * into d;
  if d.id is null then raise exception 'draft_not_found'; end if;
  insert into public.posts (author_id, body, team_id, video_uid, video_cf_code, video_ratio, game_id)
  values (coalesce(public.league_account_id(), auth.uid()), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio, d.game_id)
  returning id into new_id;
  return new_id;
end $$;
drop index if exists public.feed_drafts_status_idx;
alter table public.feed_drafts
  drop column if exists content_type, drop column if exists outputs, drop column if exists media,
  drop column if exists captions, drop column if exists assets, drop column if exists brief,
  drop column if exists status, drop column if exists image_url;
