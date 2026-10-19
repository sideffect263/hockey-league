import { supabase } from "@/lib/supabase"

// Games that have FIFA-style stats computed from their video (preview). Each id has a
// public/match-stats/<id>.json written by video-analysis/match_stats_export.py.
export const MATCH_STATS_GAMES = new Set([
  '4ce80747-0013-4920-b951-592958a1a380', // רמת ישי 4–8 גבעת עדה נוער, opener 2026-10-10
])

// ---- crowd review (supabase/match-stat-votes.sql) -------------------------------------------
// One row per user per engine event; "missed" rows are events the user added (event_id null).

export async function getMyVotes(gameId, engine) {
  const { data, error } = await supabase
    .from('match_stat_votes')
    .select('id, event_id, t, verdict, actual_type, actual_team')
    .eq('game_id', gameId).eq('engine', engine)
  if (error) throw error
  return data || []
}

export async function getVoteCounts(gameId, engine) {
  const { data, error } = await supabase.rpc('match_stat_vote_counts', { p_game: gameId, p_engine: engine })
  if (error) throw error
  return new Map((data || []).map((r) => [r.event_id, r]))
}

/** Insert or change this user's verdict on one engine event. `existingId` = their earlier row, if any. */
export async function saveVote({ existingId, gameId, engine, event, verdict, actualType = null, actualTeam = null }) {
  const row = {
    verdict, actual_type: actualType, actual_team: actualTeam, updated_at: new Date().toISOString(),
  }
  if (existingId) {
    const { data, error } = await supabase.from('match_stat_votes').update(row).eq('id', existingId)
      .select('id, event_id, t, verdict, actual_type, actual_team').single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase.from('match_stat_votes').insert({
    ...row, game_id: gameId, engine, event_id: event.id, t: event.t, type: event.type, team: event.team,
  }).select('id, event_id, t, verdict, actual_type, actual_team').single()
  if (error) throw error
  return data
}

export async function addMissed({ gameId, engine, t, type, team }) {
  const { data, error } = await supabase.from('match_stat_votes').insert({
    game_id: gameId, engine, event_id: null, t, verdict: 'missed', actual_type: type, actual_team: team,
  }).select('id, event_id, t, verdict, actual_type, actual_team').single()
  if (error) throw error
  return data
}
