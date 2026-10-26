import { useState, useEffect, useRef, useMemo } from "react"
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react"
import { getGames, getTeams } from "@/lib/api"
import { gameLabel, pickerGames, filterGameOptions } from "@/lib/gamePosts"
import { MatchFallback } from "@/components/icons/BrandIcons"

/**
 * "שייך למשחק" — attach a post to a game (posts.game_id). Used by the composer, the
 * inline post editor and the post's ⋯ menu (GamePickerModal). Lists recent + upcoming
 * non-test games (lib/gamePosts.js pickerGames), newest matchday first, with a search
 * box once the list is long, and "ללא משחק" to clear.
 */

// One fetch per page load, shared by every picker on the page.
let cache = null
function loadGames() {
  if (!cache) {
    cache = Promise.all([getGames("game_date", false), getTeams()])
      .then(([games, teams]) => ({ games: games || [], teamsMap: Object.fromEntries((teams || []).map(t => [t.id, t])) }))
      .catch(err => { cache = null; throw err })
  }
  return cache
}

/** Options for the picker: [{ id, label, game }] (+ teamsMap for the caller's chip). */
export function usePickerGames(currentId, enabled = true) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled || data) return
    let alive = true
    loadGames().then(d => alive && setData(d)).catch(() => alive && setError(true))
    return () => { alive = false }
  }, [enabled, data])
  const options = useMemo(() => data
    ? pickerGames(data.games, { currentId }).map(g => ({ id: g.id, label: gameLabel(g, data.teamsMap), game: g }))
    : null, [data, currentId])
  return { options, teamsMap: data?.teamsMap || {}, error }
}

const SEARCH_FROM = 8

/** The list itself: search box + "ללא משחק" + games. onPick(option | null). */
function GameOptionList({ value, options, error, onPick, autoFocus }) {
  const [q, setQ] = useState("")
  const shown = options ? filterGameOptions(options, q) : []
  const row = "w-full flex items-center gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-700"
  return (
    <div>
      {options && options.length > SEARCH_FROM && (
        <div className="p-2 border-b border-slate-100 dark:border-slate-700">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400 pointer-events-none" />
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus={autoFocus} placeholder="חיפוש קבוצה או תאריך…"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg ps-8 pe-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
        </div>
      )}
      <div role="listbox" className="max-h-64 overflow-y-auto overscroll-contain py-1">
        {!options && !error && (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> טוען משחקים…</p>
        )}
        {error && <p className="py-4 text-center text-xs text-red-500">טעינת המשחקים נכשלה</p>}
        {options && (
          <button type="button" role="option" aria-selected={!value} onClick={() => onPick(null)}
            className={`${row} text-slate-500 dark:text-slate-400`}>
            <span className="w-4 shrink-0">{!value && <Check className="w-4 h-4 text-brand" />}</span> ללא משחק
          </button>
        )}
        {shown.map(o => (
          <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => onPick(o)}
            className={`${row} ${o.id === value ? "font-semibold text-brand dark:text-brand-light" : "text-slate-700 dark:text-slate-200"}`}>
            <span className="w-4 shrink-0">{o.id === value && <Check className="w-4 h-4" />}</span>
            <span className="truncate">{o.label}</span>
          </button>
        ))}
        {options && q && !shown.length && <p className="py-3 text-center text-xs text-slate-500">לא נמצאו משחקים</p>}
      </div>
    </div>
  )
}

/**
 * Inline dropdown for a form (composer / editor). value = game id or "".
 * onChange(id | "", option | null).
 */
export default function GamePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const { options, error } = usePickerGames(value || null, open || !!value)
  const current = options?.find(o => o.id === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-1">
        <button type="button" disabled={disabled} onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
          className={`min-w-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors disabled:opacity-50 ${
            value ? "border-brand/40 bg-brand/[0.06] text-brand dark:text-brand-light" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"}`}>
          <MatchFallback className="w-4 h-4" />
          <span className="truncate">{value ? (current?.label || "משחק") : "שייך למשחק (לא חובה)"}</span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        </button>
        {value && !disabled && (
          <button type="button" onClick={() => onChange("", null)} aria-label="הסר שיוך למשחק"
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full start-0 mt-1 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
          <GameOptionList value={value || null} options={options} error={error} autoFocus
            onPick={o => { onChange(o?.id || "", o); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

/** The ⋯-menu flavour: a small modal; picking saves straight away via onSave(id | null, option). */
export function GamePickerModal({ value, onSave, onClose }) {
  const { options, error } = usePickerGames(value || null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const pick = async (o) => {
    if (busy) return
    if ((o?.id || null) === (value || null)) { onClose(); return }
    setBusy(true); setFailed(false)
    try { await onSave(o?.id || null, o); onClose() }
    catch { setFailed(true); setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onMouseDown={onClose}>
      <div className="card w-full max-w-sm overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <MatchFallback className="w-4 h-4" /> {value ? "שנה משחק" : "שייך למשחק"}
          </h3>
          <button type="button" onClick={onClose} aria-label="סגור"
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        </div>
        <div className={busy ? "pointer-events-none opacity-60" : ""}>
          <GameOptionList value={value || null} options={options} error={error} onPick={pick} autoFocus />
        </div>
        {failed && <p className="px-4 pb-3 text-xs text-red-500">השמירה נכשלה, נסו שוב</p>}
      </div>
    </div>
  )
}
