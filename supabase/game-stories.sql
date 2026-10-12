-- Applied LIVE 2026-10-12 (migration game_stories).
--
-- סיפור המשחק: a written story per finished game, so a game page is more than a score.
-- Written by a Claude cloud routine (scripts/game-story/ROUTINE.md) from the box score,
-- the season context and the game's own media (highlight videos → frames, photos), via
-- the token-gated edge fn `game-story`. It lands as a DRAFT; a content editor / admin
-- reviews, edits and publishes it in /creators. Only published stories are public.
create table if not exists public.game_stories (
  game_id uuid primary key references public.games(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'published', 'rejected')),
  title text not null,
  summary text not null,               -- one sentence: meta description + feed/card teaser
  body text not null,                  -- Hebrew paragraphs separated by a blank line
  moments jsonb not null default '[]', -- [{label, text, post_id?}] key moments, optionally tied to a highlight post
  hero_image_url text,                 -- a frame / photo that is really from this game
  media_post_ids uuid[] not null default '{}', -- the game's posts the writer actually looked at
  facts_hash text,                     -- hash of the box score it was written from; changes → stale
  generated_at timestamptz not null default now(),
  generated_by text not null default 'routine',
  edited_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists game_stories_status_idx on public.game_stories (status);
create index if not exists game_stories_edited_by_idx on public.game_stories (edited_by);
create index if not exists game_stories_published_by_idx on public.game_stories (published_by);

alter table public.game_stories enable row level security;

drop policy if exists game_stories_public_read on public.game_stories;
create policy game_stories_public_read on public.game_stories for select
  using (status = 'published' or (select public.is_admin()) or (select public.is_content_editor()));

drop policy if exists game_stories_editor_update on public.game_stories;
create policy game_stories_editor_update on public.game_stories for update to authenticated
  using ((select public.is_admin()) or (select public.is_content_editor()))
  with check ((select public.is_admin()) or (select public.is_content_editor()));

drop policy if exists game_stories_editor_delete on public.game_stories;
create policy game_stories_editor_delete on public.game_stories for delete to authenticated
  using ((select public.is_admin()) or (select public.is_content_editor()));

grant select on public.game_stories to anon, authenticated;
grant update, delete on public.game_stories to authenticated;
-- Inserts come only from the edge function (service role).

-- Publishing stamps who/when on the server so the client can't forge it.
create or replace function public.game_stories_stamp() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if new.status = 'published' and old.status is distinct from 'published' then
      new.published_at := now();
      new.published_by := auth.uid();
    end if;
    if auth.uid() is not null and (new.body, new.title, new.summary) is distinct from (old.body, old.title, old.summary) then
      new.edited_by := auth.uid();
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.game_stories_stamp() from public, anon, authenticated;
drop trigger if exists game_stories_stamp on public.game_stories;
create trigger game_stories_stamp before insert or update on public.game_stories
  for each row execute function public.game_stories_stamp();
