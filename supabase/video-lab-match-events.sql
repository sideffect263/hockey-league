-- Video lab: match-event review (2026-10-13). The match-stats engine (video-analysis/game_events.py) turns a full
-- game video into events (pass, steal, interception, shot + outcome, ...). Each run is uploaded here with its stats;
-- editors review the events against the video (YouTube embed, seek to t) and mark them correct / wrong / unsure,
-- and add events the engine MISSED. Reviewed share per type = precision; added misses = recall. The answers also
-- become training data for the next engine version.

create table if not exists public.video_lab_match_runs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 200),
  game_id      uuid references public.games(id) on delete set null,
  youtube_id   text not null check (youtube_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  engine       text check (char_length(engine) <= 120),                 -- e.g. "game_events v2 / det v2 / rink 01003a45"
  teams        jsonb,                                                   -- {"red": "רמת ישי", "blue": "גבעת עדה נוער"}
  stats        jsonb,                                                   -- per team, as game_events.py writes it
  meta         jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists video_lab_match_runs_game_idx on public.video_lab_match_runs(game_id);

create table if not exists public.video_lab_match_events (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.video_lab_match_runs(id) on delete cascade,
  t             real not null check (t >= 0),                           -- seconds in the YouTube video
  type          text not null check (type ~ '^[a-z_]{2,30}$'),          -- pass | pass_lost | steal | interception | shot | ...
  team          text check (team in ('red', 'blue')),
  data          jsonb,                                                  -- engine details (outcome, len, x/y, speed ...)
  source        text not null default 'engine' check (source in ('engine', 'human')),   -- human = a miss someone added
  verdict       text check (verdict in ('correct', 'wrong', 'unsure')),
  actual_type   text check (actual_type ~ '^[a-z_]{2,30}$'),            -- when wrong: what it really was ('nothing' = no event)
  actual_team   text check (actual_team in ('red', 'blue')),
  note          text check (char_length(note) <= 500),
  reviewed_by   uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists video_lab_match_events_run_idx on public.video_lab_match_events(run_id, t);
create index if not exists video_lab_match_events_reviewed_by_idx on public.video_lab_match_events(reviewed_by);

alter table public.video_lab_match_runs enable row level security;
alter table public.video_lab_match_events enable row level security;
drop policy if exists "Editors manage match runs" on public.video_lab_match_runs;
create policy "Editors manage match runs" on public.video_lab_match_runs for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
drop policy if exists "Editors manage match events" on public.video_lab_match_events;
create policy "Editors manage match events" on public.video_lab_match_events for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
revoke all on public.video_lab_match_runs, public.video_lab_match_events from anon;
grant select, insert, update, delete on public.video_lab_match_runs, public.video_lab_match_events to authenticated;
