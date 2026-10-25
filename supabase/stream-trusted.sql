-- Staff and known streamers skip the stream request (2026-10-25, Ariel).
--
-- stream-requests.sql made every non-staff go-live a request the admin approves first.
-- At a real game that meant approving the same club people (Uri, a league manager) and
-- the same fans every week. Trusted = league manager or coach, or anyone the admin
-- already approved in any game, or anyone with a camera the admin left visible before.
-- stream-golive asks this with the service role; nothing else may (it reads others' rows).
-- Undo: drop function public.stream_trusted(uuid).

create or replace function public.stream_trusted(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
       exists (select 1 from public.user_roles r
                where r.user_id = p_user and r.role in ('league_manager', 'coach'))
    or exists (select 1 from public.stream_requests s
                where s.user_id = p_user and s.status = 'approved')
    or exists (select 1 from public.game_videos v
                where v.created_by = p_user and v.ingest = 'rtmp'
                  and v.camera_no is not null and not v.hidden),
    false)
$$;
revoke all on function public.stream_trusted(uuid) from public, anon, authenticated;
