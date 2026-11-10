/**
 * EA FC line-up cards for the game-preview stage (GameHero's PreviewStage): the two
 * players' cards sit on the clip, away LEFT, home RIGHT, like the clip. The clip already shows the players, so each card
 * shrinks his cutout to a portrait chip. Data + radar come from fl/cards/PlayerStatCard.
 */
import { Radar, usePlayerCards } from "@/components/fl/cards/PlayerStatCard"
import { CrestDisc } from "@/components/fl/Floodlight"

function OverlayCard({ who, team, card }) {
  const accent = team?.primary_color || "#4ade80"
  return (
    <div dir="rtl" className="relative min-w-0 w-full overflow-hidden rounded-2xl border border-white/15 bg-[rgba(8,11,17,0.66)] backdrop-blur-md text-white p-2.5 sm:p-3.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 pt-1 text-[15px] sm:text-[18px] font-black leading-tight truncate">{who.name}</p>
        <div className="text-left leading-none shrink-0">
          <span className="block text-[9px] font-bold tracking-wide text-white/60" dir="ltr">OVR</span>
          <span className="block fl-num text-[30px] sm:text-[40px] font-black text-[#4ade80] tabular-nums" dir="ltr">{card?.ovr ?? "–"}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {card?.cutout
          ? <img src={card.cutout} alt="" decoding="async" className="size-11 sm:size-14 shrink-0 rounded-lg object-cover object-top bg-white/5" />
          : <span className="size-11 sm:size-14 shrink-0 rounded-lg bg-white/5" />}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11.5px] sm:text-[13px] font-bold text-white/85 min-w-0">
            <CrestDisc team={team} size={16} disc={false} />
            <span className="leading-tight">{team?.name}</span>
          </p>
          <p className="text-[11px] sm:text-[12px] text-white/70 whitespace-nowrap">
            {card?.goalie ? "שוער" : "שחקן שדה"}
            {who.number != null && <span dir="ltr"> · #{who.number}</span>}
          </p>
        </div>
      </div>
      <div className="mt-1.5 border-t border-white/10 pt-1 [&_svg]:max-w-[200px] sm:[&_svg]:max-w-[230px]">
        {card?.axes ? <Radar axes={card.axes} /> : <div className="aspect-square max-w-[160px] mx-auto" />}
      </div>
    </div>
  )
}

/** The two players' card data, [away, home]. */
export function usePreviewCards(preview) {
  return usePlayerCards([preview.away?.playerId, preview.home?.playerId])
}

export { OverlayCard }
