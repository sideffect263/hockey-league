-- Deleted recordings stay deleted (2026-10-25).
--
-- stream-sweep (stream-sweep.sql) attaches every finished recording of a recent live input
-- that no game_videos row points at. Deleting a junk part in the control room would leave
-- exactly that, and the next sweep would put it back. A deleted Cloudflare row leaves a
-- tombstone here; the sweep treats tombstoned videos as known. Only the trigger writes.
-- Undo: drop trigger zz_video_tombstone on public.game_videos; drop function
-- public.game_videos_tombstone(); drop table public.game_video_tombstones;

create table if not exists public.game_video_tombstones (
  video_id   text primary key,
  game_id    uuid,
  deleted_at timestamptz not null default now(),
  deleted_by uuid
);
alter table public.game_video_tombstones enable row level security;
revoke all on public.game_video_tombstones from anon, authenticated;

create or replace function public.game_videos_tombstone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.provider = 'cloudflare' and old.video_id is distinct from old.cf_live_input then
    insert into public.game_video_tombstones (video_id, game_id, deleted_by)
    values (old.video_id, old.game_id, auth.uid())
    on conflict (video_id) do nothing;
  end if;
  return old;
end $$;
revoke execute on function public.game_videos_tombstone() from public, anon, authenticated;

drop trigger if exists zz_video_tombstone on public.game_videos;
create trigger zz_video_tombstone after delete on public.game_videos
  for each row execute function public.game_videos_tombstone();
