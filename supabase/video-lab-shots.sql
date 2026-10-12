-- Video lab shot tagging (2026-10-12): /creators "מעבדת וידאו". On any frame of a lab clip an editor
-- tags a SHOT: who took it, where on the rink it came from, where it went in the net, what happened
-- (goal / save / miss / blocked / post) and the keeper's stance. Unlike the ball labels this is
-- scouting data: per-keeper save rate by net zone, per-player shot maps.
--
-- Coordinates (all 0..1, null = not tagged):
--   origin_x/origin_y  half rink seen from above, attacking UP toward the net:
--                      x 0 = left boards, 1 = right boards (shooter's view); y 0 = goal line, 1 = centre line.
--   net_x/net_y        the goal mouth seen from the SHOOTER's side: x 0 = left post, 1 = right post;
--                      y 0 = floor, 1 = crossbar. Only for shots on target (goal / save / post).

create table if not exists public.video_lab_shots (
  id                uuid primary key default gen_random_uuid(),
  clip_id           uuid not null references public.video_lab_clips(id) on delete cascade,
  frame             int  not null check (frame >= 0),
  team_id           uuid references public.teams(id) on delete set null,       -- shooting team
  shooter_id        uuid references public.players(id) on delete set null,
  shooter_number    smallint check (shooter_number between 0 and 999),          -- when the player isn't known
  goalie_id         uuid references public.players(id) on delete set null,
  result            text not null check (result in ('goal','save','miss','blocked','post')),
  shot_type         text check (shot_type in ('wrist','slap','deke','rebound','deflection','free_hit','penalty','backhand')),
  gk_stance         text check (gk_stance in ('standing','kneeling','split','sitting','sprawled','out')),
  origin_x          real check (origin_x between 0 and 1),
  origin_y          real check (origin_y between 0 and 1),
  net_x             real check (net_x between 0 and 1),
  net_y             real check (net_y between 0 and 1),
  screened          boolean not null default false,                             -- keeper's view blocked
  note              text check (char_length(note) <= 500),
  created_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists video_lab_shots_clip_idx on public.video_lab_shots(clip_id, frame);
create index if not exists video_lab_shots_team_idx on public.video_lab_shots(team_id);
create index if not exists video_lab_shots_shooter_idx on public.video_lab_shots(shooter_id);
create index if not exists video_lab_shots_goalie_idx on public.video_lab_shots(goalie_id);
create index if not exists video_lab_shots_created_by_idx on public.video_lab_shots(created_by);

alter table public.video_lab_shots enable row level security;
drop policy if exists "Editors manage video lab shots" on public.video_lab_shots;
create policy "Editors manage video lab shots" on public.video_lab_shots for all
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));
revoke all on public.video_lab_shots from anon;
grant select, insert, update, delete on public.video_lab_shots to authenticated;

drop trigger if exists video_lab_shots_set_updated_at on public.video_lab_shots;
create trigger video_lab_shots_set_updated_at before update on public.video_lab_shots
  for each row execute function public.set_updated_at();
