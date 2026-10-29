-- Minors' ages off the public players row — 2026-10-29 (Ariel: yes).
-- players.age is an old hand-typed field the public player list reads (anon can select it,
-- and every client names it in its column list, so revoking the column would 403 the
-- whole list in live apps). Nothing on the server reads it: eligibility comes from
-- birth_date through the signed-in RPCs. So: keep the column, never store an age under 18
-- (or a garbage one) in it. Adults' ages still show.
-- Rollback values (13 rows, ages 12–15 and one "1414"): supabase/hide-minor-ages.rollback.json
create or replace function public.players_hide_minor_age()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.age is not null and (new.age < 18 or new.age >= 100) then
    new.age := null;
  end if;
  return new;
end $$;
revoke all on function public.players_hide_minor_age() from public, anon, authenticated;

drop trigger if exists trg_players_hide_minor_age on public.players;
create trigger trg_players_hide_minor_age
  before insert or update of age on public.players
  for each row execute function public.players_hide_minor_age();

update players set age = null where age is not null and (age < 18 or age >= 100);
