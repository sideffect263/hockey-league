-- 2026-10-09
-- 1) game_availability_for_official_batch now also returns team_id: the side a player was
--    MANUALLY added for (a loan / youth call-up). The judge page counted arrivals by
--    players.team_id only, so יאיר ויזמן (בלג נוער, added to בלג אריות) was counted for
--    the wrong side: 7/5 instead of 6/6. Extra column is ignored by shipped apps.
drop function if exists public.game_availability_for_official_batch(uuid[]);
create function public.game_availability_for_official_batch(p_game_ids uuid[])
returns table(game_id uuid, player_id uuid, status text, team_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select ga.game_id, ga.player_id, ga.status, ga.team_id
  from public.game_availability ga
  where ga.game_id = any(p_game_ids)
    and (public.is_admin() or public.is_judge())
$$;
grant execute on function public.game_availability_for_official_batch(uuid[]) to authenticated;

-- 2) Public names of a game's confirmed officials (judge AND medic) for the game page.
--    Names only — phones stay in the admin/LM game_officials_contact.
create or replace function public.game_officials_public(p_game_ids uuid[])
returns table(game_id uuid, role text, user_id uuid, name text, player_slug text)
language sql stable security definer set search_path = public as $$
  select go.game_id, go.role, go.user_id,
         coalesce(nullif(btrim(pl.first_name || ' ' || coalesce(pl.last_name,'')), ''),
                  case when uc.full_name ~ '[[:alpha:]א-ת]' then btrim(uc.full_name) end,
                  pr.display_name),
         pl.slug
    from public.game_officials go
    join public.games g on g.id = go.game_id
    left join public.profiles pr on pr.id = go.user_id
    left join public.players pl on pl.id = pr.player_id
    left join public.user_contact uc on uc.user_id = go.user_id
   where go.game_id = any(p_game_ids)
     and go.status in ('approved','assigned')
     and (not coalesce(g.is_test, false) or public.can_see_test())
   order by go.game_id, go.role, go.reviewed_at nulls last, go.created_at;
$$;
grant execute on function public.game_officials_public(uuid[]) to anon, authenticated;
