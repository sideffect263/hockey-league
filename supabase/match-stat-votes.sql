-- Match centre crowd review (2026-10-19). /games/:id/stats lets signed-in users check the video-engine events
-- ("was this really a shot by רמת ישי?") and add ones it missed. Every answer is one row; the engine's accuracy is
-- later re-measured against these rows (video-analysis), and the page shows how many people checked each event.
-- Applied to the live project via MCP on 2026-10-19.

create table if not exists public.match_stat_votes (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  engine text not null default 'v7',
  event_id int,                       -- engine event id in public/match-stats/<game>.json; null = a missed event the user added
  t real not null,                    -- video seconds
  type text,                          -- what the engine claimed (copied, so the row stands on its own)
  team text,
  verdict text not null check (verdict in ('correct', 'wrong', 'unsure', 'missed')),
  actual_type text,                   -- for wrong/missed: what really happened ('nothing' = no event)
  actual_team text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((verdict = 'missed') = (event_id is null))
);
create unique index if not exists match_stat_votes_one_per_user
  on public.match_stat_votes (game_id, engine, event_id, user_id) where event_id is not null;
create index if not exists match_stat_votes_game on public.match_stat_votes (game_id, engine);
create index if not exists match_stat_votes_user on public.match_stat_votes (user_id);

alter table public.match_stat_votes enable row level security;
revoke all on public.match_stat_votes from anon;   -- signed-in only; RLS has no anon policy either

drop policy if exists "match_stat_votes read own or dev" on public.match_stat_votes;
create policy "match_stat_votes read own or dev" on public.match_stat_votes
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_developer()));
drop policy if exists "match_stat_votes insert own" on public.match_stat_votes;
create policy "match_stat_votes insert own" on public.match_stat_votes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "match_stat_votes update own" on public.match_stat_votes;
create policy "match_stat_votes update own" on public.match_stat_votes
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "match_stat_votes delete own" on public.match_stat_votes;
create policy "match_stat_votes delete own" on public.match_stat_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- Per-event tallies for the page ("3 people checked"), without exposing who voted.
create or replace function public.match_stat_vote_counts(p_game uuid, p_engine text default 'v7')
returns table (event_id int, n_correct int, n_wrong int, n_unsure int)
language sql stable security definer set search_path = public as $$
  select v.event_id,
         count(*) filter (where v.verdict = 'correct')::int,
         count(*) filter (where v.verdict = 'wrong')::int,
         count(*) filter (where v.verdict = 'unsure')::int
  from public.match_stat_votes v
  where v.game_id = p_game and v.engine = p_engine and v.event_id is not null
  group by v.event_id
$$;
revoke execute on function public.match_stat_vote_counts(uuid, text) from public, anon;
grant execute on function public.match_stat_vote_counts(uuid, text) to authenticated;
