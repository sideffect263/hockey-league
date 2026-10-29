-- Creator posting + Instagram → feed sync (2026-10-29).
--
-- The league's content creator asked (1) how to post by himself, (2) whether what he posts on
-- Instagram can show up on the site too. This adds:
--
--   • feed-photos bucket — photo posts from the feed composer (the composer only took text + video).
--     Public read, staff-only write, files under <uid>/… so a writer can only touch his own folder.
--   • create_feed_post() — the composer's insert for staff. Content editors and admins can post AS THE
--     LEAGUE ACCOUNT (as_league = true), same author every /creators publish already uses
--     (league_account_id()). Everyone else posts as himself, exactly like the old direct insert.
--   • instagram_sync — one row per connected Instagram account (Instagram API with Instagram Login:
--     a Business/Creator account, no Facebook Page needed). The token column is never readable by
--     clients: editors read instagram_sync_status (a view without it) and write through
--     instagram_sync_settings(); the token itself is set by the instagram-sync edge function.
--   • instagram-sync cron — every 20 minutes, same vault key as the news ingest.
--
-- Synced items land as feed_drafts (mode 'draft', the default) or straight in posts (mode 'live'),
-- with external_guid = 'ig:<media id>' so a deleted post is never re-imported.
-- Additive + idempotent. Undo: supabase/creator-posting-down.sql.

-- ---- feed-photos bucket -------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feed-photos', 'feed-photos', true, 15 * 1024 * 1024,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Staff upload feed photos" on storage.objects;
create policy "Staff upload feed photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'feed-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (public.is_admin() or public.is_coach() or public.is_content_editor()
         or public.is_judge() or public.is_league_manager())
  );
drop policy if exists "Owner delete feed photos" on storage.objects;
create policy "Owner delete feed photos" on storage.objects for delete to authenticated
  using (bucket_id = 'feed-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---- create_feed_post ---------------------------------------------------------
create or replace function public.create_feed_post(
  p_body text, p_image_url text default null, p_video_uid text default null,
  p_video_cf_code text default null, p_video_ratio real default null,
  p_game_id uuid default null, p_team_id uuid default null, p_as_league boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_author uuid; new_id uuid; editor boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  editor := public.is_admin() or public.is_content_editor();
  if not (editor or public.is_coach() or public.is_judge() or public.is_league_manager()) then
    raise exception 'forbidden';
  end if;
  -- Photos only from our own bucket: a post can't hotlink an arbitrary URL.
  if p_image_url is not null and p_image_url !~ '^https://[a-z0-9.-]+/storage/v1/object/public/feed-photos/' then
    raise exception 'bad_image_url';
  end if;
  v_author := case when p_as_league and editor then coalesce(public.league_account_id(), auth.uid()) else auth.uid() end;
  -- posts_guard_video still applies to the row (video = admins / content editors only).
  insert into public.posts (author_id, body, image_url, video_uid, video_cf_code, video_ratio, game_id, team_id)
  values (v_author, trim(p_body), p_image_url, p_video_uid, p_video_cf_code, p_video_ratio, p_game_id, p_team_id)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.create_feed_post(text, text, text, text, real, uuid, uuid, boolean) from public, anon;
grant execute on function public.create_feed_post(text, text, text, text, real, uuid, uuid, boolean) to authenticated;

-- ---- instagram_sync ------------------------------------------------------------
create table if not exists public.instagram_sync (
  id               uuid primary key default gen_random_uuid(),
  ig_user_id       text not null unique,
  username         text not null,
  access_token     text not null,                -- long-lived (60 days), refreshed by the edge fn
  token_expires_at timestamptz,
  mode             text not null default 'draft' check (mode in ('draft','live','paused')),
  hashtag          text check (hashtag ~ '^[[:alnum:]_֐-׿]{1,60}$'),  -- only posts with #tag (null = all)
  synced_since     timestamptz not null default now(),  -- older posts are never imported
  last_run_at      timestamptz,
  last_error       text,
  imported_count   int not null default 0,
  connected_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
alter table public.instagram_sync enable row level security;
revoke all on public.instagram_sync from anon, authenticated;   -- service role only

create or replace view public.instagram_sync_status with (security_invoker = false) as
  select id, ig_user_id, username, token_expires_at, mode, hashtag, synced_since, last_run_at,
         last_error, imported_count, created_at
  from public.instagram_sync
  where public.is_admin() or public.is_content_editor();
revoke all on public.instagram_sync_status from anon;
grant select on public.instagram_sync_status to authenticated;

create or replace function public.instagram_sync_settings(p_id uuid, p_mode text, p_hashtag text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_content_editor()) then raise exception 'forbidden'; end if;
  update public.instagram_sync
     set mode = p_mode, hashtag = nullif(trim(both '#' from trim(coalesce(p_hashtag, ''))), '')
   where id = p_id;
end $$;
revoke all on function public.instagram_sync_settings(uuid, text, text) from public, anon;
grant execute on function public.instagram_sync_settings(uuid, text, text) to authenticated;

create or replace function public.instagram_sync_disconnect(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_content_editor()) then raise exception 'forbidden'; end if;
  delete from public.instagram_sync where id = p_id;
end $$;
revoke all on function public.instagram_sync_disconnect(uuid) from public, anon;
grant execute on function public.instagram_sync_disconnect(uuid) to authenticated;

-- Drafts remember where they came from, so the studio can label "מאינסטגרם" and a
-- published draft keeps its guid (no re-import after approve).
alter table public.feed_drafts
  add column if not exists external_guid text unique,
  add column if not exists source_link   text check (char_length(source_link) <= 1000);

create or replace function public.publish_feed_draft(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d public.feed_drafts; new_id uuid;
begin
  if auth.uid() is null or not (public.is_admin() or public.is_content_editor()) then
    raise exception 'forbidden';
  end if;
  delete from public.feed_drafts where id = p_id returning * into d;
  if d.id is null then raise exception 'draft_not_found'; end if;
  -- keep vertical_video_uid (post_vertical_video, 10-28): dropping it lost a 9:16 cut on 10-29.
  insert into public.posts (author_id, body, team_id, video_uid, video_cf_code, video_ratio, vertical_video_uid, game_id, image_url, external_guid)
  values (coalesce(public.league_account_id(), auth.uid()), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio,
          d.vertical_video_uid, d.game_id, d.image_url, d.external_guid)
  returning id into new_id;
  return new_id;
end $$;

-- ---- cron ------------------------------------------------------------------------
create or replace function public.run_instagram_sync()
returns void language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if not exists (select 1 from public.instagram_sync where mode <> 'paused') then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ingest_service_key' limit 1;
  if v_key is null then raise warning 'ingest_service_key missing — skipping instagram sync'; return; end if;
  perform net.http_post(
    url     := 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/instagram-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;
revoke execute on function public.run_instagram_sync() from public, anon, authenticated;
select cron.schedule('instagram-sync', '*/20 * * * *', $$select public.run_instagram_sync();$$);
