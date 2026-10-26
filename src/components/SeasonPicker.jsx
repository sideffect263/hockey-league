import { useEffect, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { Check, ChevronDown } from "lucide-react"
import { History } from "@/components/icons/BrandIcons"
import { useSeasons, useSeasonPin } from "@/App"

// Swatch per seasons.palette — the hue the site turns when that season is viewed.
const PALETTE_SWATCH = { rink: "#3B4FC4", classic: "#F97316" }

/**
 * The season the visitor is looking at: the one in /archive/<slug> while on an
 * archived season's page, otherwise the live season. Matches slug or UUID,
 * because old /archive/<uuid> links still resolve.
 */
export function useViewedSeason() {
  const seasons = useSeasons()
  const [pinnedId] = useSeasonPin()
  const { pathname } = useLocation()
  const live = seasons.find(s => s.status === "active") || null
  const m = /^\/archive\/([^/]+)/.exec(pathname)
  if (!m) {
    // A page pinned to a past season (an old game) — see usePinSeason.
    const pinned = pinnedId && seasons.find(s => s.id === pinnedId)
    return pinned && pinned.status !== "active" ? { season: pinned, live, isPast: true } : { season: live, live, isPast: false }
  }
  const key = decodeURIComponent(m[1])
  const season = seasons.find(s => s.slug === key || s.id === key) || null
  return { season: season || live, live, isPast: !!season && season.status !== "active" }
}

/**
 * For a page that belongs to one season wherever its URL says otherwise — an old
 * game at /games/<slug>: while it is mounted, the header badge and palette follow
 * that season. Returns the season row when it is a PAST one (for a banner), else null.
 */
export function usePinSeason(seasonId) {
  const seasons = useSeasons()
  const [, setPinned] = useSeasonPin()
  useEffect(() => {
    if (!seasonId) return
    setPinned(seasonId)
    return () => setPinned(null)
  }, [seasonId, setPinned])
  const season = seasonId ? seasons.find(s => s.id === seasonId) : null
  return season && season.status !== "active" ? season : null
}

/**
 * Puts `season-classic` on <html> while the viewed season's palette is
 * 'classic' (see index.css), so last season shows in the colours it wore.
 * Also re-skins the whole site if the LIVE season is ever set to a palette.
 */
export function SeasonPaletteSync() {
  const { season } = useViewedSeason()
  const palette = season?.palette || "rink"
  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle("season-classic", palette === "classic")
    return () => el.classList.remove("season-classic")
  }, [palette])
  return null
}

/**
 * The "עונת 2026-27" badge under the league wordmark. Click → pick a season:
 * the live one, or any archived one (its standings, players and games at
 * /archive/<slug>, in that season's palette).
 */
export default function SeasonPicker() {
  const seasons = useSeasons()
  const { season, isPast } = useViewedSeason()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])
  useEffect(() => { setOpen(false) }, [pathname])

  if (!season) return null
  const hasPast = seasons.some(s => s.status === "archived")

  return (
    <div ref={wrapRef} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`עונת ${season.name} — בחירת עונה`}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          isPast
            ? "bg-brand text-brand-fg hover:bg-brand-hover"
            : "bg-brand/10 text-brand-strong dark:text-brand-light hover:bg-brand/20"
        }`}
      >
        {isPast && <History className="w-4 h-4" aria-hidden="true" />}
        עונת {season.name}
        {hasPast && <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />}
      </button>

      {open && (
        <div className="absolute start-0 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface-nav shadow-xl z-50">
          <p className="px-3.5 pt-3 pb-1.5 text-[11px] font-bold text-fg-subtle">בחירת עונה</p>
          <ul className="pb-1">
            {seasons.map(s => {
              const live = s.status === "active"
              const selected = s.id === season.id
              return (
                <li key={s.id}>
                  <Link
                    to={live ? "/standings" : `/archive/${encodeURIComponent(s.slug || s.id)}`}
                    onClick={() => setOpen(false)}
                    aria-current={selected ? "true" : undefined}
                    className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors ${selected ? "bg-brand/10" : "hover:bg-surface-sunken"}`}
                  >
                    <span className="size-3 rounded-full shrink-0 ring-2 ring-white/70 dark:ring-black/30" style={{ background: PALETTE_SWATCH[s.palette] || PALETTE_SWATCH.rink }} aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-fg-strong">עונת {s.name}</span>
                      <span className="block text-[11px] text-fg-muted">{live ? "העונה הנוכחית" : "עונה שהסתיימה · טבלה, שחקנים ומשחקים"}</span>
                    </span>
                    {selected && <Check className="w-4 h-4 text-brand-strong dark:text-brand-light shrink-0" aria-hidden="true" />}
                  </Link>
                </li>
              )
            })}
          </ul>
          {hasPast && (
            <Link to="/archive" onClick={() => setOpen(false)} className="block border-t border-line px-3.5 py-2.5 text-xs font-semibold text-brand-strong dark:text-brand-light hover:bg-surface-sunken">
              ארכיון כל העונות ←
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
