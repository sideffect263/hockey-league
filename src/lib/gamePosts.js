import { youTubeInText, parseYouTubeId } from './youtube'

/**
 * Posts attached to a game (posts.game_id) — the "שייך למשחק" picker, the game chip on
 * a post card, and the "היילייטס ופוסטים מהמשחק" section on the game page.
 * Pure helpers only (unit-tested in gamePosts.test.js); the reads/writes are in api.js.
 */

const DAY = 864e5
export const PICKER_PAST_DAYS = 60
export const PICKER_FUTURE_DAYS = 14

const ddmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit' })

/** "DD.MM" of a game date, in Israel time. '' when there is no usable date. */
export function gameDayLabel(gameDate) {
  if (!gameDate) return ''
  const d = new Date(gameDate)
  if (Number.isNaN(d.getTime())) return ''
  return ddmm.format(d).replace('/', '.')
}

/** "<home> נגד <away> · DD.MM" */
export function gameLabel(game, teamsMap = {}) {
  if (!game) return ''
  const home = teamsMap[game.home_team_id]?.name || '?'
  const away = teamsMap[game.away_team_id]?.name || '?'
  const day = gameDayLabel(game.game_date)
  return `${home} נגד ${away}${day ? ` · ${day}` : ''}`
}

/**
 * Games a post can be attached to: non-test, from `pastDays` ago to `futureDays` ahead,
 * plus the currently linked game (whatever its date), newest matchday first.
 */
export function pickerGames(games = [], { now = Date.now(), currentId = null, pastDays = PICKER_PAST_DAYS, futureDays = PICKER_FUTURE_DAYS } = {}) {
  const from = now - pastDays * DAY
  const to = now + futureDays * DAY
  return (games || [])
    .filter(g => {
      if (!g?.id) return false
      if (g.id === currentId) return true
      if (g.is_test) return false
      const t = new Date(g.game_date).getTime()
      return Number.isFinite(t) && t >= from && t <= to
    })
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
}

/** Case-insensitive match on the label (team names, or the date "10.10"). */
export function filterGameOptions(options = [], query = '') {
  const q = (query || '').trim().toLowerCase()
  if (!q) return options
  return options.filter(o => (o.label || '').toLowerCase().includes(q))
}

/** A post that plays a video: an uploaded clip, or a YouTube link in link_url / the body. */
export function isVideoPost(p) {
  if (!p) return false
  if (p.video_uid) return true
  if (p.link_url && parseYouTubeId(p.link_url) && /youtu/.test(p.link_url)) return true
  return !!youTubeInText(p.body)
}

/** Video posts first, then the rest; newest first within each. Non-mutating. */
export function orderGamePosts(posts = []) {
  return [...(posts || [])].sort((a, b) => {
    const va = isVideoPost(a), vb = isVideoPost(b)
    if (va !== vb) return va ? -1 : 1
    return new Date(b.created_at) - new Date(a.created_at)
  })
}
