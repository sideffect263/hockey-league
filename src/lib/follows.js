import { supabase } from './supabase'
import { sessionUser } from './sessionUser'
import { trackEvent } from './analytics'

/**
 * Follow / subscribe (P5 — sheet row 24 + the ranked-feed epic).
 *
 * One table serves two jobs, which is why `notify` is a separate flag on each row:
 * following a team floats it up your feed, but you only get pushed about its games if
 * you asked to be. Following is cheap; notifications are annoying. Targets are teams
 * and players.
 *
 * Reads are RLS-scoped to your own rows — a follow list is nobody else's business —
 * so public follower COUNTS come from the follower_counts definer RPC instead.
 */

export const FOLLOW_TYPES = { team: 'team', player: 'player' }

/** Everything I follow: [{ target_type, target_id, notify }]. */
export async function getMyFollows() {
  const user = await sessionUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('follows')
    .select('target_type,target_id,notify')
    .eq('user_id', user.id)
  if (error) return []
  return data || []
}

/**
 * My follows as two Sets, which is the shape the feed ranker wants.
 * Returns { teams:Set, players:Set, notify:Set<`${type}:${id}`> }.
 */
export async function getMyFollowSets() {
  const rows = await getMyFollows()
  return {
    teams: new Set(rows.filter(r => r.target_type === 'team').map(r => r.target_id)),
    players: new Set(rows.filter(r => r.target_type === 'player').map(r => r.target_id)),
    notify: new Set(rows.filter(r => r.notify).map(r => `${r.target_type}:${r.target_id}`)),
  }
}

/** Follow a target. `notify` defaults to off — opting into pushes is a separate act. */
export async function follow(targetType, targetId, notify = false) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { error } = await supabase
    .from('follows')
    .upsert({ user_id: user.id, target_type: targetType, target_id: targetId, notify },
            { onConflict: 'user_id,target_type,target_id' })
  if (error) throw error
  trackEvent('follow', { target_type: targetType, notify: notify ? 'yes' : 'no' })
}

export async function unfollow(targetType, targetId) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
  if (error) throw error
}

/** Turn pushes on/off for something already followed. */
export async function setFollowNotify(targetType, targetId, notify) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { error } = await supabase
    .from('follows')
    .update({ notify })
    .eq('user_id', user.id)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
  if (error) throw error
}

/** Follower counts for a set of targets → { [id]: n }. Counts only, never who. */
export async function getFollowerCounts(targetType, ids) {
  const list = (ids || []).filter(Boolean)
  if (!list.length) return {}
  const { data, error } = await supabase.rpc('follower_counts', {
    p_type: targetType, p_ids: list,
  })
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.target_id, Number(r.followers) || 0]))
}

/*
 * Fans v2 (2026-10-19, supabase/fans-v2.sql). A player is NOT a fan of his own team:
 * every count below already leaves out the team's own players, server-side.
 */

// The viewer's own teams as a player — the fan button reads "הקבוצה שלי" there.
let rosterCache = { userId: null, ids: null }
export async function getMyRosterTeamIds() {
  const user = await sessionUser()
  if (!user) return new Set()
  if (rosterCache.userId === user.id && rosterCache.ids) return rosterCache.ids
  const { data, error } = await supabase.rpc('my_roster_team_ids')
  const ids = new Set(error ? [] : (data || []).map(r => (typeof r === 'string' ? r : r.my_roster_team_ids)).filter(Boolean))
  rosterCache = { userId: user.id, ids }
  return ids
}

/** One fan badge per user: the team they've been a fan of longest → { [userId]: { teamId, teamName, since } }. */
export async function getFanBadges(userIds) {
  const list = [...new Set((userIds || []).filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await supabase.rpc('fan_badges', { p_user_ids: list })
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.user_id, { teamId: r.team_id, teamName: r.team_name, since: r.since }]))
}

/** Fans of each side + "coming to watch" counts for one game. null when hidden/unknown. */
export async function getGameFanSummary(gameId) {
  const { data, error } = await supabase.rpc('game_fan_summary', { p_game: gameId })
  if (error) return null
  return data || null
}

/** Mark / unmark "אני בא/ה לצפות". Returns the fresh summary. */
export async function setGameWatch(gameId, on) {
  const { data, error } = await supabase.rpc('set_game_watch', { p_game: gameId, p_on: on })
  if (error) throw error
  return data
}

/** Coach / admin / league manager: { fans, notify, new_30d, weekly:[{week,total}], next_game }. */
export async function getTeamFanStats(teamId) {
  const { data, error } = await supabase.rpc('team_fan_stats', { p_team: teamId })
  if (error) return null
  return data
}

/** Admin / league manager: one row per team. */
export async function getAdminFanOverview() {
  const { data, error } = await supabase.rpc('admin_fan_overview')
  if (error) throw error
  return data || []
}

/** "אוהד אחד" / "12 אוהדים" — Hebrew does not pluralise like English. */
export const fansLabel = (n) => (Number(n) === 1 ? "אוהד אחד" : `${Number(n) || 0} אוהדים`)

/*
 * Game-day morning reminder for followed teams (supabase/fan-game-day-push.sql:
 * follows.game_day, default on). Account page (Floodlight /me, 2026-10-31) — additive.
 */

/** My team follows with their switches: [{ target_id, notify, game_day }]. */
export async function getMyTeamFollowRows() {
  const user = await sessionUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('follows')
    .select('target_id,notify,game_day,created_at')
    .eq('user_id', user.id)
    .eq('target_type', 'team')
    .order('created_at', { ascending: true })
  if (error) return []
  return data || []
}

/** Turn the "plays today" reminder on/off for every team I follow. */
export async function setTeamFollowsGameDay(on) {
  const user = await sessionUser()
  if (!user) throw new Error('not-authenticated')
  const { error } = await supabase
    .from('follows')
    .update({ game_day: !!on })
    .eq('user_id', user.id)
    .eq('target_type', 'team')
  if (error) throw error
}
