import { supabase } from './supabase'
import { videoThumb, isLiveRow } from './video'

/**
 * Everything a team page can show as media, strictly linked to the team:
 *   - feed posts tagged with the team, or about one of its games, that carry a
 *     video (Cloudflare upload) or a photo — goal clips land here
 *   - full-game videos (game_videos) of its games, one row per game
 *   - published game stories of its games
 * Newest first. game_media is NOT read: its rows mirror the posts above
 * (origin 'post') and the recordings (origin 'recording'), so it would only
 * add duplicates.
 *
 * `games` = this team's games (already loaded by the page), used to build the
 * "מול X" labels and to scope the reads.
 */
export async function getTeamMedia(teamId, games) {
  const gameIds = games.map(g => g.id)
  const byGame = new Map(games.map(g => [g.id, g]))
  const postFilter = gameIds.length
    ? `team_id.eq.${teamId},game_id.in.(${gameIds.join(',')})`
    : `team_id.eq.${teamId}`

  const [posts, videos, stories] = await Promise.all([
    supabase.from('posts')
      .select('id, body, created_at, image_url, video_uid, video_cf_code, game_id')
      .is('deleted_at', null)
      .or(postFilter)
      .order('created_at', { ascending: false })
      .limit(60),
    gameIds.length
      ? supabase.from('game_videos')
          .select('id, game_id, provider, video_id, cf_customer_code, cf_live_input, kind, hidden, camera_no, created_at')
          .in('game_id', gameIds)
      : { data: [] },
    gameIds.length
      ? supabase.from('game_stories')
          .select('game_id, title, summary, hero_image_url, published_at')
          .eq('status', 'published')
          .in('game_id', gameIds)
      : { data: [] },
  ])
  for (const r of [posts, videos, stories]) if (r.error) throw r.error

  const items = []
  const seenVideo = new Set()
  for (const p of posts.data || []) {
    const [title, ...rest] = (p.body || '').split('\n')
    if (p.video_uid && p.video_cf_code) {
      if (seenVideo.has(p.video_uid)) continue
      seenVideo.add(p.video_uid)
      items.push({
        key: `post-${p.id}`, kind: 'clip', title: title || 'וידאו', note: rest.join(' ').trim(),
        poster: `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}/thumbnails/thumbnail.jpg?time=2s&height=360`,
        to: `/posts/${p.id}`, game: byGame.get(p.game_id) || null, date: p.created_at,
      })
    } else if (p.image_url) {
      items.push({
        key: `post-${p.id}`, kind: 'photo', title: title || 'תמונה', note: rest.join(' ').trim(),
        poster: p.image_url, to: `/posts/${p.id}`, game: byGame.get(p.game_id) || null, date: p.created_at,
      })
    }
  }

  // Full games: one item per game, however many recordings (cameras, parts, a
  // YouTube copy) it has.
  const fullByGame = new Map()
  for (const v of videos.data || []) {
    if (v.hidden || isLiveRow(v)) continue
    const cur = fullByGame.get(v.game_id)
    if (cur) cur.cameras++
    else fullByGame.set(v.game_id, { v, cameras: 1 })
  }
  for (const [gameId, { v, cameras }] of fullByGame) {
    const game = byGame.get(gameId)
    items.push({
      key: `full-${gameId}`, kind: 'full', title: 'המשחק המלא', cameras,
      poster: videoThumb(v), game, gameId, date: game?.game_date || v.created_at,
    })
  }

  for (const s of stories.data || []) {
    items.push({
      key: `story-${s.game_id}`, kind: 'story', title: s.title, note: s.summary,
      poster: s.hero_image_url, game: byGame.get(s.game_id) || null, gameId: s.game_id,
      date: s.published_at,
    })
  }

  return items.sort((a, b) => new Date(b.date) - new Date(a.date))
}
