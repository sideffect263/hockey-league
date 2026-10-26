import { useState, useEffect } from "react"
import { format } from "date-fns"
import { Check, X, Loader2 } from "lucide-react"
import { CalendarClock } from "@/components/icons/BrandIcons"
import { getOpenGameChangeRequest, respondGameChangeOpponent } from "@/lib/gameRequests"

/**
 * #5 — the opposing team's coach responds to a reschedule request: tick the proposed
 * date(s) that work, then approve (→ league manager) or reject. Renders only for a
 * game with a 'pending_opponent' request where the viewer coaches the OTHER team.
 */
export default function GameChangeOpponentCard({ game, coachTeamIds = [], onResponded }) {
  const [req, setReq] = useState(null)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    getOpenGameChangeRequest(game.id).then(r => { if (alive) setReq(r) }).catch(() => {})
    return () => { alive = false }
  }, [game.id])

  if (!req || req.status !== "pending_opponent") return null
  const myTeamInGame = (coachTeamIds || []).find(t => t === game.home_team_id || t === game.away_team_id)
  const isOpponentCoach = myTeamInGame && myTeamInGame !== req.team_id
  if (!isOpponentCoach) return null

  const proposed = Array.isArray(req.proposed_dates) ? req.proposed_dates : []
  const toggle = (d) => setPicked(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d]))

  const respond = async (approve) => {
    setError(null)
    if (approve && proposed.length > 0 && picked.length === 0) { setError("יש לסמן לפחות מועד אחד שמתאים"); return }
    setBusy(true)
    try { await respondGameChangeOpponent(req.id, picked, approve); setDone(approve ? "approved" : "rejected"); onResponded?.() }
    catch (e) { setError(e.message || "הפעולה נכשלה") }
    finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="card p-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
        {done === "approved" ? "המועדים שסימנת נשלחו למנהל הליגה לאישור סופי ✓" : "הבקשה נדחתה."}
      </div>
    )
  }

  return (
    <div className="card p-4 space-y-3 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2">
        <CalendarClock className="w-4 h-4" /> בקשת שינוי מהקבוצה היריבה
      </p>
      {req.reason && <p className="text-sm text-slate-600 dark:text-slate-300 italic">"{req.reason}"</p>}
      {req.proposed_venue && <p className="text-xs text-slate-500 dark:text-slate-400">מגרש מוצע: <span className="font-semibold">{req.proposed_venue}</span></p>}

      {proposed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">סמן/י את המועדים שמתאימים לך:</p>
          {proposed.map(d => (
            <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={picked.includes(d)} onChange={() => toggle(d)} className="accent-brand" />
              <span className="text-slate-800 dark:text-slate-200">{format(new Date(d), "EEEE d/M/yyyy · HH:mm")}</span>
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={() => respond(true)} disabled={busy}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} מאשר/ת את המועדים
        </button>
        <button onClick={() => respond(false)} disabled={busy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
          <X className="w-3.5 h-3.5" /> דחייה
        </button>
      </div>
    </div>
  )
}
