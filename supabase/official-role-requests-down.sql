-- Undo official-role-requests.sql. Judge roles already granted through it stay
-- (they are ordinary user_roles rows; remove them in /admin תפקידים if needed).
drop trigger if exists trg_notify_new_official_role_request on public.official_role_requests;
drop function if exists public.notify_admins_new_official_role_request();
drop function if exists public.decide_official_role_request(uuid, boolean);
drop function if exists public.pending_official_role_requests();
drop function if exists public.cancel_official_role_request();
drop function if exists public.request_official_role(boolean, boolean, text);
drop table if exists public.official_role_requests;
notify pgrst, 'reload schema';
