/**
 * The two players' cards for the game-preview stage (GameHero's PreviewStage). The card is
 * the league-wide one (fl/cards/PlayerStatCard, same as /cards), so its design and numbers
 * stay in one place. Order: [away, home] — away LEFT, home RIGHT, like the clip.
 */
import { usePlayerCards } from "@/components/fl/cards/PlayerStatCard"

export function usePreviewCards(preview) {
  return usePlayerCards([preview.away?.playerId, preview.home?.playerId])
}
