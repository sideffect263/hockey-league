-- developer-role.sql (2026-10-15)
-- Applied to production via MCP as migration `developer_role`.
--
-- A new role, 'developer' (מפתח/ת), granted from /admin like judge. It opens the
-- /devs page: a board of what we are building (video analysis, 3D, AI models…) plus
-- the experimental tools that used to live on /creators.
--
-- Not team-scoped. Admins pass every check without holding the role.

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role = any (array['player','coach','content_editor','judge','league_manager','medic','developer']));

create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'developer'
  )
$$;
grant execute on function public.is_developer() to authenticated;

-- Topics (the catalog lives in code: src/lib/devTopics.js — each topic is wired to its
-- interactive tool). The DB keeps only who joined which topic, and each topic's thread.
-- (A first draft had dev_projects / dev_project_notes; dropped the same day, never used.)
create table if not exists public.dev_topic_members (
  topic_id   text not null check (topic_id ~ '^[a-z0-9_-]{1,60}$'),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (topic_id, user_id)
);
alter table public.dev_topic_members enable row level security;
create policy "dev read members" on public.dev_topic_members for select to authenticated
  using ((select public.is_developer()));
create policy "dev joins self" on public.dev_topic_members for insert to authenticated
  with check ((select public.is_developer()) and user_id = (select auth.uid()));
create policy "dev leaves self" on public.dev_topic_members for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create table if not exists public.dev_topic_notes (
  id         uuid primary key default gen_random_uuid(),
  topic_id   text not null check (topic_id ~ '^[a-z0-9_-]{1,60}$'),
  author_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists dev_topic_notes_topic_idx on public.dev_topic_notes (topic_id, created_at);
alter table public.dev_topic_notes enable row level security;
create policy "dev read notes" on public.dev_topic_notes for select to authenticated
  using ((select public.is_developer()));
create policy "dev writes own notes" on public.dev_topic_notes for insert to authenticated
  with check ((select public.is_developer()) and author_id = (select auth.uid()));
create policy "author or admin deletes note" on public.dev_topic_notes for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));
