-- Feed drafts (2026-10-11): posts prepared for review in /creators "טיוטות לפיד" — e.g. the
-- game clips cut by the video pipeline. A SEPARATE table (not a posts.status flag) so a draft
-- can never leak into the feed: web, iOS and Android all read `posts`, and none of them has
-- to learn a new filter. Approve = publish_feed_draft(): inserts the post AS the approver and
-- deletes the draft, atomically.

create table if not exists public.feed_drafts (
  id            uuid primary key default gen_random_uuid(),
  body          text not null check (char_length(body) between 1 and 2000),
  video_uid     text check (video_uid ~ '^[0-9a-f]{32}$'),
  video_cf_code text check (video_cf_code ~ '^[a-z0-9]{8,32}$'),
  video_ratio   real check (video_ratio > 0.2 and video_ratio < 5),
  game_id       uuid references public.games(id) on delete set null,
  team_id       uuid references public.teams(id) on delete set null,
  sort          int not null default 0,          -- suggested posting order
  note          text check (char_length(note) <= 500),  -- reviewer hint, never published
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.feed_drafts enable row level security;
drop policy if exists "Editors manage feed drafts" on public.feed_drafts;
create policy "Editors manage feed drafts" on public.feed_drafts for all
  using (public.is_admin() or public.is_content_editor())
  with check (public.is_admin() or public.is_content_editor());
revoke all on public.feed_drafts from anon;
grant select, insert, update, delete on public.feed_drafts to authenticated;

drop trigger if exists feed_drafts_set_updated_at on public.feed_drafts;
create trigger feed_drafts_set_updated_at before update on public.feed_drafts
  for each row execute function public.set_updated_at();

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
  values (auth.uid(), d.body, d.team_id, d.video_uid, d.video_cf_code, d.video_ratio, d.game_id)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.publish_feed_draft(uuid) from public, anon;
grant execute on function public.publish_feed_draft(uuid) to authenticated;
