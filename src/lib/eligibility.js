/**
 * Game-day eligibility rules for the judge board — pure, no I/O (the rows come from
 * getGamePlayerEligibility in ./suspensions.js). Pinned by scripts/check-eligibility.mjs.
 *
 *   • suspended            → "מושעה" (a red card still being served)
 *   • !medical_valid       → "אין אישור רפואי בתוקף"
 *
 * A player with no row (e.g. borrowed from a third team, or a free-text guest) is
 * UNKNOWN, not blocked: the RPC only covers the two teams' rosters, and refusing
 * someone we never checked would be worse than letting the judge decide. Likewise,
 * when the rows failed to load the caller passes `null` and nobody is blocked.
 */

export const REASON = {
  suspended: 'suspended',
  medical: 'medical',
}

export const REASON_LABEL = {
  [REASON.suspended]: 'מושעה',
  [REASON.medical]: 'אין אישור רפואי בתוקף',
}

/** rows → Map(player_id → row). `null`/`undefined` (not loaded / failed) stays as-is. */
export function eligibilityMap(rows) {
  if (!rows) return rows ?? null
  return new Map(rows.filter(r => r?.player_id).map(r => [r.player_id, r]))
}

/** Reasons a player may not play — [] when eligible, unknown, or eligibility unavailable. */
export function ineligibleReasons(map, playerId) {
  if (!map || !playerId) return []
  const r = map.get(playerId)
  if (!r) return []
  const out = []
  if (r.suspended) out.push(REASON.suspended)
  if (r.medical_valid === false) out.push(REASON.medical)
  return out
}

/** Is this player blocked from being picked? `allowed` = ids an admin/LM let through anyway. */
export function isBlocked(map, playerId, allowed = []) {
  if (!playerId) return false
  if (allowed && (allowed instanceof Set ? allowed.has(playerId) : allowed.includes(playerId))) return false
  return ineligibleReasons(map, playerId).length > 0
}

/** Whether we have a row for this player at all (false → "not checked"). */
export function isChecked(map, playerId) {
  return !!(map && playerId && map.has(playerId))
}

/** Split a roster into pickable / blocked, preserving order. Guests (no id) are pickable. */
export function splitByEligibility(players, map, allowed = []) {
  const eligible = [], blocked = []
  for (const p of players || []) (isBlocked(map, p?.id, allowed) ? blocked : eligible).push(p)
  return { eligible, blocked }
}
