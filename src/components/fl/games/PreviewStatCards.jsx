/**
 * EA FC line-up overlay: the two players' cards sit ON the game-preview clip, bottom corners
 * (away LEFT, home RIGHT, like the clip). The clip already shows the players, so each card
 * shrinks his cutout to a portrait chip. Data + radar come from fl/cards/PlayerStatCard.
 */
import { Radar, usePlayerCards } from "@/components/fl/cards/PlayerStatCard"
import { CrestDisc } from "@/components/fl/Floodlight"

function OverlayCard({ who, team, card }) {
  const accent = team?.primary_color || "#4ade80"
  return (
    <div dir="rtl" className="pointer-events-auto relative min-w-0 w-[48%] sm:w-[232px] overflow-hidden rounded-2xl border border-white/15 bg-[rgba(8,11,17,0.66)] backdrop-blur-md text-white p-2 sm:p-3 shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start gap-1.5 sm:gap-2">
        {card?.cutout
          ? <img src={card.cutout} alt="" decoding="async" className="size-8 sm:size-12 shrink-0 rounded-lg object-cover object-top bg-white/5" />
          : <span className="size-8 sm:size-12 shrink-0 rounded-lg bg-white/5" />}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] sm:text-[15px] font-black leading-tight break-words">{who.name}</p>
          <p className="mt-0.5 flex items-start gap-1 text-[10.5px] sm:text-[11.5px] font-bold text-white/80 min-w-0">
            <CrestDisc team={team} size={14} disc={false} />
            <span className="leading-tight">{team?.name}</span>
          </p>
          <p className="text-[10px] sm:text-[11px] text-white/65 whitespace-nowrap">
            {card?.goalie ? "שוער" : "שחקן שדה"}
            {who.number != null && <span dir="ltr"> · #{who.number}</span>}
          </p>
        </div>
        <div className="text-left leading-none shrink-0">
          <span className="block text-[9px] font-bold tracking-wide text-white/60" dir="ltr">OVR</span>
          <span className="block fl-num text-[24px] sm:text-[32px] font-black text-[#4ade80] tabular-nums" dir="ltr">{card?.ovr ?? "–"}</span>
        </div>
      </div>
      <div className="mt-1 border-t border-white/10 pt-0.5">
        {card?.axes ? <Radar axes={card.axes} /> : <div className="aspect-square max-w-[160px] mx-auto" />}
      </div>
    </div>
  )
}

/** Absolute layer — render inside the clip's relative box. */
export default function PreviewStatCards({ preview, home, away }) {
  const cards = usePlayerCards([preview.away?.playerId, preview.home?.playerId])
  return (
    <div dir="ltr" className="pointer-events-none absolute inset-x-2 sm:inset-x-6 bottom-2 sm:bottom-4 z-10 flex items-end justify-between gap-2">
      <OverlayCard who={preview.away} team={away} card={cards?.[0]} />
      <OverlayCard who={preview.home} team={home} card={cards?.[1]} />
    </div>
  )
}

export function PreviewStatsNote() {
  return (
    <p className="relative mt-2 text-center text-[10.5px] leading-relaxed text-white/60">
      שערים: העונה · ניסיון (משחקים), התקפה / הגנה: ממוצע השערים שהקבוצה הבקיעה / ספגה במשחקים שבהם שיחק · אוהדים: עוקבים אמיתיים
    </p>
  )
}
