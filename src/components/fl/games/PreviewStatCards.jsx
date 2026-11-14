/**
 * The two players for the game-preview stage (GameHero's PreviewStage): [away, home] — away
 * LEFT, home RIGHT, like the clips. A side with a face player (gamePreviewVideo.js FACES) shows
 * him; a side without one shows the team's best-rated player right now. The card itself is the
 * league-wide one (fl/cards/PlayerStatCard, same as /cards).
 */
import { useEffect, useState } from "react"
import { loadLeague, cardFor } from "@/components/fl/cards/PlayerStatCard"
import { playerCard } from "@/components/fl/cards/playerRating"

/** The team's highest-OVR player (ties → most games), or null. */
function bestOf(teamId, d) {
  let best = null, bo = -Infinity
  for (const p of Object.values(d.players)) {
    if (p.team_id !== teamId || p.is_referee) continue
    const c = playerCard(p.id, d)
    const score = (c?.ovr ?? -1) * 1000 + (d.totals.get(p.id)?.gp ?? 0)
    if (score > bo) { bo = score; best = p.id }
  }
  return best
}

/** [{ who, card }, { who, card }] for away and home, or null while loading. */
export function usePreviewSides(preview) {
  const a = preview.away, h = preview.home
  const key = [a?.teamId, a?.playerId, h?.teamId, h?.playerId].join(",")
  const [sides, setSides] = useState(null)
  useEffect(() => {
    let live = true
    const side = (s, d) => {
      const id = s?.playerId || (s?.teamId ? bestOf(s.teamId, d) : null)
      if (!id) return null
      const p = d.players[id]
      const name = s.name || [p?.first_name, p?.last_name].filter(Boolean).join(" ")
      return { who: { name, number: p?.jersey_number ?? null, playerId: id }, card: cardFor(id, d) }
    }
    loadLeague()
      .then(d => { if (live) setSides([side(a, d), side(h, d)]) })
      .catch(() => { if (live) setSides([]) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return sides
}
