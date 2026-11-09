-- user_roles.granted_by (2026-11-03) — who gave each role.
--
-- Prompted by ozari.daniel@icloud.com getting league_manager 3 minutes after signing up:
-- the only way to learn who granted it was the edge request log (kept ~1 day). Now the
-- row says it.
--
-- A trigger stamps the caller (auth.uid()) on insert, and on update when role or team
-- changes, so a client can't put someone else's id there. With no JWT (SQL editor,
-- service role, cron) it keeps whatever the statement set, else NULL. SECURITY DEFINER
-- RPCs (approve_claim, review_coach_request, decide_official_role_request…) still run
-- with the caller's JWT, so they stamp the admin who approved.
-- Rows from before today stay NULL = unknown.
--
-- Applied live 2026-11-03. Checked: an admin insert that passes someone else's id in
-- granted_by gets the admin's own id instead.
-- Free-tier cost: one uuid per role row.
-- Rollback: user-roles-granted-by-down.sql

alter table public.user_roles
  add column if not exists granted_by uuid references auth.users(id) on delete set null;

create or replace function public.trg_user_roles_granted_by()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    return new;  -- SQL editor / service role / cron: keep what the statement set
  end if;
  if tg_op = 'INSERT'
     or new.role is distinct from old.role
     or new.team_id is distinct from old.team_id then
    new.granted_by := auth.uid();
  else
    new.granted_by := old.granted_by;
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_granted_by on public.user_roles;
create trigger user_roles_granted_by
  before insert or update on public.user_roles
  for each row execute function public.trg_user_roles_granted_by();

-- The grant that prompted this: Uri Lirman, from /admin, 2026-11-03 18:59 UTC (edge log).
update public.user_roles
   set granted_by = '197600dd-294e-4929-94a6-26e9565ff820'
 where id = '69c14ae6-eee7-444e-9178-fab836805489';
