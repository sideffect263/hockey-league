/**
 * The Floodlight game post (GamePost board), the pure parts: which slides a game's carousel
 * holds, its cover picture, its caption and the predictions strip line. Mirrors iOS
 * GameCarouselPost / GamePredictionStrip (FLFeedKit.swift) so the three clients agree.
 *
 * A `post` here is an arranged feed item (lib/feed.js arrangeFeed): type 'game' with
 * data { game, home, away, stats, slides, milestones, fullGame, story, photo }, or a plain
 * 'game_result' (the filtered lists), which has no slides.
 */
const TZ = 'Asia/Jerusalem'
/** yyyy-mm-dd of a date on Israel's calendar. */
export const ilDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })

/** "24.10" — the board's day.month. */
export const dayMonth = (d) => {
  const [, m, day] = ilDay(d).split('-')
  return `${Number(day)}.${Number(m)}`
}

/** A matched photo belongs in THIS game's carousel only when it is from the game's day
 *  (iOS QA 10-28: a 10.10 still showed up on a 24.10 game). */
export function photoFromGameDay(photo, gameDate) {
  if (!photo?.image_url || !photo.album_date || !gameDate) return false
  return String(photo.album_date).slice(0, 10) === ilDay(gameDate)
}

const streamPoster = (cfCode, uid, h = 720) =>
  `https://customer-${cfCode}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=2s&height=${h}`

/** A clip post's poster (Cloudflare Stream frame), else its image, else null. */
export function clipPoster(item, h = 720) {
  const p = item?.data?.post
  if (!p) return null
  if (p.video_uid && p.video_cf_code) return streamPoster(p.video_cf_code, p.video_uid, h)
  return p.image_url || null
}

/** The first slide's picture: a real frame from this game (clip frame first, Ariel 10-29),
 *  else a same-day photo, else null (the blend + the rink drawing). */
export function gameCover(post) {
  const d = post?.data || {}
  const clip = (d.slides || []).map((s) => clipPoster(s)).find(Boolean)
  if (clip) return clip
  if (photoFromGameDay(d.photo, d.game?.game_date)) {
    return d.photo.image_url
  }
  return null
}

/**
 * The carousel, in order: the result band, a same-day photo, the clips (oldest first),
 * the hat-trick / big-game milestones. [{ key, kind: 'band'|'photo'|'clip'|'milestone', item?, label }]
 */
export function gameSlides(post) {
  const d = post?.data || {}
  const out = [{ key: 'band', kind: 'band', label: 'תוצאה' }]
  if (photoFromGameDay(d.photo, d.game?.game_date)) out.push({ key: 'photo', kind: 'photo', photo: d.photo, label: 'תמונה' })
  ;(d.slides || []).forEach((item, i) => out.push({ key: item.id, kind: 'clip', item, label: `קליפ ${i + 1}` }))
  ;(d.milestones || []).forEach((m) => out.push({
    key: `ms-${m.playerId || m.name}`, kind: 'milestone', milestone: m,
    label: m.kind === 'big_game' ? 'משחק ענק' : 'שלושער',
  }))
  return out
}

/** The caption: the league's game story when there is one, else one plain line. */
export function gameCaption(post, homeName, awayName) {
  const d = post?.data || {}
  const story = (d.story?.data?.post?.body || '').trim()
  if (story) return story
  const g = d.game || {}
  const h = g.home_score, a = g.away_score
  if (h == null || a == null) return ''
  // RLM after each number: a digit followed by punctuation would otherwise jump sides in RTL.
  const n = (x) => `${x}\u200F`
  let s = h === a
    ? `תיקו: ${homeName} ${n(h)}, ${awayName} ${n(a)}.`
    : `ניצחון ל${h > a ? homeName : awayName}: ${homeName} ${n(h)}, ${awayName} ${n(a)}.`
  if ((d.slides || []).length) s += ' החליקו לכל הקליפים ←'
  return s
}

/**
 * The predictions strip (player + coach feeds): "התחזיות נסגרו · הקהל חזה X 56%" and, after
 * the result, "התחזית שלך: +N סטופרים" when he predicted. null = no strip (no market,
 * voided, nothing traded).
 */
export function predictionLine(odds, homeName, awayName) {
  if (!odds || !Array.isArray(odds.outcomes) || !odds.outcomes.length) return null
  if (odds.status === 'void') return null
  if (odds.status === 'resolved' && !(Number(odds.trades) > 0)) return null
  const last = (odds.history || []).at(-1)
  const price = (k) => {
    const h = last?.[k]
    if (h != null && h !== '') return Number(h)
    return Number(odds.outcomes.find((o) => o.okey === k)?.price) || 0
  }
  const keys = ['home', 'draw', 'away'].filter((k) => odds.outcomes.some((o) => o.okey === k))
  if (!keys.length) return null
  const lead = keys.reduce((best, k) => (price(k) > price(best) ? k : best), keys[0])
  const who = lead === 'home' ? homeName : lead === 'away' ? awayName : 'תיקו'
  const crowd = `${odds.status === 'open' ? 'התחזיות פתוחות' : 'התחזיות נסגרו'} · הקהל חזה ${who} ${Math.round(price(lead) * 100)}%`
  let mine = null
  const my = (odds.my || []).filter((p) => Number(p.shares) > 0 || Number(p.cost) > 0)
  if (odds.status === 'resolved' && my.length && odds.resolved_okey) {
    const paid = my.filter((p) => p.okey === odds.resolved_okey).reduce((s, p) => s + (Number(p.shares) || 0), 0)
    const cost = my.reduce((s, p) => s + (Number(p.cost) || 0), 0)
    mine = Math.round(paid - cost)
  }
  return { crowd, mine }
}
