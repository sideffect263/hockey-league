import { supabase } from './supabase'
import { TeamSide, CardType, Half, BreakKind, GameRules } from './game/rules'

/**
 * Live-game bridge between the judge's authoritative GameEngine and public
 * spectators.
 *
 * The judge board runs the deadline-based engine locally; `broadcastGameState`
 * snapshots it into the `broadcast_game_state` RPC (judge/admin only, server
 * gated) so anyone watching /games/:id sees a live scoreboard. Spectators only
 * ever read — `getLiveGame` (public SELECT) + `subscribeLiveGame` (Realtime).
 *
 * We never stream the clock tick-by-tick: a running clock is sent as an
 * absolute deadline (`clock_ends_at`) and each spectator reconstructs the
 * remaining time locally. That's why broadcasts fire only on SIGNIFICANT
 * changes (score / running / phase / period), not ~20×/sec.
 */

// ---- live play-by-play ----------------------------------------------------
// The engine already records every goal, foul and card with player + game clock.
// We forward a compact, chronologically-ordered slice into live_game_state.state
// so spectators see a running feed, not just score + clock. Event ids encode a
// global monotonic counter (`e<session>-<n>`), which gives a stable order across
// the separate goals / strikes / cardLog arrays.
const MAX_LIVE_EVENTS = 40

function eventSeq(id) {
  const m = /-(\d+)$/.exec(id || '')
  return m ? parseInt(m[1], 10) : 0
}
function eventPlayerName(p) {
  if (!p) return null
  return p.name || [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || null
}
function eventPeriod(half) {
  switch (half) {
    case Half.first: return '1'
    case Half.second: return '2'
    case Half.third: return '3'
    case Half.ot1: return 'הארכה 1'
    case Half.ot2: return 'הארכה 2'
    default: return ''
  }
}
const eventSide = (side) => (side === TeamSide.home ? 'home' : 'away')

// The compact event list broadcast to spectators (most recent MAX kept, in order).
// The judge's save passes { max: Infinity } for the full, uncapped match report — same
// event objects, so game_reports.events keeps one shape whichever path wrote it.
export function buildLiveEvents(engine, { max = MAX_LIVE_EVENTS } = {}) {
  if (!engine) return []
  const evs = []
  // An own goal stays type 'goal' on the side it is CREDITED to, with no player and
  // ownGoal: true — older readers still count it for the right team.
  for (const g of engine.goals || [])
    evs.push({ id: g.id, seq: eventSeq(g.id), type: 'goal', side: eventSide(g.side), player: g.ownGoal ? null : eventPlayerName(g.player), timeMS: g.timeMS ?? null, period: eventPeriod(g.half), ...(g.ownGoal ? { ownGoal: true } : {}) })
  for (const c of engine.cardLog || [])
    evs.push({ id: c.id, seq: eventSeq(c.id), type: c.type === CardType.red ? 'red' : 'blue', side: eventSide(c.side), player: eventPlayerName(c.player), timeMS: c.timeMS ?? null, period: eventPeriod(c.half) })
  for (const s of engine.strikes || [])
    evs.push({ id: s.id, seq: eventSeq(s.id), type: 'foul', side: eventSide(s.side), player: eventPlayerName(s.player), timeMS: s.timeMS ?? null, period: eventPeriod(s.half) })
  for (const b of engine.breaks || []) {
    const isTimeout = b.kind === BreakKind.homeTimeout || b.kind === BreakKind.guestTimeout
    evs.push({ id: b.id, seq: eventSeq(b.id), type: isTimeout ? 'timeout' : 'break', side: b.side ? eventSide(b.side) : null, player: null, timeMS: b.timeMS ?? null, period: eventPeriod(b.half) })
  }
  evs.sort((a, b) => a.seq - b.seq)
  // Drop the internal seq from the payload; the array is already chronological.
  const kept = Number.isFinite(max) ? evs.slice(-max) : evs
  return kept.map(({ seq, ...e }) => e)
}

// Map an engine snapshot onto the RPC args and upsert. Best-effort: a failed
// broadcast must never break live scoring for the judge, so errors are swallowed.
/**
 * Timeouts each side has taken this period, from a live row. Boards that send
 * `state.timeouts` (web; native from their next release) are exact; otherwise count
 * the timeout events in the current period of the play-by-play.
 */
export function liveTimeouts(live) {
  const t = live?.state?.timeouts
  if (t && Number.isFinite(t.home)) return { home: t.home, away: t.away, max: t.max || 2 }
  const evs = live?.state?.events || []
  // The period label of the most recent event stands in for "the current period".
  const cur = [...evs].reverse().find(e => e.period)?.period
  if (!cur) return null
  const n = (side) => evs.filter(e => e.type === 'timeout' && e.side === side && e.period === cur).length
  if (!evs.some(e => e.type === 'timeout')) return null
  return { home: n('home'), away: n('away'), max: 2 }
}

/** Is this live row in a break, and which kind? → 'timeout' | 'halftime' | null */
export function liveBreak(live) {
  if (live?.phase !== 'breakTime') return null
  return /פסק זמן/.test(live.period || '') ? 'timeout' : 'halftime'
}

export async function broadcastGameState(engine, gameId) {
  if (!engine || !gameId) return
  try {
    // A break (timeout / halftime) counts down too: send it as a running deadline so
    // spectators see it tick, not a frozen "paused" clock.
    const running = !!engine.isRunning || engine.phase === 'breakTime'
    const remainingMS = Math.max(0, Math.round(engine.clock?.remainingMS ?? 0))
    const { error } = await supabase.rpc('broadcast_game_state', {
      p_game_id: gameId,
      p_home: engine.homeFinalScore,
      p_away: engine.guestFinalScore,
      // running → hand spectators a deadline they can tick against; paused → a frozen value.
      p_clock_ends_at: running ? new Date(Date.now() + remainingMS).toISOString() : null,
      p_clock_remaining_ms: running ? null : remainingMS,
      p_is_running: running,
      p_period: engine.periodLabel,
      p_phase: engine.phase,
      // events → spectator play-by-play; snapshot → the full engine state, so a judge
      // who lost their local draft (different device / cleared storage) resumes THIS
      // match instead of a fresh board. Spectators read events + columns, ignore snapshot.
      // timeouts → each side's timeouts taken this period, for the scoreboards and the
      // score bar on the stream.
      p_state: {
        events: buildLiveEvents(engine),
        snapshot: engine.serialize(),
        timeouts: { home: engine.home?.timeoutsThisPeriod ?? 0, away: engine.guest?.timeoutsThisPeriod ?? 0, max: GameRules.maxTimeoutsPerPeriod },
        // Half length → game_reports.period_ms (the form's timeout minutes).
        periodMS: engine.settings?.periodMS ?? null,
      },
    })
    if (error) throw error
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('broadcastGameState failed (ignored)', e)
  }
}

// All games live right now — every `live_game_state` row touched within
// LIVE_MAX_AGE_MS, newest first. Public SELECT, safe for anon. The freshness
// window drops "zombie" rows: a judge who closes the board without reset/finish
// leaves a stale row behind, and we never want the site announcing a game that
// stopped being officiated hours ago. Best-effort → [] on error.
const LIVE_MAX_AGE_MS = 4 * 60 * 60 * 1000  // 4h, comfortably longer than a game

export async function getLiveGames() {
  const since = new Date(Date.now() - LIVE_MAX_AGE_MS).toISOString()
  const { data, error } = await supabase
    .from('live_game_state')
    .select('*')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
  if (error) return []
  return data || []
}

// Realtime for ANY live-game change (start / score / finish / abandon). The cb
// takes no args — callers just refetch getLiveGames(). No-op-safe if Realtime
// isn't reachable. Returns an unsubscribe fn.
export function subscribeLiveGames(cb) {
  const channel = supabase
    .channel('live_games:all')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'live_game_state' },
      () => cb(),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// Current live row for a game, or null. Public SELECT — safe for anon spectators.
export async function getLiveGame(gameId) {
  if (!gameId) return null
  const { data, error } = await supabase
    .from('live_game_state')
    .select('*')
    .eq('game_id', gameId)
    .maybeSingle()
  if (error) return null
  return data || null
}

// Realtime subscription for one game's live row. Invokes cb(row|null) on every
// change; a DELETE (game abandoned / finished) delivers null. Returns an
// unsubscribe fn. No-op-safe if Realtime isn't reachable — mirrors
// notifications.js subscribeToNotifications.
export function subscribeLiveGame(gameId, cb) {
  if (!gameId) return () => {}
  const channel = supabase
    .channel(`live_game:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'live_game_state', filter: `game_id=eq.${gameId}` },
      (payload) => cb(payload.eventType === 'DELETE' ? null : (payload.new || null)),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// Judge/admin only. status ∈ scheduled | in_progress | waiting_result.
// 'scheduled' abandons the game and clears its live state.
export async function setGameStatus(gameId, status) {
  const { error } = await supabase.rpc('set_game_status', {
    p_game_id: gameId,
    p_status: status,
  })
  if (error) throw error
}
