-- Undo honeypot.sql. Drops the hit log too — export it first if it matters.
drop function if exists public.admin_grant_role(text, text);
drop function if exists public.export_all_users(int);
drop function if exists public.debug_sql(text);
drop function if exists public.reset_admin_password(text);
drop function if exists public._honeypot_record(text, jsonb);
drop table if exists public.honeypot_hits;
