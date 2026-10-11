-- teams.captain_player_id: FK → trigger (applied live 2026-10-11).
--
-- The FK from game-form-signing.sql gave PostgREST a SECOND players↔teams relationship, so
-- every embed between them (`players?select=…,team:teams(…)`, `players(…,teams(name))`,
-- `teams?select=…,players(…)`) failed with PGRST201 "more than one relationship". That broke
-- Google's player pages (api/seo.js 503), player link previews (api/og.js) and the medical
-- review queue on web + the LIVE iOS/Android builds — none of which can be re-shipped fast.
-- Dropping the FK restores the single relationship for every client at once; the trigger
-- keeps its `on delete set null` behaviour.

alter table public.teams drop constraint if exists teams_captain_player_id_fkey;

create or replace function public.clear_team_captain_on_player_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.teams set captain_player_id = null where captain_player_id = old.id;
  return old;
end $$;

drop trigger if exists clear_team_captain_on_player_delete on public.players;
create trigger clear_team_captain_on_player_delete
  after delete on public.players
  for each row execute function public.clear_team_captain_on_player_delete();

notify pgrst, 'reload schema';
