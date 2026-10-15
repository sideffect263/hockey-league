-- Undo realtime-private-user.sql. Redeployed clients lose live bell/DM updates (they still
-- refresh on window focus) until they go back to postgres_changes; old clients are unaffected.
drop policy if exists "rt user topic: own only" on realtime.messages;
drop trigger if exists zz_rt_private on public.notifications;
drop trigger if exists zz_rt_private on public.direct_messages;
drop function if exists public.rt_notifications();
drop function if exists public.rt_direct_messages();
drop function if exists public.rt_send_private(text, text, jsonb);
