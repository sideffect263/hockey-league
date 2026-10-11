-- Hidden, switch-on-later features (2026-10-11) — server side. Contract: docs/HIDDEN-FEATURES-SPEC.md
--
-- 1. The switches (feature_review_prompt, review_prompt_min_opens, feature_push_nudge,
--    push_nudge_interval_days, announcement) are plain rows in public.league_settings. Its
--    existing RLS already fits: "Public read settings" (anyone reads), "Admin insert settings" +
--    "Admin update settings" (admin_users e-mail, same test as is_admin()). Upsert = insert +
--    update, so admins can write; anon / non-admins cannot. No policy change here.
--
-- 2. Admin broadcast push: admin_broadcast_notification(title, body, href, audience, dry_run)
--    writes one `notifications` row per recipient (type 'announcement'); the existing
--    trg_notify_push trigger fans each one out through send-push.
--
-- Row shape (what the bell and the apps read):
--   type        = 'announcement'
--   entity_type = 'announcement', entity_id = admin_broadcasts.id (text)
--   actor_id    = the sending admin
--   data        = { "title": "...", "body": "...", "preview": "<same as body>",
--                   "href": "/games" (only when a link was given), "broadcast_id": "<uuid>" }
--
-- Down: drop function public.admin_broadcast_notification(text, text, text, text, boolean);
--       drop table public.admin_broadcasts;

create table if not exists public.admin_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  sent_by     uuid references auth.users(id) on delete set null,
  sent_email  text,
  title       text not null,
  body        text not null,
  href        text,
  audience    text not null,
  recipients  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists admin_broadcasts_created_at_idx on public.admin_broadcasts (created_at desc);
create index if not exists admin_broadcasts_sent_by_idx on public.admin_broadcasts (sent_by);

alter table public.admin_broadcasts enable row level security;
revoke all on public.admin_broadcasts from anon, authenticated;
grant select on public.admin_broadcasts to authenticated;
drop policy if exists "admins read broadcasts" on public.admin_broadcasts;
create policy "admins read broadcasts" on public.admin_broadcasts
  for select to authenticated using (public.is_admin());

-- Sandbox guard, exactly as supabase/sandbox-accounts.sql attaches it to every public table.
drop trigger if exists zz_sandbox_guard on public.admin_broadcasts;
create trigger zz_sandbox_guard before insert or update or delete on public.admin_broadcasts
  for each row execute function public.sandbox_guard();

-- Recipients for an audience. all_users | app_users | team:<uuid>. Bots never.
create or replace function public.admin_broadcast_recipients(p_audience text)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_audience = 'all_users' then
    return query
      select p.id from public.profiles p where not coalesce(p.is_bot, false);

  elsif p_audience = 'app_users' then
    -- same signal the משתמשי אפליקציה tab counts as a native device
    return query
      select distinct s.user_id
        from public.push_subscriptions s
        join public.profiles p on p.id = s.user_id
       where s.platform in ('ios', 'android') and not coalesce(p.is_bot, false);

  elsif p_audience like 'team:%' then
    begin
      v_team := substring(p_audience from 6)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'bad_audience';
    end;
    if not exists (select 1 from public.teams where id = v_team) then
      raise exception using errcode = '22023', message = 'bad_audience';
    end if;
    return query
      select distinct u.uid from (
        -- followers of the team
        select f.user_id as uid from public.follows f
         where f.target_type = 'team' and f.target_id = v_team
        union
        -- the roster's linked accounts (player_teams is the roster truth, team_id its mirror)
        select pr.id from public.profiles pr
          join public.players pl on pl.id = pr.player_id
         where pl.team_id = v_team
            or exists (select 1 from public.player_teams pt
                        where pt.player_id = pl.id and pt.team_id = v_team)
      ) u
      join public.profiles p on p.id = u.uid
     where not coalesce(p.is_bot, false);

  else
    raise exception using errcode = '22023', message = 'bad_audience';
  end if;
end $$;

revoke execute on function public.admin_broadcast_recipients(text) from public, anon;
grant execute on function public.admin_broadcast_recipients(text) to authenticated;

-- Send (or, with p_dry_run, just count). Returns the recipient count.
create or replace function public.admin_broadcast_notification(
  p_title text, p_body text, p_href text, p_audience text, p_dry_run boolean default false)
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_href  text := nullif(btrim(coalesce(p_href, '')), '');
  v_aud   text := btrim(coalesce(p_audience, ''));
  v_id    uuid;
  v_count integer;
  v_data  jsonb;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception using errcode = '22023', message = 'bad_title', detail = 'כותרת: 1–80 תווים';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception using errcode = '22023', message = 'bad_body', detail = 'תוכן: 1–500 תווים';
  end if;
  -- an in-app path only: the apps route it through their link router
  if v_href is not null and (left(v_href, 1) <> '/' or left(v_href, 2) = '//'
                             or char_length(v_href) > 300 or v_href ~ '\s') then
    raise exception using errcode = '22023', message = 'bad_href', detail = 'קישור חייב להיות נתיב באתר, למשל /games';
  end if;

  select count(*)::int into v_count from public.admin_broadcast_recipients(v_aud);
  if p_dry_run then
    return v_count;
  end if;

  -- 3 real broadcasts per hour, league-wide
  perform pg_advisory_xact_lock(hashtext('admin_broadcast_notification'));
  if (select count(*) from public.admin_broadcasts
       where created_at > now() - interval '1 hour') >= 3 then
    raise exception using errcode = 'P0001', message = 'rate_limited', detail = 'אפשר לשלוח עד 3 התראות בשעה';
  end if;

  insert into public.admin_broadcasts (sent_by, sent_email, title, body, href, audience, recipients)
  values (auth.uid(), auth.jwt() ->> 'email', v_title, v_body, v_href, v_aud, v_count)
  returning id into v_id;

  v_data := jsonb_build_object('title', v_title, 'body', v_body, 'preview', v_body,
                               'broadcast_id', v_id::text);
  if v_href is not null then
    v_data := v_data || jsonb_build_object('href', v_href);
  end if;

  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, data)
  select r.user_id, 'announcement', auth.uid(), 'announcement', v_id::text, v_data
    from public.admin_broadcast_recipients(v_aud) r;
  get diagnostics v_count = row_count;

  update public.admin_broadcasts set recipients = v_count where id = v_id;
  return v_count;
end $$;

revoke execute on function public.admin_broadcast_notification(text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_broadcast_notification(text, text, text, text, boolean) to authenticated;
