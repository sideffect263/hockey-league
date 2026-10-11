-- Loaned players: which side a box-score line was played for (2026-10-11).
--
-- A game_stats row put a player on a side by HIS team (players.team_id / player_teams).
-- A player borrowed for one game (יאיר ויזמן, קריית ביאליק → בלג אריות on 10/10) is on
-- neither roster, so his goals landed on no side; the judge typed them on a teammate.
--
-- played_for_team_id = the side he played for, set only when that is not his own team.
-- His goals stay HIS (player page, season totals); the game page and team views place
-- the line on played_for_team_id.
--
-- It is filled automatically from the game's sign-up (game_availability.team_id, the
-- "שחקן בהשאלה" entry a coach adds), so every save path — judge board, admin form,
-- result-from-form — keeps the loan without the client having to know about it, and
-- a re-save cannot drop it.

alter table public.game_stats
  add column if not exists played_for_team_id uuid references public.teams(id) on delete set null;

create or replace function public.game_stats_fill_played_for()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  g record;
  on_side boolean;
begin
  if new.player_id is null then
    new.played_for_team_id := null;
    return new;
  end if;
  select home_team_id, away_team_id into g from public.games where id = new.game_id;
  if not found then return new; end if;

  -- an explicit value must be one of the two sides
  if new.played_for_team_id is not null
     and new.played_for_team_id not in (g.home_team_id, g.away_team_id) then
    new.played_for_team_id := null;
  end if;

  on_side := exists (select 1 from public.players pl
                      where pl.id = new.player_id and pl.team_id in (g.home_team_id, g.away_team_id))
          or exists (select 1 from public.player_teams pt
                      where pt.player_id = new.player_id and pt.team_id in (g.home_team_id, g.away_team_id));

  if on_side then
    -- his own team is playing: no loan, unless one was given explicitly
    return new;
  end if;

  if new.played_for_team_id is null then
    select ga.team_id into new.played_for_team_id
      from public.game_availability ga
     where ga.game_id = new.game_id and ga.player_id = new.player_id
       and ga.team_id in (g.home_team_id, g.away_team_id)
     limit 1;
  end if;
  return new;
end $$;

drop trigger if exists game_stats_fill_played_for on public.game_stats;
create trigger game_stats_fill_played_for
  before insert or update of player_id, played_for_team_id, game_id on public.game_stats
  for each row execute function public.game_stats_fill_played_for();

-- judge board + admin form: pass an optional played_for_team_id through (the trigger
-- still fills it from the sign-up when the client sends none).
create or replace function public.judge_save_game_result(p_game_id uuid, p_home_score integer, p_away_score integer, p_stats jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  g public.games;
  bad int;
begin
  if not (public.is_admin() or public.is_judge()) then raise exception 'not authorized to score games'; end if;
  if p_home_score is null or p_away_score is null or p_home_score < 0 or p_away_score < 0 or p_home_score > 50 or p_away_score > 50 then
    raise exception 'invalid score (must be 0..50)';
  end if;
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'game not found'; end if;
  if g.status = 'completed' then raise exception 'game already completed'; end if;
  select count(*) into bad
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null
    and (
      not exists (select 1 from public.players pl where pl.id = (r->>'player_id')::uuid)
      or coalesce((r->>'goals')::int, 0) < 0 or coalesce((r->>'blue_cards')::int, 0) < 0 or coalesce((r->>'red_cards')::int, 0) < 0
    );
  if bad > 0 then raise exception 'box score has % invalid row(s) (unknown player, or negative count)', bad; end if;
  delete from public.game_stats where game_id = p_game_id;
  insert into public.game_stats (game_id, player_id, goals, blue_cards, red_cards, clean_sheet, played_for_team_id)
  select p_game_id, (r->>'player_id')::uuid,
         coalesce((r->>'goals')::int, 0), coalesce((r->>'blue_cards')::int, 0),
         coalesce((r->>'red_cards')::int, 0), coalesce((r->>'clean_sheet')::boolean, false),
         nullif(r->>'played_for_team_id', '')::uuid
  from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) r
  where (r->>'player_id') is not null;
  update public.games set home_score = p_home_score, away_score = p_away_score, status = 'completed' where id = p_game_id;
  perform public.recompute_team_standings(g.home_team_id);
  perform public.recompute_team_standings(g.away_team_id);
  delete from public.live_game_state where game_id = p_game_id;
end;
$function$;

create or replace function public.save_game_stats(p_game_id uuid, p_stats jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
                                 guest_player_type, played_for_team_id)
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
         case when coalesce((s->>'is_guest_player')::boolean, false) then nullif(s->>'guest_player_type', '') else null end,
         nullif(s->>'played_for_team_id', '')::uuid
    from jsonb_array_elements(coalesce(p_stats, '[]'::jsonb)) s
   where coalesce((s->>'is_guest_player')::boolean, false)
      or nullif(s->>'player_id', '') is not null;
  get diagnostics n = row_count;
  return n;
end $function$;

-- result-from-form: a loaned player was rejected as "not on either team". Accept the
-- side his sign-up names (patched in place; the rest of the function is unchanged).
do $$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.apply_game_form_result(uuid,integer,integer,integer,integer,jsonb,uuid,boolean)'::regprocedure);
  if position('ga_loan' in d) > 0 then return; end if;   -- already patched
  d2 := replace(d,
    'pt.team_id = g.home_team_id) then ''H''',
    'pt.team_id = g.home_team_id)
             or exists (select 1 from public.game_availability ga_loan where ga_loan.game_id = p_game and ga_loan.player_id = (r->>''player_id'')::uuid and ga_loan.team_id = g.home_team_id) then ''H''');
  d2 := replace(d2,
    'pt.team_id = g.away_team_id) then ''A''',
    'pt.team_id = g.away_team_id)
             or exists (select 1 from public.game_availability ga_loan where ga_loan.game_id = p_game and ga_loan.player_id = (r->>''player_id'')::uuid and ga_loan.team_id = g.away_team_id) then ''A''');
  if d2 = d or (length(d2) - length(d)) < 300 then raise exception 'apply_game_form_result patch did not match'; end if;
  execute d2;
end $$;
