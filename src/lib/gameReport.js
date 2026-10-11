import { format } from 'date-fns'
import { supabase } from './supabase'
import { getGameSquad } from './squad'
import { getPlayerTeams, buildMemberMaps } from './playerTeams'
import { AGE_LABEL, ageOf } from './ageGroups'
import { getGameReportRow, summarizeReport, gameCaptainIds, getGameSignatures } from './gameFormData'

/**
 * Everything the game-form export needs to know about a played game, assembled from
 * what the app actually recorded.
 *
 * The one real question here is who belongs on each team's block, because the answer
 * changed over the life of the app. Three sources, best first:
 *
 *   1. the game squad — who declared for THIS game, plus anyone a coach or judge
 *      added by hand. Only games played since squads shipped have it.
 *   2. whoever has a game_stats row — the judge's box score. Not a lineup, but every
 *      player in it demonstrably took part, and it covers 41 of the 51 played games.
 *   3. the team roster, for older games with neither. Wider than a real lineup; the
 *      alternative is handing back a sheet with no players on it at all.
 *
 * Guest players are the gap: a judge's free-text guest carries a name and the team
 * they came FROM, never the side they played for, so nothing here can place them.
 * They come back as `guests` for the export dialog to assign.
 */

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const GOALKEEPER = 'Goalkeeper'

/** Officials on the game (definer RPC — game_officials itself is admin/LM/self-only). */
async function getGameOfficials(gameId) {
  const { data, error } = await supabase.rpc('game_report_officials', { p_game_id: gameId })
  if (error) return []
  return data || []
}

/** The extra reads the export needs beyond what the game page already holds. */
export async function getGameFormSources(gameId) {
  const [squad, officials, memberships, reportRow, signatures] = await Promise.all([
    getGameSquad(gameId).catch(() => []),
    getGameOfficials(gameId).catch(() => []),
    getPlayerTeams().catch(() => []),
    getGameReportRow(gameId).catch(() => null),
    getGameSignatures(gameId).catch(() => ({})),
  ])
  return { squad, officials, memberships, reportRow, signatures }
}

// Several rows carry a trailing space in first_name, which would print as a gap.
const fullName = (p) => [p?.first_name, p?.last_name].map(s => (s || '').trim()).filter(Boolean).join(' ')

/** Goalkeepers first (the form's first row is theirs), then shirt number, then name. */
function sortForSheet(a, b) {
  if (a.isGoalkeeper !== b.isGoalkeeper) return a.isGoalkeeper ? -1 : 1
  const an = Number.isFinite(a.number), bn = Number.isFinite(b.number)
  if (an !== bn) return an ? -1 : 1
  if (an && bn && a.number !== b.number) return a.number - b.number
  return a.name.localeCompare(b.name, 'he')
}

/**
 * One team's block. `statsByPlayer` carries the box score; players with no stat line
 * still belong on the sheet (they played, they just didn't score or get carded).
 */
function teamPlayers({ teamId, players, statsByPlayer, squad, byTeam }) {
  const byId = new Map(players.map(p => [p.id, p]))
  const ids = new Set()

  for (const row of squad) {
    if (row.team_id === teamId && row.status === 'available') ids.add(row.player_id)
  }
  for (const [playerId, stat] of statsByPlayer) {
    // a loaned player's line names the side he played for; he is on neither roster
    if (stat?.played_for_team_id) { if (stat.played_for_team_id === teamId) ids.add(playerId); continue }
    if (byId.get(playerId)?.team_id === teamId || byTeam.get(teamId)?.has(playerId)) ids.add(playerId)
  }
  // Neither a squad nor a box score — fall back to the whole roster.
  if (!ids.size) {
    for (const playerId of byTeam.get(teamId) || []) ids.add(playerId)
    for (const p of players) if (p.team_id === teamId) ids.add(p.id)
  }

  return [...ids].map(id => {
    const p = byId.get(id)
    const stat = statsByPlayer.get(id)
    if (!p) return null
    return {
      id,
      number: Number.isFinite(p.jersey_number) ? p.jersey_number : null,
      name: fullName(p) || '—',
      isGoalkeeper: p.position === GOALKEEPER,
      goals: stat?.goals || 0,
      blue: stat?.blue_cards || 0,
      red: stat?.red_cards || 0,
    }
  }).filter(Boolean).sort(sortForSheet)
}

/** Guest stat lines, which carry no side — the dialog asks which team to file them under. */
export function guestEntries(stats) {
  return stats.filter(s => s.is_guest_player).map(s => ({
    id: s.id,
    name: (s.guest_player_name || '').trim() || 'אורח/ת',
    from: (s.guest_player_original_team || '').trim(),
    isGoalkeeper: s.guest_player_type === 'guest_goalkeeper',
    goals: s.goals || 0,
    blue: s.blue_cards || 0,
    red: s.red_cards || 0,
    number: null,
  }))
}

/**
 * Everyone the league has on record for this fixture, sorted onto the form's lines.
 *
 * Two joins that are not obvious. `games.referee_id` names a PLAYER (or an external
 * referee) while an assigned judge is an ACCOUNT, so the same person can appear as
 * both under two different names — hence the match on the profile's linked player_id
 * as well as the name. And a game whose referee was never recorded still has the judge
 * who was assigned to work it, which is the same fact by another route: that judge
 * becomes the referee, and any others fall to the שופט נוסף line.
 */
export function resolveOfficials({ game, refereeName, officials = [] }) {
  const named = (role) => officials.filter(o => o.role === role && (o.name || '').trim())
  const judges = named('judge')
  const medics = named('medic')

  const referee = (refereeName || '').trim() || judges[0]?.name || ''
  const isReferee = (j) => j.name === referee || (j.player_id && j.player_id === game.referee_id)
  const coachesOf = (teamId) => officials
    .filter(o => o.role === 'coach' && o.team_id === teamId && (o.name || '').trim())
    .map(o => o.name)

  return {
    referee,
    extraReferee: judges.filter(j => !isReferee(j)).map(j => j.name).join(' / '),
    // An approved application outranks a bare assignment for the same role.
    medic: (medics.find(m => m.status === 'approved') || medics[0])?.name || '',
    homeCoaches: coachesOf(game.home_team_id),
    awayCoaches: coachesOf(game.away_team_id),
  }
}

/**
 * The values the export dialog opens with. Everything the league already knows arrives
 * filled — medic, the extra judge, both coaches, the captains, the referee's own notes,
 * and (from the judge board's archive) team fouls and the half-time score — so the only
 * field nothing can answer is the referees' observer.
 *
 * A team can have several accounts holding the coach role (assistants, a manager who
 * also coaches), so `coachOptions` carries them all for the field to offer.
 */
export function defaultFormFields({ game, stats, officials = [], refereeName, reportRow = null, home = null, away = null, players = [] }) {
  const resolved = resolveOfficials({ game, refereeName, officials })
  const guests = guestEntries(stats)
  const summary = summarizeReport(reportRow)
  const caps = gameCaptainIds(reportRow, home, away)
  const nameOf = (id) => fullName(players.find(p => p.id === id))
  // The archive only knows goals the judge entered on the board; trust its half-time
  // score only when its goal count matches the final.
  const goalsAgree = !!summary?.hasGoals && summary.goals.home === game.home_score && summary.goals.away === game.away_score
  const fromArchive = (v) => (v == null ? '' : String(v))
  return {
    medic: resolved.medic,
    extraReferee: resolved.extraReferee,
    observer: '',
    halftimeHome: goalsAgree ? fromArchive(summary.halftime.home) : '',
    halftimeAway: goalsAgree ? fromArchive(summary.halftime.away) : '',
    homeFouls: summary ? String(summary.fouls.home) : '',
    awayFouls: summary ? String(summary.fouls.away) : '',
    timeouts: summary?.hasTimeouts ? summary.timeouts : null,
    foulsSource: summary ? (summary.exact ? 'exact' : 'feed') : null,
    homeCoach: resolved.homeCoaches[0] || '',
    homeCaptain: nameOf(caps.home),
    awayCoach: resolved.awayCoaches[0] || '',
    awayCaptain: nameOf(caps.away),
    refereeNotes: game.referee_notes || '',
    coachOptions: { home: resolved.homeCoaches, away: resolved.awayCoaches },
    // Nothing in the data says which side a guest played for; home is a starting
    // point the exporter can flip, not a claim.
    guestTeams: Object.fromEntries(guests.map(g => [g.id, 'home'])),
  }
}

/**
 * Fold the page's data and the dialog's fields into the flat shape buildGameForm wants.
 */
export function buildReport({ game, home, away, players, stats, squad, memberships, refereeName, officials, fields, signatures = {} }) {
  const { byTeam } = buildMemberMaps(memberships, players)
  const statsByPlayer = new Map(stats.filter(s => s.player_id).map(s => [s.player_id, s]))
  const date = new Date(game.game_date)

  const guests = guestEntries(stats)
  const guestsFor = (side) => guests.filter(g => (fields.guestTeams?.[g.id] || 'home') === side)
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const blockFor = (team, side) => ({
    name: team?.name || '',
    fouls: num(side === 'home' ? fields.homeFouls : fields.awayFouls),
    timeouts: fields.timeouts?.[side] || null,
    coach: side === 'home' ? fields.homeCoach : fields.awayCoach,
    captain: side === 'home' ? fields.homeCaptain : fields.awayCaptain,
    players: [
      ...teamPlayers({ teamId: team?.id, players, statsByPlayer, squad, byTeam }),
      ...guestsFor(side),
    ],
  })

  return {
    date: format(date, 'dd/MM/yyyy'),
    day: HE_DAYS[date.getDay()],
    time: format(date, 'HH:mm'),
    venue: game.venue || '',
    // Falls back to the judge assigned to work the game — 5 of the played fixtures
    // never got a referee_id, and the assignment is the same fact by another route.
    referee: resolveOfficials({ game, refereeName, officials }).referee,
    competition: game.game_type || 'ליגה',
    ageLabel: AGE_LABEL[ageOf(home || away)] || '',
    // The uuid's first block: enough to tie a filed sheet back to a row, short enough
    // to fit the printed box.
    gameCode: String(game.id).split('-')[0].toUpperCase(),
    extraReferee: fields.extraReferee,
    observer: fields.observer,
    medic: fields.medic,
    refereeNotes: fields.refereeNotes,
    halftimeHome: num(fields.halftimeHome),
    halftimeAway: num(fields.halftimeAway),
    finalHome: game.home_score ?? null,
    finalAway: game.away_score ?? null,
    home: blockFor(home, 'home'),
    away: blockFor(away, 'away'),
    signatures: Object.fromEntries(Object.entries(signatures).map(([role, s]) => [role, s?.image]).filter(([, img]) => img)),
  }
}

/** `טופס-משחק-קריית-מוצקין-בלג-נוער-11-07-2026.xlsx` */
export function gameFormFilename({ game, home, away }) {
  const date = format(new Date(game.game_date), 'dd-MM-yyyy')
  const slug = (s) => (s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-')
  return `טופס-משחק-${slug(home?.name)}-${slug(away?.name)}-${date}.xlsx`
}
