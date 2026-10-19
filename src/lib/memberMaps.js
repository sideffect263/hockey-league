// Pure: imported by api/game-form.js as well as the browser bundle — keep it free of
// the Supabase client and of Vite-only imports.

/**
 * Build lookup maps from membership rows. `players` is optional but recommended:
 * each player's primary team_id is unioned in as a safety net so a roster can
 * never lose a player if a membership row is missing.
 *   → { byTeam: Map<teamId, Set<playerId>>, byPlayer: Map<playerId, [{team_id, age_group}]> }
 */
export function buildMemberMaps(rows = [], players = []) {
  const byTeam = new Map()
  const byPlayer = new Map()
  const add = (teamId, playerId, ageGroup) => {
    if (!teamId || !playerId) return
    if (!byTeam.has(teamId)) byTeam.set(teamId, new Set())
    byTeam.get(teamId).add(playerId)
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, [])
    const list = byPlayer.get(playerId)
    if (!list.some(m => m.team_id === teamId)) list.push({ team_id: teamId, age_group: ageGroup })
  }
  for (const r of rows) add(r.team_id, r.player_id, r.age_group)
  // Fallback: the primary team always counts (real-age rows already added win the dedupe).
  for (const p of players) if (p?.team_id) add(p.team_id, p.id, null)
  return { byTeam, byPlayer }
}
