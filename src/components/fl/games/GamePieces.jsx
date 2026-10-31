/**
 * Smaller Floodlight game-page pieces (GameStage / Game boards, iOS GameDetailView):
 * quick actions (ליומן · ניווט), the stage cards (game-day broadcast note, postponed),
 * the two-sided goals list and the section shell used by the page.
 */
import { useEffect, useRef, useState } from "react"
import { CalendarPlus, Broadcast, CalendarMove, GoalIcon, InfoIcon } from "@/components/icons/BrandIcons"
import { Utensils } from "lucide-react"
import { CrestDisc } from "@/components/fl/Floodlight"
import { buildIcs, googleEventUrl } from "@/lib/ics"
import { downloadBlob } from "@/lib/scheduleExport"
import { hasPin, wazeNavigateUrl, googleMapsDirectionsUrl } from "@/lib/mapPin"
import { minuteMark } from "./flGamesKit"

/** A Floodlight section: 22px title, optional note, then its body. */
export function FLSection({ title, note, action, children, card = true, className = "", id, labelledBy }) {
  return (
    <section id={id} aria-label={labelledBy ? undefined : title} className={`${card ? "fl-card p-4" : ""} ${className}`}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-3 mb-3 px-0.5">
          {title && <h2 className="text-[20px] sm:text-[22px] font-extrabold text-fg-strong leading-tight">{title}</h2>}
          {note && <span className="text-[12px] text-fg-muted">{note}</span>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** A popover menu under a quick-action tile. Closes on outside click / Escape. */
function useOutside(open, close) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === "Escape") close() }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open, close])
  return ref
}

function Tile({ icon, label, onClick, expanded, aria }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={expanded} aria-haspopup="menu" aria-label={aria}
      className="w-full min-h-[64px] rounded-[16px] border border-line bg-surface text-fg-strong flex flex-col items-center justify-center gap-1 text-[13px] font-bold hover:bg-surface-sunken transition-colors">
      {icon}{label}
    </button>
  )
}

const menuCls = "absolute z-30 top-full mt-2 inset-x-0 min-w-[12rem] rounded-[16px] bg-surface border border-line shadow-xl p-1.5 flex flex-col fl-fade-in"
const itemCls = "min-h-11 px-3 rounded-[12px] flex items-center text-[14px] font-semibold text-fg-strong hover:bg-surface-sunken text-right"

/**
 * ליומן (scheduled games) + ניווט (scheduled or live, when the game has a rink). ניווט
 * offers Waze / Google Maps from the venue pin (venues.lat/lng), else searches the
 * address or "מגרש <name>".
 */
export function GameQuickActions({ game, teamsMap, venue, showCalendar, showNav }) {
  const [menu, setMenu] = useState(null) // 'cal' | 'nav' | null
  const close = () => setMenu(null)
  const calRef = useOutside(menu === "cal", close)
  const navRef = useOutside(menu === "nav", close)
  const vName = game.venue?.trim()
  if (!showCalendar && !(showNav && vName)) return null

  const site = typeof window !== "undefined" ? window.location.origin : "https://rinkhockeyil.com"
  const ics = () => { close(); downloadBlob(buildIcs([game], teamsMap, { site }), `${game.slug || game.id}.ics`, "text/calendar;charset=utf-8") }
  const query = encodeURIComponent(venue?.address || `מגרש ${vName} ${venue?.city || ""}`.trim())
  const nav = venue && hasPin(venue)
    ? { waze: wazeNavigateUrl(venue), google: googleMapsDirectionsUrl(venue) }
    : { waze: `https://waze.com/ul?q=${query}&navigate=yes`, google: `https://www.google.com/maps/search/?api=1&query=${query}` }

  return (
    <div className="grid grid-cols-2 gap-2">
      {showCalendar && (
        <div ref={calRef} className="relative">
          <Tile icon={<CalendarPlus className="size-[26px]" />} label="ליומן" aria="הוספת המשחק ליומן"
            expanded={menu === "cal"} onClick={() => setMenu(m => (m === "cal" ? null : "cal"))} />
          {menu === "cal" && (
            <div role="menu" className={menuCls}>
              <button role="menuitem" type="button" onClick={ics} className={itemCls}>יומן אייפון / Outlook</button>
              <a role="menuitem" href={googleEventUrl(game, teamsMap, site)} target="_blank" rel="noopener noreferrer" onClick={close} className={itemCls}>יומן Google</a>
            </div>
          )}
        </div>
      )}
      {showNav && vName && (
        <div ref={navRef} className={`relative ${showCalendar ? "" : "col-span-2"}`}>
          <Tile label="ניווט" aria={`ניווט למגרש ${vName}`} expanded={menu === "nav"} onClick={() => setMenu(m => (m === "nav" ? null : "nav"))}
            icon={<svg width="24" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></svg>} />
          {menu === "nav" && (
            <div role="menu" className={menuCls}>
              {venue?.address && <span className="px-3 pt-1.5 pb-1 text-[12px] text-fg-muted">{venue.address}</span>}
              <a role="menuitem" href={nav.waze} target="_blank" rel="noopener noreferrer" onClick={close} className={itemCls}>Waze</a>
              <a role="menuitem" href={nav.google} target="_blank" rel="noopener noreferrer" onClick={close} className={itemCls}>Google Maps</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Game day: the stream opens by itself when the judge starts the board. */
export function BroadcastNote() {
  return (
    <section aria-label="השידור" className="rounded-[18px] bg-[#11161D] text-white p-3.5 flex items-center gap-3">
      <Broadcast className="size-[46px] shrink-0" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-extrabold">השידור מתחיל עם המשחק</span>
        <span className="text-[12.5px] opacity-80">ייפתח כאן לבד כשהשופט יפעיל את הלוח.</span>
      </span>
    </section>
  )
}

/** Postponed: what happened and what is kept (reminders stop; sign-ups ask again). */
export function PostponedCards() {
  return (
    <div id="availability" className="scroll-mt-20 flex flex-col gap-3.5">
      <section aria-label="נדחה" className="fl-card p-4 border-2 border-dashed border-fg-muted/45 flex flex-col gap-2.5">
        <div className="flex items-center gap-3">
          <CalendarMove className="size-[46px] shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px] font-extrabold text-fg-strong">המשחק נדחה</span>
            <span className="text-[13px] text-fg-muted">המועד החדש ייקבע בהמשך</span>
          </span>
        </div>
        <p className="text-[13.5px] text-fg-strong leading-relaxed">
          התזכורות נעצרו. כשייקבע מועד, כל מי שאמר "מגיע" יתבקש לאשר שוב, וכולם יקבלו התראה.
        </p>
      </section>
      <FLSection title="מה נשמר">
        <p className="text-[13.5px] text-fg-muted">ההרשמות נשארות, עם סימן "נא לאשר שוב".</p>
      </FLSection>
    </div>
  )
}

/** Kiosk (tri-state: null renders nothing) and the league's note on the game. */
export function KioskAndNotes({ game }) {
  if (game.kiosk_open == null && !game.notes) return null
  return (
    <>
      {game.kiosk_open != null && (
        <p className="fl-card px-3.5 py-3 flex items-center gap-2 text-[13px] font-semibold text-fg-strong">
          <Utensils className="size-4 shrink-0" aria-hidden="true" />
          {game.kiosk_open ? "דוכן אוכל פתוח במגרש" : "אין דוכן אוכל, כדאי להביא מהבית"}
        </p>
      )}
      {game.notes && (
        <p className="fl-card px-3.5 py-3 flex items-start gap-2 text-[13.5px] text-fg-strong">
          <InfoIcon className="size-5 shrink-0" />{game.notes}
        </p>
      )}
    </>
  )
}

/**
 * "שערים" — two-sided: home rows on the RIGHT, away rows mirrored on the LEFT, each
 * with the running score and the minute when the board recorded it; from the box score
 * (no minutes) a scorer's goal count instead.
 */
export function GoalsList({ rows, home, away }) {
  if (!rows?.length) return null
  return (
    <FLSection title="שערים" card={false}>
      <ul className="fl-card px-4 py-2">
        {rows.map((r, i) => (
          <li key={r.id} className={`flex items-center gap-2.5 min-h-[52px] ${r.home ? "" : "flex-row-reverse"} ${i < rows.length - 1 ? "border-b border-line" : ""}`}>
            <CrestDisc team={r.home ? home : away} size={28} />
            <span className={`text-[15px] font-semibold text-fg-strong truncate min-w-0 ${r.home ? "" : "text-left"}`}>{r.who}</span>
            <span className="flex-1" />
            {r.score && (
              <span dir="ltr" className="flex gap-0.5 text-[13px] font-bold text-fg-muted" aria-label={`בית ${r.score[0]}, חוץ ${r.score[1]}`}>
                <span>{r.score[1]}</span><span>:</span><span>{r.score[0]}</span>
              </span>
            )}
            {r.minute != null && <span dir="ltr" className="fl-num text-[20px] text-fg-muted w-11 text-center">{minuteMark(r.minute)}</span>}
            {r.minute == null && r.count > 0 && (
              <span className="inline-flex items-center gap-0.5 fl-num text-[18px] text-fg-strong" aria-label={`${r.count} שערים`}>
                <span dir="ltr">{r.count}</span><GoalIcon className="size-5" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </FLSection>
  )
}
