-- @-tags of players in posts and comments (web + iOS + Android). Applied live 2026-10-11
-- (migration `player_mentions`), tested in a rolled-back transaction.
--
-- The post/comment body stays PLAIN text ("@בארי אוליאל") so old app versions show a normal
-- name; this table says which player each "@display" points at. Renderers link every
-- "@<display>" occurrence of an active mention to that player's page.
-- Notification type 'tagged' (bell + push; send-push routes it to data.href).
create table if not exists public.mentions (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.players(id) on delete cascade,
  author_id       uuid not null references auth.users(id) on delete cascade,
  post_id         uuid references public.posts(id) on delete cascade,
  comment_id      uuid references public.comments(id) on delete cascade,
  item_comment_id uuid references public.feed_item_comments(id) on delete cascade,
  display         text not null check (char_length(btrim(display)) between 1 and 60),
  removed_at      timestamptz,
  removed_by      uuid,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, item_comment_id) = 1)
);
create unique index if not exists mentions_post_player on public.mentions (post_id, player_id) where post_id is not null;
create unique index if not exists mentions_comment_player on public.mentions (comment_id, player_id) where comment_id is not null;
create unique index if not exists mentions_item_comment_player on public.mentions (item_comment_id, player_id) where item_comment_id is not null;
create index if not exists mentions_player on public.mentions (player_id, created_at desc);

alter table public.mentions enable row level security;
drop policy if exists "Public read active mentions" on public.mentions;
create policy "Public read active mentions" on public.mentions for select
  using (removed_at is null or coalesce(public.is_admin(), false));
-- No insert/update/delete policies: writes go through the RPCs below only.
grant select on public.mentions to anon, authenticated;

-- Where a mention lives → (entity_type, entity_id, href) for the notification and the push tap.
create or replace function public._mention_target(p_post uuid, p_comment uuid, p_item_comment uuid,
  out entity_type text, out entity_id text, out href text, out body text, out author uuid, out deleted boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_key text;
begin
  if p_post is not null then
    select 'post', p.id::text, '/posts/' || p.id, p.body, p.author_id, p.deleted_at is not null
      into entity_type, entity_id, href, body, author, deleted from posts p where p.id = p_post;
  elsif p_comment is not null then
    select 'post', c.post_id::text, '/posts/' || c.post_id, c.body, c.author_id, c.deleted_at is not null
      into entity_type, entity_id, href, body, author, deleted from comments c where c.id = p_comment;
  else
    select 'feed_item', f.item_key, null, f.body, f.author_id, f.deleted_at is not null, f.item_key
      into entity_type, entity_id, href, body, author, deleted, v_key from feed_item_comments f where f.id = p_item_comment;
    -- Synthetic feed cards: a game result opens its game; anything else opens the feed at it.
    href := case when v_key like 'game-%' then '/games/' || substr(v_key, 6) else '/#' || v_key end;
  end if;
end $$;
revoke all on function public._mention_target(uuid, uuid, uuid) from public, anon, authenticated;

-- set_mentions(kind, id, [{player_id, display}]) — call right after creating or editing a
-- post ('post'), a post comment ('comment') or a feed-card comment ('item_comment').
-- Author (or admin / content editor) only. Replaces the active set; a tag the tagged player
-- removed stays removed. Only real players whose "@display" appears in the text are kept.
-- Newly tagged players' linked accounts get a 'tagged' notification (never the author).
create or replace function public.set_mentions(p_kind text, p_id uuid, p_mentions jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  t record;
  m jsonb;
  v_player uuid; v_display text;
  v_keep uuid[] := '{}';
  v_new_id uuid;
  rec record;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_kind not in ('post', 'comment', 'item_comment') then raise exception 'bad kind'; end if;

  select * into t from public._mention_target(
    case when p_kind = 'post' then p_id end,
    case when p_kind = 'comment' then p_id end,
    case when p_kind = 'item_comment' then p_id end);
  if t.author is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if t.deleted then raise exception 'deleted'; end if;
  if t.author <> v_uid and not (coalesce(public.is_admin(), false) or coalesce(public.is_content_editor(), false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_mentions, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_mentions, '[]'::jsonb)) > 20 then
    raise exception 'mentions must be an array of at most 20';
  end if;

  for m in select * from jsonb_array_elements(coalesce(p_mentions, '[]'::jsonb)) loop
    v_player  := nullif(m->>'player_id', '')::uuid;
    v_display := btrim(coalesce(m->>'display', ''));
    continue when v_player is null or char_length(v_display) not between 1 and 60;
    continue when not exists (select 1 from players where id = v_player);
    continue when position('@' || v_display in coalesce(t.body, '')) = 0;
    continue when v_player = any(v_keep);
    v_keep := v_keep || v_player;

    insert into mentions (player_id, author_id, post_id, comment_id, item_comment_id, display)
    values (v_player, v_uid,
            case when p_kind = 'post' then p_id end,
            case when p_kind = 'comment' then p_id end,
            case when p_kind = 'item_comment' then p_id end,
            v_display)
    on conflict do nothing
    returning id into v_new_id;

    if v_new_id is not null then
      for rec in select pr.id as user_id from profiles pr where pr.player_id = v_player and pr.id <> v_uid loop
        perform public.create_notification(rec.user_id, 'tagged', v_uid, t.entity_type, t.entity_id,
          jsonb_build_object('where', case when p_kind = 'post' then 'post' else 'comment' end,
                             'href', t.href,
                             'preview', left(regexp_replace(coalesce(t.body, ''), '\s+', ' ', 'g'), 140)));
      end loop;
    else
      update mentions set display = v_display
       where player_id = v_player and removed_at is null
         and post_id is not distinct from case when p_kind = 'post' then p_id end
         and comment_id is not distinct from case when p_kind = 'comment' then p_id end
         and item_comment_id is not distinct from case when p_kind = 'item_comment' then p_id end;
    end if;
    v_new_id := null;
  end loop;

  delete from mentions
   where removed_at is null and not (player_id = any(v_keep))
     and post_id is not distinct from case when p_kind = 'post' then p_id end
     and comment_id is not distinct from case when p_kind = 'comment' then p_id end
     and item_comment_id is not distinct from case when p_kind = 'item_comment' then p_id end;

  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'player_id', player_id, 'display', display))
                     from mentions
                    where removed_at is null
                      and post_id is not distinct from case when p_kind = 'post' then p_id end
                      and comment_id is not distinct from case when p_kind = 'comment' then p_id end
                      and item_comment_id is not distinct from case when p_kind = 'item_comment' then p_id end),
                  '[]'::jsonb);
end $$;
revoke all on function public.set_mentions(text, uuid, jsonb) from public, anon;
grant execute on function public.set_mentions(text, uuid, jsonb) to authenticated;

-- Untag: the tagged player's own account, the person who tagged, or an admin / content editor.
create or replace function public.remove_mention(p_mention uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); m mentions;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into m from mentions where id = p_mention;
  if m.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (m.author_id = v_uid
          or exists (select 1 from profiles where id = v_uid and player_id = m.player_id)
          or coalesce(public.is_admin(), false) or coalesce(public.is_content_editor(), false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update mentions set removed_at = now(), removed_by = v_uid where id = p_mention and removed_at is null;
end $$;
revoke all on function public.remove_mention(uuid) from public, anon;
grant execute on function public.remove_mention(uuid) to authenticated;

-- "תויג/ה ב…" on a player page: the posts/comments a player is tagged in, newest first.
create or replace function public.player_mentions(p_player uuid, p_limit int default 20)
returns table (mention_id uuid, kind text, created_at timestamptz, href text, preview text,
               author_id uuid, author_name text, author_avatar text)
language sql stable security definer set search_path to 'public' as $$
  select m.id,
         case when m.post_id is not null then 'post' else 'comment' end,
         m.created_at,
         t.href,
         left(regexp_replace(coalesce(t.body, ''), '\s+', ' ', 'g'), 160),
         m.author_id, pr.display_name, pr.avatar_url
    from mentions m
    cross join lateral public._mention_target(m.post_id, m.comment_id, m.item_comment_id) t
    left join profiles pr on pr.id = m.author_id
   where m.player_id = p_player and m.removed_at is null and not coalesce(t.deleted, false)
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
grant execute on function public.player_mentions(uuid, int) to anon, authenticated;
