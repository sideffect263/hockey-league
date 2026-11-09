-- Rollback of official-role-grant.sql (roles already granted stay).
drop function if exists public.official_role_candidates(text, text);
drop function if exists public.grant_official_role(uuid, text);
drop function if exists public.revoke_official_role(uuid, text);
