/**
 * Plain-Hebrew summaries of a game page and a player page ("על המשחק" / "על השחקן"),
 * plus the head-to-head / recent-form derivations the game page shows.
 *
 * ONE source for two readers: the SPA renders these sentences, and api/seo.js gives
 * search bots the same sentences. They must stay word-for-word equal — the bot copy
 * may not say anything the page doesn't (cloaking). Pure functions, no React, no
 * fetching, so both runtimes import this file.
 *
 * Why it exists: Search Console left ~130 game/player pages "discovered, not crawled"
 * (2026-10-22). They were ~60–90 words each — a score and a list. Sentences built
 * from the same facts give each page text of its own.
 *
 * RTL: never put a bare "8:7" or "8–7" in Hebrew prose — the bidi algorithm flips
 * the digit runs (see hockey-league-rtl-score-gotcha). Scores are spelled out.
 */
import { countsForStats } from './leagueStats.js'

const TZ = 'Asia/Jerusalem'
export const fmtDay = (iso) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('he-IL', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' }) } catch { return '' }
}
const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '' }
}

// Hebrew number agreement: "שער אחד", "2 שערים".
const count = (n, one, many) => (n === 1 ? `${one} אחד` : `${n} ${many}`)
const goalsN = (n) => count(n, 'שער', 'שערים')
// "במשחק אחד" / "ב-7 משחקים"
const inGames = (n) => (n === 1 ? 'במשחק אחד' : `ב-${n} משחקים`)
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`)

const isPlayed = (g) => g?.status === 'completed' && g.home_score != null && g.away_score != null
const meets = (g, game) =>
  (g.home_team_id === game.home_team_id && g.away_team_id === game.away_team_id) ||
  (g.home_team_id === game.away_team_id && g.away_team_id === game.home_team_id)

/** Other completed competitive meetings of the same two teams, newest first. */
export function headToHead(games, game) {
  return (games || [])
    .filter(g => g.id !== game.id && isPlayed(g) && countsForStats(g) && meets(g, game))
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
}

/** A team's last `n` completed competitive results before this game: 'win' | 'loss' | 'tie', newest first. */
export function formBefore(games, game, teamId, n = 5) {
  return (games || [])
    .filter(g => isPlayed(g) && countsForStats(g) && new Date(g.game_date) < new Date(game.game_date) &&
      (g.home_team_id === teamId || g.away_team_id === teamId))
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    .slice(0, n)
    .map(g => {
      const home = g.home_team_id === teamId
      const my = home ? g.home_score : g.away_score, opp = home ? g.away_score : g.home_score
      return my > opp ? 'win' : my < opp ? 'loss' : 'tie'
    })
}

/**
 * Sentences about one game.
 * @param game    the games row (status, scores, game_date, venue, game_type, team ids, own goals)
 * @param home/away  { name }
 * @param scorers [{ name, goals, side: 'home'|'away' }] — goals > 0 only
 * @param cards   { blue, red } totals
 * @param h2h     headToHead(...) result
 * @param seasonName  e.g. '2025-26' (optional)
 */
export function gameSummary({ game, home, away, scorers = [], cards = { blue: 0, red: 0 }, h2h = [], seasonName = null }) {
  const h = home?.name || 'קבוצת הבית', a = away?.name || 'קבוצת החוץ'
  const day = fmtDay(game.game_date)
  const where = game.venue ? ` ב${game.venue}` : ''
  const comp = [game.game_type, seasonName && `עונת ${seasonName}`].filter(Boolean).join(', ')
  const out = []

  if (isPlayed(game)) {
    const hs = game.home_score, as = game.away_score
    if (hs === as) {
      out.push(`${h} ו${a} נפרדו בתיקו, ${goalsN(hs)} לכל קבוצה, במשחק ששוחק ב-${day}${where}${comp ? ` (${comp})` : ''}.`)
    } else {
      const [w, l, ws, ls] = hs > as ? [h, a, hs, as] : [a, h, as, hs]
      const how = ws - ls === 1 ? ' בהפרש שער אחד' : ws - ls >= 5 ? ' בהפרש גדול' : ''
      out.push(`${w} ניצחה את ${l}${how}: ${goalsN(ws)} מול ${ls}. המשחק שוחק ב-${day}${where}${comp ? ` (${comp})` : ''}, ${w === h ? 'בבית' : 'בחוץ'} מבחינת ${w}.`)
    }
    out.push(`בסך הכול נכבשו במשחק ${goalsN(hs + as)}.`)
    for (const [side, team] of [['home', h], ['away', a]]) {
      const own = (side === 'home' ? game.home_own_goals : game.away_own_goals) || 0
      const sc = scorers.filter(s => s.side === side).sort((x, y) => y.goals - x.goals)
      if (!sc.length && !own) continue
      const names = sc.map(s => (s.goals > 1 ? `${s.name} (${s.goals})` : s.name))
      if (own) names.push(own === 1 ? 'שער עצמי של היריבה' : `${own} שערים עצמיים של היריבה`)
      out.push(`שערי ${team}: ${list(names)}.`)
    }
    const hat = scorers.filter(s => s.goals >= 3).sort((x, y) => y.goals - x.goals)
    if (hat.length) out.push(`${list(hat.map(s => `${s.name} (${s.goals})`))} — שלושה שערים ומעלה במשחק.`)
    if (cards.blue || cards.red) {
      const parts = [cards.blue && count(cards.blue, 'כרטיס כחול', 'כרטיסים כחולים'), cards.red && count(cards.red, 'כרטיס אדום', 'כרטיסים אדומים')].filter(Boolean)
      out.push(`השופטים הוציאו ${list(parts)}.`)
    }
  } else if (game.status === 'cancelled') {
    out.push(`המשחק בין ${h} ל${a}${day ? `, שנקבע ל-${day}` : ''}${where}, בוטל.`)
  } else if (game.status === 'postponed') {
    out.push(`המשחק בין ${h} ל${a}${where} נדחה${day ? ` (מועד מקורי: ${day})` : ''}.`)
  } else if (game.status === 'in_progress') {
    out.push(`${h} ו${a} משחקות עכשיו${where}.`)
  } else if (day) {
    out.push(`${h} תארח את ${a} ב-${day} בשעה ${fmtTime(game.game_date)}${where}${comp ? ` — משחק ${comp}` : ''}.`)
  }

  if (h2h.length) {
    let hw = 0, aw = 0, t = 0
    for (const g of h2h) {
      const my = g.home_team_id === game.home_team_id ? g.home_score : g.away_score
      const opp = g.home_team_id === game.home_team_id ? g.away_score : g.home_score
      if (my > opp) hw++; else if (my < opp) aw++; else t++
    }
    const rec = [hw && `${h} ניצחה ${hw === 1 ? 'פעם אחת' : `${hw} פעמים`}`, aw && `${a} ניצחה ${aw === 1 ? 'פעם אחת' : `${aw} פעמים`}`,
      t && (t === 1 ? 'תיקו אחד' : `${t} תיקו`)].filter(Boolean)
    out.push(`בעוד ${h2h.length === 1 ? 'מפגש אחד' : `${h2h.length} מפגשים`} בין הקבוצות באותה עונה: ${list(rec)}.`)
  }
  return out
}

/**
 * Sentences about one player.
 * @param player  { first_name, last_name, position, jersey_number, goals, games_played, blue_cards, red_cards }
 * @param team    { name } | null
 * @param past    [{ seasonName, teamName, goals, games_played }] — archived seasons
 * @param lastGame  { home, away, game_date, home_score, away_score, status, goals } — newest game this season (optional)
 */
export function playerSummary({ player, team = null, past = [], lastGame = null }) {
  const name = `${player.first_name || ''} ${player.last_name || ''}`.trim()
  const role = player.position === 'Goalkeeper' ? 'שוער' : 'שחקן שדה'
  const out = []
  out.push(`${name} — ${role}${team?.name ? ` בקבוצת ${team.name}` : ''}${player.jersey_number != null ? `, מספר ${player.jersey_number}` : ''}, בליגת הוקי הגלגיליות הישראלית.`)
  const g = player.goals || 0, gp = player.games_played || 0
  if (gp > 0) {
    const avg = g > 0 ? ` (ממוצע של ${(g / gp).toFixed(1)} למשחק)` : ''
    out.push(`בעונה הנוכחית: ${goalsN(g)} ${inGames(gp)}${avg}.`)
  } else {
    out.push('בעונה הנוכחית עדיין לא נרשמו משחקים.')
  }
  if (lastGame) {
    const lg = lastGame
    const score = isPlayed(lg) ? `, שהסתיים ${lg.home_score === lg.away_score ? 'בתיקו' : `בניצחון ${lg.home_score > lg.away_score ? lg.home : lg.away}`}` : ''
    out.push(`המשחק האחרון: ${lg.home} נגד ${lg.away} ב-${fmtDay(lg.game_date)}${score}${lg.goals ? ` — ${goalsN(lg.goals)}` : ''}.`)
  }
  const pastWithGames = past.filter(p => (p.games_played || 0) > 0)
  if (pastWithGames.length) {
    out.push(`בעונות קודמות: ${list(pastWithGames.map(p => `${p.seasonName}${p.teamName ? ` ב${p.teamName}` : ''} — ${goalsN(p.goals || 0)} ${inGames(p.games_played)}`))}.`)
    const tg = g + pastWithGames.reduce((n, p) => n + (p.goals || 0), 0)
    const tgp = gp + pastWithGames.reduce((n, p) => n + (p.games_played || 0), 0)
    out.push(`סך הכול בליגה: ${goalsN(tg)} ${inGames(tgp)}.`)
  }
  const cards = [(player.blue_cards || 0) && count(player.blue_cards, 'כרטיס כחול', 'כרטיסים כחולים'), (player.red_cards || 0) && count(player.red_cards, 'כרטיס אדום', 'כרטיסים אדומים')].filter(Boolean)
  if (cards.length) out.push(`כרטיסים העונה: ${list(cards)}.`)
  return out
}
