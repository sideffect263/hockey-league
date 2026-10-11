import { supabase } from './supabase'

/**
 * The match-sheet facts the box score never held — team fouls, timeouts, the half-time
 * score, captains — and the digital signatures on the game form.
 *
 * Fouls and timeouts come from `game_reports`, which a DB trigger fills from every live
 * broadcast (see supabase/game-form-signing.sql): the web judge's full engine snapshot
 * when there is one (exact), otherwise the merged play-by-play every judge app sends.
 * Games finished before 2026-10-11 have no row — their fouls were never kept.
 */

export const SIGN_ROLES = ['referee', 'medic', 'home_coach', 'home_captain', 'away_coach', 'away_captain']

export async function getGameReportRow(gameId) {
  const { data, error } = await supabase.from('game_reports').select('*').eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return data
}

const PERIOD_OF_HALF = { first: '1', second: '2', third: '3', ot1: 'הארכה 1', ot2: 'הארכה 2' }
// Android names the away side "guest"; the web engine does too inside its snapshot.
const sideOf = (s) => (s === 'home' ? 'home' : s === 'away' || s === 'guest' ? 'away' : null)

/**
 * Normalise either source into one event list: { type, side, period, timeMS }.
 * type ∈ goal | foul | timeout.
 */
function eventsFrom(row) {
  const snap = row?.final_state
  if (snap && Array.isArray(snap.strikes)) {
    const ev = []
    for (const g of snap.goals || []) ev.push({ type: 'goal', side: sideOf(g.side), period: PERIOD_OF_HALF[g.half] || '', timeMS: g.timeMS })
    for (const s of snap.strikes || []) ev.push({ type: 'foul', side: sideOf(s.side), period: PERIOD_OF_HALF[s.half] || '', timeMS: s.timeMS })
    for (const b of snap.breaks || []) {
      if (b.kind === 'homeTimeout' || b.kind === 'guestTimeout')
        ev.push({ type: 'timeout', side: b.kind === 'homeTimeout' ? 'home' : 'away', period: PERIOD_OF_HALF[b.half] || '', timeMS: b.timeMS })
    }
    return { events: ev, periodMS: snap.settings?.periodMS || null, exact: true }
  }
  const ev = (row?.events || []).map(e => ({ type: e.type, side: sideOf(e.side), period: e.period || '', timeMS: e.timeMS }))
  return { events: ev, periodMS: null, exact: false }
}

const DEFAULT_PERIOD_MS = 25 * 60_000

/**
 * What the form needs: total team fouls per side, each side's timeouts by half (as the
 * minute of the half they were called in), and the half-time score. `null` when the
 * game has no recorded report at all.
 */
export function summarizeReport(row) {
  if (!row || (!row.final_state && !(row.events || []).length)) return null
  const { events, periodMS, exact } = eventsFrom(row)
  const len = periodMS || DEFAULT_PERIOD_MS
  const count = (type, side, pred = () => true) => events.filter(e => e.type === type && e.side === side && pred(e)).length
  // Minute of the half, 1-based, from the clock's REMAINING time.
  const minute = (e) => (Number.isFinite(e.timeMS) ? Math.min(Math.floor((len - e.timeMS) / 60_000) + 1, Math.ceil(len / 60_000)) : null)
  const timeouts = (side, period) => events.filter(e => e.type === 'timeout' && e.side === side && e.period === period).map(minute)
  return {
    exact,
    fouls: { home: count('foul', 'home'), away: count('foul', 'away') },
    goals: { home: count('goal', 'home'), away: count('goal', 'away') },
    timeouts: {
      home: { first: timeouts('home', '1'), second: timeouts('home', '2') },
      away: { first: timeouts('away', '1'), second: timeouts('away', '2') },
    },
    halftime: {
      home: count('goal', 'home', e => e.period === '1'),
      away: count('goal', 'away', e => e.period === '1'),
    },
    // Native judge boards don't broadcast timeouts — say so rather than print "none".
    hasTimeouts: exact || events.some(e => e.type === 'timeout'),
    hasGoals: events.some(e => e.type === 'goal'),
  }
}

// ---- captains ----
export async function setTeamCaptain(teamId, playerId) {
  const { error } = await supabase.rpc('set_team_captain', { p_team_id: teamId, p_player_id: playerId })
  if (error) throw error
}

export async function setGameCaptain(gameId, side, playerId) {
  const { error } = await supabase.rpc('set_game_captain', { p_game_id: gameId, p_side: side, p_player_id: playerId })
  if (error) throw error
}

/** Effective captain ids for a game: the game's own record, else each team's captain. */
export function gameCaptainIds(row, home, away) {
  return {
    home: row?.home_captain_id || home?.captain_player_id || null,
    away: row?.away_captain_id || away?.captain_player_id || null,
  }
}

// ---- signatures ----
export async function getMySignRoles(gameId) {
  const { data, error } = await supabase.rpc('game_sign_roles', { p_game_id: gameId })
  if (error) throw error
  return (data || []).map(r => (typeof r === 'string' ? r : r.game_sign_roles))
}

/** `{ [role]: { signer_name, signed_at, image, is_mine } }`, or null when not allowed to read. */
export async function getGameSignatures(gameId) {
  const { data, error } = await supabase.rpc('game_form_signatures', { p_game_id: gameId })
  if (error) return null
  return Object.fromEntries((data || []).map(s => [s.role, s]))
}

export async function signGameForm(gameId, role, pngDataUrl) {
  const { error } = await supabase.rpc('sign_game_form', { p_game_id: gameId, p_role: role, p_image: pngDataUrl })
  if (error) throw error
}

export async function clearGameSignature(gameId, role) {
  const { error } = await supabase.rpc('clear_game_signature', { p_game_id: gameId, p_role: role })
  if (error) throw error
}
