-- player-photo-submissions.sql
-- Applied to production 2026-11-11 via MCP as migration `player_photo_submissions`.
--
-- A linked player sends his OWN photo for his player card (/cards). Ariel, 2026-11-11:
-- cutouts mined from game video came out soft/back-facing, "if players want their own
-- they will need to send". Flow:
--   1. player uploads a photo to the PRIVATE bucket 'player-photos' ("<player_id>/<file>")
--      and inserts a row here, status 'processing';
--   2. the cutout worker (hockey-photos/photo_cutout_worker.py, service role) removes the
--      background, uploads the PNG to the public 'player-cutouts' bucket and sets
--      status 'ready' + cutout_url (or 'failed' + note);
--   3. an admin approves ('approved', the player's previous approved one → 'replaced') or
--      rejects with a note.
-- The card reads approved ones through approved_player_photos() and prefers them over the
-- album/video cutouts. They are NOT written to player_cutouts, so the Friday poster
-- (weekly-preview), which uses any approved player_cutouts row, never picks them up —
-- including minors' photos.

-- ===== private Storage bucket (originals) =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 15728640,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "player photos upload own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'player-photos'
    and (storage.foldername(name))[1] = public.my_player_id()::text
  );
create policy "player photos read own/admin" on storage.objects
  for select to authenticated using (
    bucket_id = 'player-photos' and (
      (storage.foldername(name))[1] = public.my_player_id()::text
      or public.is_admin()
    )
  );

-- ===== submissions =====
create table if not exists public.player_photo_submissions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  uploaded_by   uuid not null default auth.uid(),
  original_path text not null,
  cutout_url    text,
  status        text not null default 'processing'
                check (status in ('processing','ready','failed','approved','rejected','replaced','withdrawn')),
  note          text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  reviewed_at   timestamptz,
  reviewed_by   uuid
);
create index if not exists player_photo_submissions_player on public.player_photo_submissions (player_id, created_at desc);
create index if not exists player_photo_submissions_open on public.player_photo_submissions (status)
  where status in ('processing','ready');
-- one open submission per player: a new upload withdraws the open one first (withdraw_my_player_photo)
create unique index if not exists player_photo_submissions_one_open
  on public.player_photo_submissions (player_id) where status in ('processing','ready');

alter table public.player_photo_submissions enable row level security;

create policy "player photo subs read own/admin" on public.player_photo_submissions
  for select to authenticated using (player_id = public.my_player_id() or public.is_admin());

create policy "player photo subs insert own" on public.player_photo_submissions
  for insert to authenticated with check (
    player_id = public.my_player_id()
    and uploaded_by = auth.uid()
    and status = 'processing'
    and cutout_url is null
    and split_part(original_path, '/', 1) = player_id::text
  );
-- no UPDATE/DELETE policy: status changes go through the functions below (and the worker,
-- which uses the service role).

-- The player cancels his open submission (or replaces it with a new upload).
create or replace function public.withdraw_my_player_photo()
returns void language sql security definer set search_path = public as $$
  update public.player_photo_submissions
     set status = 'withdrawn'
   where player_id = public.my_player_id() and status in ('processing','ready');
$$;
revoke all on function public.withdraw_my_player_photo() from public, anon;
grant execute on function public.withdraw_my_player_photo() to authenticated;

-- Admin decision. Approving retires the player's previous approved photo.
create or replace function public.review_player_photo(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select player_id into v_player from public.player_photo_submissions
   where id = p_id and status = 'ready' for update;
  if v_player is null then raise exception 'not-ready'; end if;
  if p_approve then
    update public.player_photo_submissions set status = 'replaced'
     where player_id = v_player and status = 'approved';
  end if;
  update public.player_photo_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         note = coalesce(p_note, note), reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_id;
end $$;
revoke all on function public.review_player_photo(uuid, boolean, text) from public, anon;
grant execute on function public.review_player_photo(uuid, boolean, text) to authenticated;

-- What the card needs, readable by anyone: one approved cutout per player.
create or replace function public.approved_player_photos()
returns table (player_id uuid, cutout_url text)
language sql stable security definer set search_path = public as $$
  select distinct on (s.player_id) s.player_id, s.cutout_url
    from public.player_photo_submissions s
   where s.status = 'approved' and s.cutout_url is not null
   order by s.player_id, s.reviewed_at desc nulls last;
$$;
grant execute on function public.approved_player_photos() to anon, authenticated;

-- ---------- rollback ----------
-- drop function if exists public.approved_player_photos();
-- drop function if exists public.review_player_photo(uuid, boolean, text);
-- drop function if exists public.withdraw_my_player_photo();
-- drop table if exists public.player_photo_submissions;
-- drop policy if exists "player photos upload own" on storage.objects;
-- drop policy if exists "player photos read own/admin" on storage.objects;
-- delete from storage.objects where bucket_id = 'player-photos';
-- delete from storage.buckets where id = 'player-photos';
