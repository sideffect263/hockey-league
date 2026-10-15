-- Undo stream-requests.sql (redeploy the previous stream-golive first, or fans get 500s).
drop trigger if exists zz_rt_broadcast on public.stream_requests;
drop function if exists public.rt_stream_requests();
drop function if exists public.decide_stream_request(uuid, boolean);
drop table if exists public.stream_requests;
