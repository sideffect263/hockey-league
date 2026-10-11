-- player_cards(): one call that gives every surface what it needs to draw a player
-- like the web does — the paired account's uploaded avatar + the PUBLIC role badges.
--
-- Why: players.photo_url is empty for every player; the only real faces are
-- profiles.avatar_url of the claimed accounts. Native apps never joined that, so every
-- roster / stats / game surface showed initials, and nobody's roles were visible.
--
-- Same public role set as public_role_badges (role-badges.sql): admin + coach /
-- content_editor / judge. league_manager, medic and plain 'player' stay private.
-- Only rows for players that HAVE a linked account with an avatar or a badge.

create or replace function public.player_cards()
returns table(player_id uuid, avatar_url text, is_admin boolean, roles jsonb)
language sql
stable
security definer
set search_path to 'public'
as $$
  with linked as (
    select pr.player_id, pr.id as user_id, pr.avatar_url, u.email
      from public.profiles pr
      join auth.users u on u.id = pr.id
     where pr.player_id is not null
  )
  select
    l.player_id,
    (array_agg(l.avatar_url order by l.avatar_url) filter (where l.avatar_url is not null))[1] as avatar_url,
    bool_or(l.email in (select a.email from public.admin_users a)) as is_admin,
    coalesce(
      (select jsonb_agg(distinct jsonb_build_object('role', ur.role, 'team_id', ur.team_id))
         from public.user_roles ur
        where ur.user_id in (select l2.user_id from linked l2 where l2.player_id = l.player_id)
          and ur.role in ('coach', 'content_editor', 'judge')),
      '[]'::jsonb
    ) as roles
  from linked l
  group by l.player_id
$$;

revoke all on function public.player_cards() from public;
grant execute on function public.player_cards() to anon, authenticated;
