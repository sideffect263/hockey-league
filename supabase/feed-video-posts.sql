-- Feed video posts (2026-10-11): admins / content editors upload a clip straight into the
-- feed. The file lives on our Cloudflare Stream account (same as the game recordings);
-- the post row only points at it. Upload URL is minted by the `feed-video-upload` edge fn.
--
-- video_uid      Cloudflare Stream video uid (32 hex)
-- video_cf_code  customer code of the Stream subdomain (customer-<code>.cloudflarestream.com)
-- video_ratio    width / height of the clip (16:9 = 1.778, 9:16 = 0.5625) so the card is
--                sized before the player loads
-- game_id        optional: the game the clip is from (card links to the game page)

alter table public.posts
  add column if not exists video_uid text check (video_uid ~ '^[0-9a-f]{32}$'),
  add column if not exists video_cf_code text check (video_cf_code ~ '^[a-z0-9]{8,32}$'),
  add column if not exists video_ratio real check (video_ratio > 0.2 and video_ratio < 5),
  add column if not exists game_id uuid references public.games(id) on delete set null;

create index if not exists posts_game_id_idx on public.posts (game_id) where game_id is not null;

-- Only admins / content editors may attach (or change) a video. Coaches, judges etc. can
-- still post text; the RLS insert policy stays as it is.
create or replace function public.guard_post_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.video_uid is not null)
     or (tg_op = 'UPDATE' and new.video_uid is distinct from old.video_uid) then
    -- service_role (edge functions) and direct SQL (no JWT) are trusted
    if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is not null
       and not (public.is_admin() or public.is_content_editor()) then
      raise exception 'post_video_forbidden' using hint = 'only admins / content editors can post video';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists posts_guard_video on public.posts;
create trigger posts_guard_video before insert or update on public.posts
  for each row execute function public.guard_post_video();
