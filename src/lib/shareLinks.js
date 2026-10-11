/**
 * What a feed card shares: { url, text, title, type } — or null for a card that has no
 * share button (הוקי מרקט cards are 18+, so they are never handed to the share sheet).
 *
 * Pure and import-free so it is unit-testable and so the iOS/Android ports can read it
 * as the reference. Paths follow lib/slugs.js entityPath (the row's slug, else its id,
 * percent-encoded) — re-implemented here rather than imported because slugs.js pulls in
 * the Supabase client.
 *
 *   game result        → /games/<slug|id>    "<home> <h>–<a> <away> · ליגת הוקי הגלגיליות"
 *   milestone / top scorer / birthday → /players/<slug|id>   the card's headline
 *   champion           → /teams/<slug|id>    "<team> אלופת העונה 🏆"
 *   post / news        → /posts/<id>         first line of the body (≤140 chars)
 */

export const SHARE_ORIGIN = 'https://rinkhockeyil.com'
export const LEAGUE_TAG = 'ליגת הוקי הגלגיליות'

const BIRTHDAY_GUID = /^birthday:([0-9a-f-]{36}):\d{4}$/

/** Same rule as lib/feed.js birthdayPlayerId (duplicated: that file is the feed's, this one must stay standalone). */
const birthdayPlayer = (p) => (BIRTHDAY_GUID.exec(p?.external_guid || '') || [])[1] || null

/** entityPath without the slug cache: the row's slug wins, else its id; a bare string is used as is. */
export function sharePath(type, ref) {
  if (!ref) return null
  const key = typeof ref === 'string' ? ref : (ref.slug || ref.id)
  return key ? `/${type}/${encodeURIComponent(key)}` : null
}

const YT_URL = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S*/g

/** First non-empty line of a body, links to YouTube dropped (a pasted clip IS the post), ≤ max chars. */
export function firstLine(body, max = 140) {
  const line = String(body || '')
    .split('\n')
    .map(l => l.replace(YT_URL, '').replace(/\s+/g, ' ').trim())
    .find(Boolean) || ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ')

/**
 * Score line for a shared result. Logical order is home → away; with an EN DASH (a
 * bidi-neutral, unlike "-", which binds the two digits into one LTR run) each score
 * renders beside its own team in an RTL message: home on the right, its score next to it.
 */
export function resultText(homeName, homeScore, awayScore, awayName) {
  return `${homeName || 'בית'} ${homeScore}–${awayScore} ${awayName || 'חוץ'} · ${LEAGUE_TAG}`
}

/**
 * @param {object} post  a lib/feed.js item ({ id, type, data })
 * @param {{ playersMap?: object, origin?: string }} [ctx]
 */
export function buildShare(post, { playersMap = {}, origin = SHARE_ORIGIN } = {}) {
  if (!post?.type || post.type === 'market') return null
  const d = post.data || {}
  const abs = (path) => (path ? `${origin}${path}` : null)
  let path = null, text = '', type = post.type

  switch (post.type) {
    case 'game_result': {
      const g = d.game || {}
      path = sharePath('games', g.slug ? g : g.id)
      text = resultText(d.home?.name, g.home_score, g.away_score, d.away?.name)
      break
    }
    case 'milestone': {
      const player = d.playerId ? (playersMap[d.playerId] || d.playerId) : null
      // A guest scorer has no player page — the game is the next best thing.
      path = sharePath('players', player) || sharePath('games', d.game?.slug ? d.game : d.game?.id)
      const emoji = d.kind === 'big_game' ? '🔥' : '🎩'
      text = `${emoji} ${d.name || ''} כבש ${d.goals} שערים`.replace(/\s+/g, ' ').trim()
      break
    }
    case 'top_scorer': {
      const p = d.player || {}
      path = sharePath('players', p.slug ? p : (playersMap[p.id] || p.id))
      text = `${fullName(p)} — מלך השערים של העונה (${d.goals} שערים)`
      break
    }
    case 'champion':
      path = sharePath('teams', d.team)
      text = `${d.team?.name || ''} אלופת העונה 🏆`.trim()
      break
    case 'post':
    case 'external': {
      const p = d.post || {}
      const bday = birthdayPlayer(p)
      if (bday) {
        type = 'birthday'
        const player = playersMap[bday]
        path = sharePath('players', player || bday)
        text = player ? `יום הולדת שמח ל${fullName(player)}! 🎂` : (firstLine(p.body) || 'יום הולדת שמח! 🎂')
      } else {
        path = p.id ? `/posts/${p.id}` : null
        text = firstLine(p.body)
      }
      break
    }
    default:
      return null
  }

  const url = abs(path)
  if (!url) return null
  return { url, text, title: LEAGUE_TAG, type }
}
