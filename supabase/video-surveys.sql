-- Video surveys (2026-10-12): ask viewers about an experimental feed video.
--
-- First use: the ball-marked goal clips (thin gold outline around the ball). A signed-in
-- viewer who has WATCHED one of the survey's videos for `trigger_seconds` gets a small card
-- over the player: "how well does the ball marker work? 1-5" + "should it look different?".
--
-- Fully admin-managed from /admin → סקרים: create a survey, write its questions, pick the
-- posts it runs on, start / stop it, read the answers. Nothing here is hardcoded to the
-- ball marker — the next experiment is a new row.
--
-- video_surveys          one survey. status: draft (admins only) | active (shown) | stopped
--                        questions = [{id, type: 'rating'|'text', label, required}]
-- video_survey_posts     which feed posts the survey runs on
-- video_survey_responses one row per (survey, post, user). dismissed=true = the viewer
--                        closed the card without answering — it doesn't come back.

create table if not exists public.video_surveys (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) between 1 and 120),
  badge_label     text not null default 'ניסיוני' check (length(badge_label) <= 40),
  prompt          text not null default '' check (length(prompt) <= 300),
  trigger_seconds int  not null default 4 check (trigger_seconds between 1 and 120),
  questions       jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  status          text not null default 'draft' check (status in ('draft', 'active', 'stopped')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.video_survey_posts (
  survey_id  uuid not null references public.video_surveys(id) on delete cascade,
  post_id    uuid not null references public.posts(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (survey_id, post_id)
);
create index if not exists video_survey_posts_post_idx on public.video_survey_posts (post_id);

create table if not exists public.video_survey_responses (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.video_surveys(id) on delete cascade,
  post_id     uuid not null references public.posts(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  answers     jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  dismissed   boolean not null default false,
  watched_seconds real,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (survey_id, post_id, user_id)
);
create index if not exists video_survey_responses_survey_idx on public.video_survey_responses (survey_id);

create or replace function public.video_surveys_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists video_surveys_touch on public.video_surveys;
create trigger video_surveys_touch before update on public.video_surveys
  for each row execute function public.video_surveys_touch();
drop trigger if exists video_survey_responses_touch on public.video_survey_responses;
create trigger video_survey_responses_touch before update on public.video_survey_responses
  for each row execute function public.video_surveys_touch();

-- A viewer may only answer an ACTIVE survey, on a post that survey runs on, as themself.
create or replace function public.video_survey_open(p_survey uuid, p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from video_surveys s
    join video_survey_posts sp on sp.survey_id = s.id
    where s.id = p_survey and sp.post_id = p_post and s.status = 'active'
  )
$$;
revoke all on function public.video_survey_open(uuid, uuid) from public, anon;
grant execute on function public.video_survey_open(uuid, uuid) to authenticated;

alter table public.video_surveys          enable row level security;
alter table public.video_survey_posts     enable row level security;
alter table public.video_survey_responses enable row level security;

-- Surveys + their posts: signed-in users see ACTIVE ones (that's what the feed needs);
-- admins see and manage everything. Signed-out viewers see nothing → no card.
drop policy if exists video_surveys_read on public.video_surveys;
create policy video_surveys_read on public.video_surveys for select to authenticated
  using (status = 'active' or public.is_admin());
drop policy if exists video_surveys_admin on public.video_surveys;
create policy video_surveys_admin on public.video_surveys for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists video_survey_posts_read on public.video_survey_posts;
create policy video_survey_posts_read on public.video_survey_posts for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.video_surveys s where s.id = survey_id and s.status = 'active'));
drop policy if exists video_survey_posts_admin on public.video_survey_posts;
create policy video_survey_posts_admin on public.video_survey_posts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Responses: you read / write your own while the survey is open; admins read all.
drop policy if exists video_survey_responses_own_read on public.video_survey_responses;
create policy video_survey_responses_own_read on public.video_survey_responses for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists video_survey_responses_own_insert on public.video_survey_responses;
create policy video_survey_responses_own_insert on public.video_survey_responses for insert to authenticated
  with check (user_id = auth.uid() and public.video_survey_open(survey_id, post_id));
drop policy if exists video_survey_responses_own_update on public.video_survey_responses;
create policy video_survey_responses_own_update on public.video_survey_responses for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.video_survey_open(survey_id, post_id));
drop policy if exists video_survey_responses_admin_delete on public.video_survey_responses;
create policy video_survey_responses_admin_delete on public.video_survey_responses for delete to authenticated
  using (public.is_admin());

revoke all on public.video_surveys, public.video_survey_posts, public.video_survey_responses from anon;
grant select, insert, update, delete on public.video_surveys, public.video_survey_posts to authenticated;
grant select, insert, update, delete on public.video_survey_responses to authenticated;

-- Admin results: every response with the viewer's name, newest first.
create or replace function public.video_survey_results(p_survey uuid)
returns table (id uuid, post_id uuid, user_id uuid, display_name text, answers jsonb,
               dismissed boolean, watched_seconds real, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select r.id, r.post_id, r.user_id, p.display_name, r.answers, r.dismissed,
           r.watched_seconds, r.created_at, r.updated_at
    from video_survey_responses r
    left join profiles p on p.id = r.user_id
    where r.survey_id = p_survey
    order by r.updated_at desc;
end $$;
revoke all on function public.video_survey_results(uuid) from public, anon;
grant execute on function public.video_survey_results(uuid) to authenticated;

-- Seed: the first survey — the ball marker, on the 4 posts whose videos carry it
-- (re-rendered by the video lab 2026-10-12, see video-analysis/lab/post_video_rollback.jsonl).
-- Seeded ACTIVE: harmless before the web code ships (nothing else reads these tables), and
-- it lets the dev site show the card straight away. Stop it from /admin → סקרים.
insert into public.video_surveys (id, title, badge_label, prompt, trigger_seconds, questions, status)
values (
  '5b0a11ed-0000-4000-8000-000000000001',
  'סימון כדור — משוב',
  'ניסיוני · סימון כדור',
  'אנחנו מנסים לסמן את הכדור בסרטונים כדי שיהיה קל לעקוב אחריו. נשמח לדעתך!',
  4,
  '[{"id":"rating","type":"rating","label":"כמה טוב עובד סימון הכדור?","required":true},
    {"id":"looks","type":"text","label":"הסימון נראה טוב? כדאי שייראה אחרת?","required":false}]'::jsonb,
  'active'
) on conflict (id) do nothing;

insert into public.video_survey_posts (survey_id, post_id)
select '5b0a11ed-0000-4000-8000-000000000001', p.id from public.posts p
where p.id in ('4ce840d6-f638-475a-b4ba-d889bbf6cbe9', 'c8933c39-5fb1-41bc-9c41-d7abda426444',
               'b21c9a85-5d6c-445d-b141-a5a5bd538f3c', '61807340-2986-47a8-9dd1-77d3c7eeb8f1')
on conflict do nothing;
