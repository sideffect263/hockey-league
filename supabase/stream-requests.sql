-- Fan streams need the admin's approval BEFORE anything is created on Cloudflare (2026-10-15).
--
-- Before: any signed-in user could press "שדר" around a game and stream-golive minted a billable
-- Cloudflare live input on the spot. The camera was hidden until approved, but Cloudflare was
-- already recording it, and hidden junk cameras counted toward the per-game camera cap.
--
-- Now a non-staff go-live is a REQUEST: stream-golive upserts a row here and refuses (423, which
-- the shipped apps already show as "the admin locked new streams"). Nothing touches Cloudflare.
-- The admin approves in the control room (/games/:id/control). The fan presses again → the
-- stream is created and starts visible. Staff (admin / content editor) are unchanged.
--
-- Writes: only stream-golive (service role) and the admin RPC. Undo: stream-requests-down.sql.

create table if not exists public.stream_requests (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  camera_label text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  attempts     int  not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null,
  unique (game_id, user_id)
);
create index if not exists stream_requests_game_idx on public.stream_requests (game_id, status);
create index if not exists stream_requests_user_idx on public.stream_requests (user_id);
create index if not exists stream_requests_decided_by_idx on public.stream_requests (decided_by);

alter table public.stream_requests enable row level security;
revoke all on public.stream_requests from anon, authenticated;
grant select on public.stream_requests to authenticated;

drop policy if exists "admin + requester read stream_requests" on public.stream_requests;
create policy "admin + requester read stream_requests" on public.stream_requests
  for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

-- Admin: approve / reject. Returns the new status.
create or replace function public.decide_stream_request(p_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'only the admin can approve streams' using errcode = '42501';
  end if;
  update public.stream_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), updated_at = now()
   where id = p_id
  returning status into v_status;
  if v_status is null then raise exception 'request not found' using errcode = 'P0002'; end if;
  return v_status;
end $$;
revoke all on function public.decide_stream_request(uuid, boolean) from public, anon;
grant execute on function public.decide_stream_request(uuid, boolean) to authenticated;

-- The control room listens on video:<game> (realtime-broadcast.sql): a new or changed request
-- pings it, so a request shows up without a reload. Bare ping — the page reads through RLS.
create or replace function public.rt_stream_requests() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.rt_send('video:' || coalesce(new.game_id, old.game_id), 'change', '{}'::jsonb);
  return null;
end $$;
revoke all on function public.rt_stream_requests() from public, anon, authenticated;

drop trigger if exists zz_rt_broadcast on public.stream_requests;
create trigger zz_rt_broadcast after insert or update or delete on public.stream_requests
  for each row execute function public.rt_stream_requests();

-- Admin: delete a request outright (2026-10-24, Ariel: "delete and remove completely").
-- Gone from the control room. If that user presses "שדר" again, stream-golive files a NEW
-- pending request. A stream that is already on air is not touched (that's its camera row).
create or replace function public.delete_stream_request(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'only the admin can delete stream requests' using errcode = '42501';
  end if;
  delete from public.stream_requests where id = p_id;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.delete_stream_request(uuid) from public, anon;
grant execute on function public.delete_stream_request(uuid) to authenticated;
