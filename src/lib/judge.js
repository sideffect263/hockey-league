import { supabase } from './supabase'
import { saveWithRetry } from './game/saveRetry'

/**
 * Judge live-scoring persistence (Pkg2). A single SECURITY DEFINER RPC does the
 * whole "finish game" atomically — gated server-side to admins or judge-role
 * users, blocks re-scoring a completed game, replaces the box score, sets the
 * final score + status, and recomputes both teams' standings. See
 * scratchpad/judge_pkg2_up.sql / migration `judge_pkg2_live_scoring`.
 *
 * @param {string} gameId
 * @param {number} homeScore
 * @param {number} awayScore
 * @param {Array<{player_id:string, goals:number, blue_cards:number, red_cards:number, clean_sheet:boolean}>} stats
 */
export async function saveGameResult(gameId, homeScore, awayScore, stats, report = undefined) {
  // With a report → the 5-arg overload, which writes game_reports (full play-by-play,
  // engine snapshot, half length) in the SAME transaction as the result
  // (supabase/judge-save-report.sql). Without → the original 4-arg save.
  const args = {
    p_game_id: gameId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_stats: stats,
  }
  if (report !== undefined) args.p_report = report
  const { error } = await supabase.rpc('judge_save_game_result', args)
  if (error) throw error
}

/**
 * The judge board's save: the 5-arg save with the match report, retried on network
 * failure (see src/lib/game/saveRetry.js). A retry answered 'game already completed'
 * means an earlier attempt committed → success.
 */
export async function saveGameResultReliably(gameId, homeScore, awayScore, stats, report, opts) {
  return saveWithRetry(() => saveGameResult(gameId, homeScore, awayScore, stats, report), opts)
}
