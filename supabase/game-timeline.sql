-- Applied LIVE 2026-10-12 (migration game_timeline).
--
-- The evidence-backed game timeline. Three layers:
--   game_events  — WHAT happened, with a source we can point at (the judge's clock, the referee
--                  form, a video moment, an editor). Judge events are captured on EVERY live
--                  broadcast, append-only, with the wall time they were first seen — so a later
--                  save that sends an empty list can no longer erase a game's history (the
--                  10-10 opener lost all of its events that way).
--   game_media   — the footage: stream recordings, coach/official/editor uploads (private raw
--                  material), and clips the Mac pipeline cuts from them (derived, tied to an event).
--   game_stories — the written timeline: beats, each citing its events/media (timeline jsonb),
--                  a pending_revision when new evidence arrives after publishing, and a league-wide
--                  publish mode an admin moves from 'review' → 'verified' → 'auto' in /creators.

-- ── events ────────────────────────────────────────────────────────────────────
create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  kind text not null check (kind in ('goal','blue','red','foul','timeout','break',
    'period_start','period_end','save','chance','celebration','lineup','handshake','moment')),
  side text check (side in ('home','away')),
  player_id uuid references public.players(id) on delete set null,
  player_name text,
  own_goal boolean not null default false,
  period text,                 -- '1' | '2' | 'הארכה 1' … (as the judge engine sends it)
  clock_ms integer,            -- judge clock REMAINING in the period at the event
  wall_at timestamptz,         -- real time it happened (judge: first broadcast that carried it)
  source text not null check (source in ('judge','form','video','editor','box')),
  source_ref text,             -- judge event id / media id / form submission id
  status text not null default 'confirmed' check (status in ('confirmed','candidate','rejected')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, source, source_ref)
);
create index if not exists game_events_game_idx on public.game_events (game_id);
create index if not exists game_events_player_idx on public.game_events (player_id);
create index if not exists game_events_created_by_idx on public.game_events (created_by);

-- Order key, same as _game_event_key on the jsonb (period first, then clock counting DOWN).
create or replace function public.game_event_order(p_period text, p_clock_ms integer)
returns bigint language sql immutable as $$
  select (case p_period when '1' then 1 when '2' then 2 when '3' then 3
            when 'הארכה 1' then 4 when 'הארכה 2' then 5 else 0 end)::bigint * 100000000
         - coalesce(p_clock_ms, 0)
$$;

-- ── who may contribute media / events for a game ─────────────────────────────
-- Both teams' coaches, the game's approved officials, league managers, editors, admins.
create or replace function public.can_contribute_game(p_game_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    public.is_admin() or public.is_content_editor() or public.is_league_manager()
    or exists (select 1 from public.games g where g.id = p_game_id
                and (public.is_coach_of(g.home_team_id) or public.is_coach_of(g.away_team_id)))
    or exists (select 1 from public.game_officials o where o.game_id = p_game_id
                and o.user_id = auth.uid() and o.status = 'approved'),
    false)
$$;
revoke execute on function public.can_contribute_game(uuid) from public;
grant execute on function public.can_contribute_game(uuid) to anon, authenticated;

alter table public.game_events enable row level security;
drop policy if exists game_events_read on public.game_events;
create policy game_events_read on public.game_events for select using (
  (status = 'confirmed' and exists (select 1 from public.games g where g.id = game_id and (not g.is_test or public.can_see_test())))
  or (select public.is_admin()) or (select public.is_content_editor()) or public.can_contribute_game(game_id));
drop policy if exists game_events_editor_write on public.game_events;
create policy game_events_editor_write on public.game_events for all to authenticated
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
grant select on public.game_events to anon, authenticated;
grant insert, update, delete on public.game_events to authenticated;

-- Judge broadcast → game_events. Append-only: an event missing from a later broadcast is only
-- marked 'rejected' (an undo) when it falls INSIDE that broadcast's window — the broadcast keeps
-- the newest 40, so anything older simply scrolled out. Never fails the broadcast.
create or replace function public._capture_live_events() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  win jsonb := new.state->'events';
  win_start bigint;
  g record;
begin
  if win is null or jsonb_typeof(win) <> 'array' or jsonb_array_length(win) = 0 then
    return new;
  end if;
  select home_team_id, away_team_id into g from public.games where id = new.game_id;

  insert into public.game_events (game_id, kind, side, player_id, player_name, own_goal, period, clock_ms, wall_at, source, source_ref, status)
  select new.game_id,
         case e->>'type' when 'goal' then 'goal' when 'blue' then 'blue' when 'red' then 'red'
              when 'foul' then 'foul' when 'timeout' then 'timeout' else 'break' end,
         nullif(e->>'side', ''),
         (select p.id from public.players p
           where trim(p.first_name || ' ' || p.last_name) = trim(e->>'player')
             and (p.team_id = case e->>'side' when 'home' then g.home_team_id else g.away_team_id end
                  or exists (select 1 from public.player_teams pt where pt.player_id = p.id
                              and pt.team_id = case e->>'side' when 'home' then g.home_team_id else g.away_team_id end))
           limit 1),
         nullif(e->>'player', ''),
         coalesce((e->>'ownGoal')::boolean, false),
         e->>'period',
         nullif(e->>'timeMS', '')::integer,
         now(), 'judge', e->>'id', 'confirmed'
    from jsonb_array_elements(win) e
   where e->>'id' is not null
  on conflict (game_id, source, source_ref) do update
     set kind = excluded.kind, side = excluded.side,
         player_id = coalesce(excluded.player_id, game_events.player_id),
         player_name = excluded.player_name, own_goal = excluded.own_goal,
         period = excluded.period, clock_ms = excluded.clock_ms,
         status = 'confirmed', updated_at = now();          -- wall_at keeps the FIRST sighting

  select min(public._game_event_key(e)) into win_start from jsonb_array_elements(win) e;
  update public.game_events ev set status = 'rejected', updated_at = now()
   where ev.game_id = new.game_id and ev.source = 'judge' and ev.status = 'confirmed'
     and public.game_event_order(ev.period, ev.clock_ms) >= win_start
     and not exists (select 1 from jsonb_array_elements(win) w where w->>'id' = ev.source_ref);
  return new;
exception when others then
  return new;
end $$;
revoke execute on function public._capture_live_events() from public, anon, authenticated;
drop trigger if exists live_game_state_capture_events on public.live_game_state;
create trigger live_game_state_capture_events after insert or update of state on public.live_game_state
  for each row execute function public._capture_live_events();

-- ── media ─────────────────────────────────────────────────────────────────────
create table if not exists public.game_media (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  kind text not null check (kind in ('video','image')),
  origin text not null check (origin in ('upload','recording','post','derived')),
  cf_uid text, cf_code text,           -- Cloudflare Stream video
  storage_path text,                   -- image in the private `game-media` bucket
  parent_id uuid references public.game_media(id) on delete cascade,   -- derived clip ← its source
  game_video_id uuid references public.game_videos(id) on delete set null,
  post_id uuid references public.posts(id) on delete set null,
  event_id uuid references public.game_events(id) on delete set null,  -- the moment this clip shows
  clip_start_s real, clip_end_s real,  -- position inside the parent
  title text, note text,
  recorded_at timestamptz,             -- wall time of the first frame, when known
  duration_s real, width integer, height integer,
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','error')),
  analysis jsonb not null default '{}', -- the Mac worker's findings (moments, frames, sound peaks)
  worker_note text,
  is_public boolean not null default false,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists game_media_game_idx on public.game_media (game_id);
create index if not exists game_media_parent_idx on public.game_media (parent_id);
create index if not exists game_media_event_idx on public.game_media (event_id);
create index if not exists game_media_post_idx on public.game_media (post_id);
create index if not exists game_media_video_idx on public.game_media (game_video_id);
create index if not exists game_media_uploader_idx on public.game_media (uploaded_by);
create index if not exists game_media_status_idx on public.game_media (status);
alter table public.game_media add constraint game_media_game_video_uniq unique (game_video_id);  -- one row per recording
alter table public.game_media add constraint game_media_post_uniq unique (post_id);              -- one row per post

alter table public.game_media enable row level security;
drop policy if exists game_media_read on public.game_media;
create policy game_media_read on public.game_media for select using (
  is_public or public.can_contribute_game(game_id) or uploaded_by = (select auth.uid()));
drop policy if exists game_media_insert on public.game_media;
create policy game_media_insert on public.game_media for insert to authenticated with check (
  origin = 'upload' and uploaded_by = (select auth.uid()) and is_public = false and status = 'uploaded'
  and public.can_contribute_game(game_id));
drop policy if exists game_media_update on public.game_media;
create policy game_media_update on public.game_media for update to authenticated
  using ((select public.is_admin()) or (select public.is_content_editor()) or (uploaded_by = (select auth.uid()) and origin = 'upload'))
  with check ((select public.is_admin()) or (select public.is_content_editor()) or (uploaded_by = (select auth.uid()) and origin = 'upload' and is_public = false));
drop policy if exists game_media_delete on public.game_media;
create policy game_media_delete on public.game_media for delete to authenticated
  using ((select public.is_admin()) or (select public.is_content_editor()) or (uploaded_by = (select auth.uid()) and origin = 'upload'));
grant select on public.game_media to anon, authenticated;
grant insert, update, delete on public.game_media to authenticated;

-- Private bucket for uploaded photos (videos go to Cloudflare Stream). Path: <game_id>/<uuid>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-media', 'game-media', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;
drop policy if exists game_media_obj_insert on storage.objects;
create policy game_media_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'game-media' and public.can_contribute_game(((storage.foldername(name))[1])::uuid));
drop policy if exists game_media_obj_read on storage.objects;
create policy game_media_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'game-media' and public.can_contribute_game(((storage.foldername(name))[1])::uuid));

-- ── stories: timeline + revisions + publish mode ─────────────────────────────
alter table public.game_stories add column if not exists timeline jsonb not null default '[]';
alter table public.game_stories add column if not exists pending_revision jsonb;   -- a newer version waiting for review
alter table public.game_stories add column if not exists version integer not null default 1;
alter table public.game_stories add column if not exists auto_published boolean not null default false;

-- 'review' (an editor approves everything) → 'verified' (beats that cite hard evidence publish
-- by themselves) → 'auto' (everything publishes; editors fix afterwards). Admin-only switch.
insert into public.league_settings (key, value) values ('game_story_publish_mode', 'review')
on conflict (key) do nothing;
-- game_media has a public copy for images (worker-made, unguessable path in a public bucket).
alter table public.game_media add column if not exists public_url text;

-- Media a story cites (timeline[].media[].media_id + hero_media_id) — used to make exactly
-- that footage public when the story is published, and nothing else.
create or replace function public.story_media_ids(p_timeline jsonb, p_hero text)
returns uuid[] language sql immutable as $$
  select coalesce(array_agg(distinct x::uuid), '{}') from (
    select m->>'media_id' x from jsonb_array_elements(coalesce(p_timeline, '[]')) b,
         jsonb_array_elements(coalesce(b->'media', '[]')) m
     where m->>'media_id' ~* '^[0-9a-f-]{36}$'
    union all select p_hero where p_hero ~* '^[0-9a-f-]{36}$'
  ) s
$$;

alter table public.game_stories add column if not exists hero_media_id uuid references public.game_media(id) on delete set null;
create index if not exists game_stories_hero_media_idx on public.game_stories (hero_media_id);

-- On publish: the cited media go public (raw uploads were "private until used").
create or replace function public.game_stories_publish_media() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'published' then
    update public.game_media set is_public = true, updated_at = now()
     where game_id = new.game_id and not is_public
       and id = any(public.story_media_ids(new.timeline, new.hero_media_id::text));
  end if;
  return new;
end $$;
revoke execute on function public.game_stories_publish_media() from public, anon, authenticated;
drop trigger if exists game_stories_publish_media on public.game_stories;
create trigger game_stories_publish_media after insert or update of status, timeline, hero_media_id on public.game_stories
  for each row execute function public.game_stories_publish_media();

-- An editor approves the newer version the pipeline wrote after the story was already live.
create or replace function public.approve_story_revision(p_game_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not (public.is_admin() or public.is_content_editor()) then raise exception 'forbidden'; end if;
  select pending_revision into r from public.game_stories where game_id = p_game_id for update;
  if r is null then raise exception 'no pending revision'; end if;
  update public.game_stories set
    title = r->>'title', summary = r->>'summary', body = r->>'body',
    timeline = coalesce(r->'timeline', '[]'), hero_image_url = r->>'hero_image_url',
    hero_media_id = nullif(r->>'hero_media_id', '')::uuid,
    facts_hash = r->>'facts_hash', version = version + 1, pending_revision = null,
    generated_at = coalesce((r->>'generated_at')::timestamptz, now()), status = 'published', auto_published = false
  where game_id = p_game_id;
end $$;
revoke execute on function public.approve_story_revision(uuid) from public, anon;
grant execute on function public.approve_story_revision(uuid) to authenticated;

-- Uploaders (and editors/admins) can delete an uploaded photo file.
drop policy if exists game_media_obj_delete on storage.objects;
create policy game_media_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'game-media' and (owner = (select auth.uid()) or (select public.is_admin()) or (select public.is_content_editor())));
