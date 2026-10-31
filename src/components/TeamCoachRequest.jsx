import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { Coach as ShieldPlus, Hourglass } from "@/components/icons/BrandIcons"
import { getMyCoachRequest, requestCoachRole, cancelCoachRequest } from "@/lib/coachRequests"

/**
 * "Take ownership" of a team — a linked player who isn't already this team's coach
 * requests the team-scoped coach role. Admin/league-manager approve it in the Admin
 * review queue (which grants the role). Self-contained: tracks its own pending state.
 */
export default function TeamCoachRequest({ teamId, tone = "dark" }) {
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
      <div className="shrink-0 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-[12px] font-semibold ${tone === "light" ? "text-[#11161D]" : "text-white/90"}`}>
          <Hourglass className="w-4 h-4" /> בקשת ניהול ממתינה
        </span>
        <button onClick={doCancel} disabled={busy}
          className={`min-h-[44px] px-2 text-[12px] font-bold underline underline-offset-2 disabled:opacity-50 ${tone === "light" ? "text-[#11161D]" : "text-white"}`}>
          ביטול
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 text-end">
      <button onClick={doRequest} disabled={busy} title="בקשה להיות מאמן/ת הקבוצה"
        className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-control text-[13px] font-bold transition-colors disabled:opacity-50 ${tone === "light" ? "bg-[#11161D]/[0.07] text-[#11161D]" : "bg-[#080C12]/35 text-white"}`}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldPlus className="w-4 h-4" />} בקשה לניהול הקבוצה
      </button>
      {error && <p className={`text-[12px] font-semibold mt-1 ${tone === "light" ? "text-[#11161D]" : "text-white"}`}>{error}</p>}
    </div>
  )
}
