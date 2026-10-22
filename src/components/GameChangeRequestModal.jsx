import { useState, useEffect } from "react"
import { format } from "date-fns"
import { motion } from "framer-motion"
import { X, CalendarClock, Send, Plus, Trash2 } from "lucide-react"
import { requestGameChange } from "@/lib/gameRequests"
import { getVenues } from "@/lib/venues"
import { ilDate } from "@/lib/ilTime"

const MAX_DATES = 3

/**
 * Coach-facing modal to request a reschedule. The coach proposes up to 3 candidate
 * date/times and/or a new venue (from the managed list) + a reason. The request goes
 * to the OPPONENT coach to pick which dates work, then to the league manager to
 * finalize one. Only the fields actually changed are sent.
 */
export default function GameChangeRequestModal({ game, home, away, onClose, onSubmitted }) {
  const [dates, setDates] = useState([""])
  const [venue, setVenue] = useState("")
  const [reason, setReason] = useState("")
  const [venues, setVenues] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { getVenues().then(setVenues).catch(() => {}) }, [])

  const setDateAt = (i, v) => setDates(d => d.map((x, j) => (j === i ? v : x)))
  const addDate = () => setDates(d => (d.length < MAX_DATES ? [...d, ""] : d))
  const removeDate = (i) => setDates(d => d.filter((_, j) => j !== i))

  const cleanDates = dates.map(d => d.trim()).filter(Boolean)
  const canSubmit = (cleanDates.length > 0 || !!venue) && !!reason.trim() && !saving

  const submit = async () => {
    setError(null)
    if (cleanDates.length === 0 && !venue) { setError("יש להציע תאריך/שעה או מגרש"); return }
    if (!reason.trim()) { setError("יש להזין סיבה לבקשה"); return }
    setSaving(true)
    try {
      await requestGameChange(game.id, {
        dates: cleanDates.map(d => new Date(d).toISOString()),
        venue: venue || null,
        reason: reason.trim(),
      })
      onSubmitted?.()
      onClose()
    } catch (e) { setError(e.message || "שגיאה בשליחת הבקשה") }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
            <CalendarClock className="w-5 h-5 text-brand" /> בקשת שינוי למשחק
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {home?.name || "בית"} <span className="text-slate-400">נגד</span> {away?.name || "חוץ"}
          <span className="block text-xs mt-1">
            כרגע: {game.game_date ? format(ilDate(game.game_date), "d/M/yyyy HH:mm") : "—"}{" · "}{game.venue || "ללא מגרש"}
          </span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">תאריכים מוצעים (עד {MAX_DATES})</label>
            <div className="space-y-2">
              {dates.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="datetime-local" value={d} onChange={(e) => setDateAt(i, e.target.value)} className="filter-input flex-1" />
                  {dates.length > 1 && (
                    <button onClick={() => removeDate(i)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
            </div>
            {dates.length < MAX_DATES && (
              <button onClick={addDate} className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-hover transition-colors">
                <Plus className="w-3.5 h-3.5" /> הוסף תאריך חלופי
              </button>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">מגרש</label>
            <select value={venue} onChange={(e) => setVenue(e.target.value)} className="filter-input w-full">
              <option value="">ללא שינוי מגרש</option>
              {venues.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">סיבה <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="למשל: המגרש תפוס, חפיפה עם משחק אחר, מזג אוויר…"
              className="filter-input w-full resize-none" />
          </div>
        </div>

        {error && <div className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
          הבקשה תישלח קודם למאמן הקבוצה היריבה לבחירת המועד המתאים, ולאחר מכן למנהל הליגה לאישור סופי.
        </p>

        <div className="flex gap-2">
          <button onClick={submit} disabled={!canSubmit}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-brand-fg text-sm font-semibold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Send className="w-4 h-4" /> {saving ? "שולח…" : "שלח בקשה"}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">ביטול</button>
        </div>
      </motion.div>
    </div>
  )
}
