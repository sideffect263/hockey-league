import { useState, useEffect } from "react"
import { ShieldPlus, Loader2 } from "lucide-react"
import { Hourglass } from "@/components/icons/BrandIcons"
import { getMyCoachRequest, requestCoachRole, cancelCoachRequest } from "@/lib/coachRequests"

/**
 * "Take ownership" of a team — a linked player who isn't already this team's coach
 * requests the team-scoped coach role. Admin/league-manager approve it in the Admin
 * review queue (which grants the role). Self-contained: tracks its own pending state.
 */
export default function TeamCoachRequest({ teamId }) {
  const [pending, setPending] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setPending(await getMyCoachRequest(teamId))
    setLoaded(true)
  }
  useEffect(() => { load() }, [teamId])

  const doRequest = async () => {
    setBusy(true); setError(null)
    try { await requestCoachRole(teamId); await load() }
    catch (e) {
      setError(
        e?.message === "already-coach" ? "את/ה כבר מאמן/ת הקבוצה"
          : e?.message === "coach-request-already-pending" ? "כבר יש בקשה ממתינה"
            : e?.message === "not-a-linked-player" ? "רק שחקן/ית מקושר/ת יכול/ה לבקש"
              : "שגיאה בשליחת הבקשה"
      )
    } finally { setBusy(false) }
  }
  const doCancel = async () => {
    if (!pending) return
    setBusy(true)
    try { await cancelCoachRequest(pending.id); await load() } catch { /* ignore */ } finally { setBusy(false) }
  }

  if (!loaded) return null

  if (pending) {
    return (
      <div className="ms-auto self-start shrink-0 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          <Hourglass className="w-4 h-4" /> בקשת ניהול ממתינה
        </span>
        <button onClick={doCancel} disabled={busy}
          className="text-[11px] font-semibold text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50">
          ביטול
        </button>
      </div>
    )
  }

  return (
    <div className="ms-auto self-start shrink-0 text-end">
      <button onClick={doRequest} disabled={busy} title="בקשה להיות מאמן/ת הקבוצה"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold/[0.15] text-gold ring-1 ring-gold/30 text-xs font-semibold hover:bg-gold/25 transition-colors disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldPlus className="w-3.5 h-3.5" />} בקשה לניהול הקבוצה
      </button>
      {error && <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}
