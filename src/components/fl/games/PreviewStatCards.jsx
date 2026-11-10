/**
 * EA FC-style player cards under the game-preview clip: the two players in the video.
 * The card itself lives in fl/cards/PlayerStatCard. Physical left → right: away, home.
 */
import { PlayerStatCard, usePlayerCards } from "@/components/fl/cards/PlayerStatCard"

export default function PreviewStatCards({ preview, home, away }) {
  const cards = usePlayerCards([preview.away?.playerId, preview.home?.playerId])
  return (
    <div dir="ltr" className="relative mt-3 grid grid-cols-2 gap-2 sm:gap-4 max-w-2xl mx-auto">
      <PlayerStatCard who={preview.away} team={away} card={cards?.[0]} />
      <PlayerStatCard who={preview.home} team={home} card={cards?.[1]} />
      <p dir="rtl" className="col-span-2 text-center text-[10.5px] leading-relaxed text-white/60">
        שערים: העונה · ניסיון (משחקים), התקפה / הגנה: ממוצע השערים שהקבוצה הבקיעה / ספגה במשחקים שבהם שיחק · אוהדים: עוקבים אמיתיים
      </p>
    </div>
  )
}
