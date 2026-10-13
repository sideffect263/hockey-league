-- 2026-10-13: the OFFICIAL LEAGUE ACCOUNT. Everything published from /creators (feed drafts → "פרסם") is posted
-- as the league, not as the editor who pressed the button. The account is the existing bot profile (is_bot,
-- news-bot@rinkhockeyil.com — nobody logs into it; news ingest + birthday posts already use it), renamed
-- "ליגת הוקי גלגיליות" with the league emblem. Its profile page exists but no person can edit it.

create or replace function public.league_account_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where is_bot order by created_at limit 1
$$;
revoke all on function public.league_account_id() from public;
grant execute on function public.league_account_id() to authenticated;

update public.profiles
   set display_name = 'ליגת הוקי גלגיליות',
       avatar_url   = 'https://rinkhockeyil.com/icons/icon-512.png'
 where id = public.league_account_id();

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

-- The 14 game-video posts published from /creators on 2026-10-11 under Ariel's own account → the league account.
-- Same posts, same created_at (they keep their place and date in the feed), likes + comments untouched.
update public.posts set author_id = public.league_account_id()
 where id in ('4cb239a2-c6ca-4fa4-821d-5979b3c3b940','60a5db10-1b62-423e-859e-6fa605104f37','b2f67e3e-d17b-4aca-952f-64107ece5886',
              'b21c9a85-5d6c-445d-b141-a5a5bd538f3c','a78e8233-8f9d-4a21-a42f-cdbf54c5548c','61807340-2986-47a8-9dd1-77d3c7eeb8f1',
              'bfb83f76-d04a-4482-83ed-ca670065cc79','63d503ff-6231-4d9d-8748-b3eb1ff8b8e3','4ce840d6-f638-475a-b4ba-d889bbf6cbe9',
              'fff32757-8d29-4b9d-b8db-e7d7e7cfe4e8','c8933c39-5fb1-41bc-9c41-d7abda426444','7af8659b-b483-4235-8fdb-88ccc8a6ec5b',
              '6adb00ed-3e84-4afc-84c0-5ce362e698e3','a7a253c0-05db-4aa6-b0fc-c76a5a193d7c');
