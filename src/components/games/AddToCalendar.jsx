import { CalendarPlus } from "@/components/icons/BrandIcons"
import { buildIcs, googleEventUrl } from "@/lib/ics"
import { downloadBlob } from "@/lib/scheduleExport"

/**
 * One upcoming game → the viewer's calendar. Google gets its "add event" link (it can't
 * open an .ics by click); everything else (iPhone, Outlook) opens the downloaded .ics.
 * For the whole season, the /games calendar offers a live subscription instead.
 */
export default function AddToCalendar({ game, teamsMap }) {
  if (!game || game.status !== "scheduled") return null
  const site = window.location.origin
  const downloadIcs = () => downloadBlob(
    buildIcs([game], teamsMap, { site }),
    `${game.slug || game.id}.ics`,
    "text/calendar;charset=utf-8",
  )

  return (
    <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <p className="text-sm font-semibold text-fg-strong flex items-center gap-2">
        <CalendarPlus className="w-4 h-4 text-brand" /> הוספת המשחק ליומן
      </p>
      <div className="flex gap-2 shrink-0">
        <button type="button" onClick={downloadIcs} className="btn btn-secondary btn-sm">אייפון / Outlook</button>
        <a href={googleEventUrl(game, teamsMap, site)} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
          Google
        </a>
      </div>
    </div>
  )
}
