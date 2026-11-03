-- Rollback for user-roles-granted-by.sql
drop trigger if exists user_roles_granted_by on public.user_roles;
drop function if exists public.trg_user_roles_granted_by();
alter table public.user_roles drop column if exists granted_by;
