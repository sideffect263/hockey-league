-- Rollback for medic-referee-managers.sql
--
-- Functional rollback: every function in that file gates on can_manage_official() and
-- notifies via official_role_manager_ids(). Removing the two roles' rows and narrowing
-- can_manage_official() back to admin / league manager makes each of them behave exactly
-- as before (the extra notification recipients and digest rows simply find nobody).
-- The pre-change bodies are in git history of the files that defined them
-- (officials-*.sql, official-role-requests.sql, game-postpone-reconfirm.sql).

delete from public.user_roles where role in ('medic_manager', 'referee_manager');

create or replace function public.can_manage_official(p_role text default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.is_admin(), false) or coalesce(public.is_league_manager(), false);
$$;

drop policy if exists "Read own official role requests" on public.official_role_requests;
create policy "Read own official role requests" on public.official_role_requests
  for select using (user_id = auth.uid() or public.is_admin() or public.is_league_manager());

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role = any (array[
  'player','coach','content_editor','judge','league_manager','medic','developer']));
