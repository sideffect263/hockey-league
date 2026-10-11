-- Down for sandbox-accounts.sql. Restores can_see_test / can_broadcast_game, drops the guard.
-- The demo account's coach role stays on the 🧪 test team (move it back by hand if wanted).
do $$
declare tbl text;
begin
  for tbl in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('drop trigger if exists zz_sandbox_guard on public.%I', tbl);
  end loop;
end $$;

drop function if exists public.sandbox_guard();

create or replace function public.can_see_test()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_admin(), false)
$$;

create or replace function public.can_broadcast_game(p_game_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.can_stream_game(p_game_id)
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.games g
        where g.id = p_game_id
          and g.status <> 'completed'
          and g.game_date > now() - interval '12 hours'
          and g.game_date < now() + interval '6 hours'
          and (not coalesce(g.is_test, false) or public.can_see_test())
      )
    ), false)
$$;

drop function if exists public.is_sandbox_user();
drop table if exists public.sandbox_accounts;
