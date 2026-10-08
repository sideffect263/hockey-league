-- Feed analytics (2026-10-08) — the /admin "ניתוח פיד" tab.
--
-- Answers "is anyone using the feed, and which content works?". AGGREGATES ONLY: no row
-- in the result names a user. feed_impressions stays private per feed-personalization.sql
-- (a viewer reads only their own rows); this SECURITY DEFINER function folds them into
-- totals for admins and returns nothing per person.
--
-- Two sources, with different coverage — the tab says so on screen:
--   app_events (kind=page, path '/' or '/feed')  REACH: every visitor, web + iOS + Android,
--                                                guests included.
--   feed_impressions                             DEPTH: which cards were on screen, how long,
--                                                tapped. Signed-in WEB viewers only until the
--                                                native apps ship their impression logging.
--
-- Free-tier cost: nothing stored, reads existing tables.
-- Rollback: drop function public.analytics_feed(int);

create or replace function public.analytics_feed(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d int := greatest(1, least(coalesce(p_days, 30), 90));
  since timestamptz := date_trunc('day', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem' - make_interval(days => d - 1);
  result jsonb;
begin
  if not public.is_admin() then raise exception 'not_authorized'; end if;

  with pages as (
    select coalesce(e.user_id::text, 's:' || e.session_id) who, e.user_id, e.platform,
           e.path in ('/', '/feed') is_feed,
           (e.created_at at time zone 'Asia/Jerusalem')::date as day
      from public.app_events e
     where e.kind = 'page' and e.created_at >= since
  ),
  feedp as (select * from pages where is_feed),
  -- One row per (viewer, item) looked at in the window, classified.
  imp as (
    select fi.user_id, fi.item_key, fi.view_count, fi.dwell_ms, fi.open_count,
           po.id post_id, po.source_name, po.created_at published_at,
           left(split_part(coalesce(po.body, ''), E'\n', 1), 140) title,
           (po.link_url ~* '(youtube\.com|youtu\.be)') is_video,
           case
             when fi.item_key like 'post-%' and coalesce(pr.is_bot, false) then 'news'
             when fi.item_key like 'post-%' then 'post'
             when fi.item_key like 'game-%' then 'game'
             when fi.item_key like 'ms-%' then 'goal'
             else split_part(fi.item_key, '-', 1)
           end item_type
      from public.feed_impressions fi
      left join public.posts po on fi.item_key = 'post-' || po.id::text
      left join public.profiles pr on pr.id = po.author_id
     where fi.last_seen_at >= since
  ),
  likes as (
    select 'post-' || post_id::text item_key, count(*) n from public.post_likes where created_at >= since group by 1
    union all
    select item_key, count(*) from public.feed_item_likes where created_at >= since group by 1
  ),
  cmts as (
    select 'post-' || post_id::text item_key, count(*) n from public.comments
     where deleted_at is null and post_id is not null and created_at >= since group by 1
    union all
    select item_key, count(*) from public.feed_item_comments where deleted_at is null and created_at >= since group by 1
  ),
  items as (
    select i.item_key, min(i.item_type) item_type, min(i.source_name) source_name, min(i.title) title,
           bool_or(i.is_video) is_video, min(i.published_at) published_at,
           count(distinct i.user_id) viewers, sum(i.view_count) views,
           percentile_cont(0.5) within group (order by i.dwell_ms) median_dwell_ms,
           count(*) filter (where i.dwell_ms >= 5000) engaged_viewers,
           sum(i.open_count) opens,
           coalesce((select sum(n) from likes l where l.item_key = i.item_key), 0) likes,
           coalesce((select sum(n) from cmts c where c.item_key = i.item_key), 0) comments
      from imp i group by i.item_key
  )
  select jsonb_build_object(
    'days', d,
    'reach', jsonb_build_object(
      'site_visitors',   (select count(distinct who) from pages),
      'feed_visitors',   (select count(distinct who) from feedp),
      'feed_signed_in',  (select count(distinct user_id) from feedp),
      'feed_guests',     (select count(distinct who) from feedp where user_id is null),
      'feed_page_views', (select count(*) from feedp),
      'returning',       (select count(*) from (select who from feedp group by who having count(distinct day) >= 2) r),
      'by_platform',     coalesce((select jsonb_agg(x order by x.visitors desc) from (
                            select platform, count(distinct who) visitors, count(*) views,
                                   count(distinct user_id) signed_in
                              from feedp group by platform) x), '[]')
    ),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (
        select dd.dt::date as day,
               (select count(distinct who) from feedp f where f.day = dd.dt::date) visitors,
               (select count(distinct who) from feedp f where f.day = dd.dt::date and f.platform = 'web') web,
               (select count(distinct who) from feedp f where f.day = dd.dt::date and f.platform = 'ios') ios,
               (select count(distinct who) from feedp f where f.day = dd.dt::date and f.platform = 'android') android
          from generate_series((since at time zone 'Asia/Jerusalem')::date, (now() at time zone 'Asia/Jerusalem')::date, '1 day') dd(dt)
      ) x), '[]'),
    'depth', jsonb_build_object(
      'tracked_viewers', (select count(distinct user_id) from imp),
      'items_seen',      (select count(*) from items),
      'card_views',      (select coalesce(sum(view_count), 0) from imp),
      'median_dwell_ms', (select percentile_cont(0.5) within group (order by dwell_ms) from imp),
      'opens',           (select coalesce(sum(open_count), 0) from imp),
      'likes',           (select coalesce(sum(likes), 0) from items),
      'comments',        (select coalesce(sum(comments), 0) from items),
      -- How far down a viewer scrolls: cards seen per viewer, bucketed.
      'scroll', coalesce((select jsonb_agg(x order by x.ord) from (
          select case when n <= 3 then 1 when n <= 10 then 2 when n <= 30 then 3 else 4 end ord,
                 case when n <= 3 then '1–3 כרטיסים' when n <= 10 then '4–10' when n <= 30 then '11–30' else '31+' end bucket,
                 count(*) viewers
            from (select user_id, count(*) n from imp group by user_id) u group by 1, 2) x), '[]')
    ),
    'by_type', coalesce((select jsonb_agg(x order by x.viewers desc) from (
        select case when item_type = 'news' and is_video then 'news_video'
                    when item_type = 'news' then 'news_article' else item_type end item_type,
               count(*) items, sum(viewers) viewer_item_pairs,
               round(avg(viewers)::numeric, 1) avg_viewers,
               round(avg(median_dwell_ms)) median_dwell_ms,
               sum(engaged_viewers) engaged, sum(opens) opens, sum(likes) likes, sum(comments) comments,
               sum(viewers) viewers
          from items group by 1) x), '[]'),
    'sources', coalesce((select jsonb_agg(x order by x.viewers desc nulls last) from (
        select s.source_name,
               (select count(*) from public.posts p where p.source_name = s.source_name and p.deleted_at is null and p.created_at >= since) published,
               count(i.item_key) seen_items,
               coalesce(sum(i.viewers), 0) viewers,
               round(avg(i.viewers)::numeric, 1) avg_viewers,
               round(avg(i.median_dwell_ms)) median_dwell_ms,
               coalesce(sum(i.engaged_viewers), 0) engaged,
               coalesce(sum(i.opens), 0) opens, coalesce(sum(i.likes), 0) likes,
               bool_or(i.is_video) has_video
          from (select distinct source_name from public.posts where source_name is not null and deleted_at is null) s
          left join items i on i.source_name = s.source_name
         group by s.source_name) x), '[]'),
    'top_items', coalesce((select jsonb_agg(x) from (
        select item_key, item_type, source_name, title, is_video, published_at, viewers, views,
               round(median_dwell_ms) median_dwell_ms, engaged_viewers, opens, likes, comments
          from items order by viewers desc, median_dwell_ms desc limit 15) x), '[]')
  ) into result;

  return result;
end;
$$;

revoke all on function public.analytics_feed(int) from public, anon;
grant execute on function public.analytics_feed(int) to authenticated;
