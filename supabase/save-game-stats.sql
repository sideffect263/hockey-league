-- save-game-stats.sql  (2026-10-08)
-- ---------------------------------------------------------------------------
-- The games editor (web + both apps) replaced a game's box score as TWO requests:
-- delete every game_stats row, then insert the edited lines. A failure between
-- them (network, a bad row) left the game with NO stats. save_game_stats does
-- both in one transaction: any error rolls the delete back too.
-- Who: admin, league manager, judge (game_stats RLS already lets admin + judge
-- write; managers run the games tab too).
-- p_stats: [{player_id, goals, blue_cards, red_cards, clean_sheet,
--            is_guest_player, guest_player_name, guest_player_original_team,
--            guest_player_type}] — rows with neither a player nor guest are skipped.
-- ---------------------------------------------------------------------------

create or replace function public.save_game_stats(p_game_id uuid, p_stats jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (coalesce(public.is_admin(), false)
          or coalesce(public.is_league_manager(), false)
          or coalesce(public.is_judge(), false)) then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.games where id = p_game_id) then
    raise exception 'game not found';
  end if;
  if jsonb_typeof(coalesce(p_stats, '[]'::jsonb)) <> 'array' then
    raise exception 'stats must be an array';
  end if;

  delete from public.game_stats where game_id = p_game_id;

  insert into public.game_stats (game_id, player_id, goals, blue_cards, red_cards, clean_sheet,
                                 is_guest_player, guest_player_name, guest_player_original_team,
                                 guest_player_type)
  select p_game_id,
         case when coalesce((s->>'is_guest_player')::boolean, false) then null
              else nullif(s->>'player_id', '')::uuid end,
         coalesce((s->>'goals')::int, 0),
         coalesce((s->>'blue_cards')::int, 0),
         coalesce((s->>'red_cards')::int, 0),
         coalesce((s->>'clean_sheet')::boolean, false),
         coalesce((s->>'is_guest_player')::boolean, false),
         case when coalesce((s->>'is_guest_player')::boolean, false) then coalesce(s->>'guest_player_name', '') else '' end,
         case when coalesce((s->>'is_guest_player')::boolean, false) then coalesce(s->>'guest_player_original_team', '') else '' end,
         case when coalesce((s->>'is_guest_player')::boolean, false) then nullif(s->>'guest_player_type', '') else null end
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) s
   where coalesce((s->>'is_guest_player')::boolean, false)
      or nullif(s->>'player_id', '') is not null;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.save_game_stats(uuid, jsonb) from public, anon;
grant execute on function public.save_game_stats(uuid, jsonb) to authenticated;
