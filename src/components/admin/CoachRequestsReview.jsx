import { useState, useEffect } from "react"
import { getPendingCoachRequests, reviewCoachRequest } from "@/lib/coachRequests"
import { Check, X, ShieldPlus, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Review queue for "request to coach a team". Approve/reject go through the
 * review_coach_request RPC (self-gated to admins + league-managers); approve grants
 * the requester the team-scoped coach role. teamsMap is only for logos.
 */
export default function CoachRequestsReview({ teamsMap = {} }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    try { setLoading(true); setError(null); setItems(await getPendingCoachRequests()) }
    catch { setError("שגיאה בטעינת הבקשות") } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const doApprove = async (r) => {
    setBusyId(r.id); setError(null)
    try { await reviewCoachRequest(r.id, true); await load() }
    catch (e) { setError(e?.message === "not-authorized" ? "אין לך הרשאה לאשר בקשה זו" : "שגיאה באישור הבקשה") } finally { setBusyId(null) }
  }
  const doReject = async (r) => {
    setBusyId(r.id); setError(null)
    try { await reviewCoachRequest(r.id, false); await load() }
    catch (e) { setError(e?.message === "not-authorized" ? "אין לך הרשאה לדחות בקשה זו" : "שגיאה בדחיית הבקשה") } finally { setBusyId(null) }
  }

  if (loading) {
    return <SkeletonPanelRows />
  }

  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <ShieldPlus className="w-5 h-5 text-brand" /> בקשות ניהול קבוצה
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">אישור מעניק לשחקן/ית תפקיד מאמן/ת של הקבוצה</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="card p-10 text-center">
          <ShieldPlus className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין בקשות ניהול ממתינות</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map(r => {
            const team = teamsMap[r.team_id]
            const busy = busyId === r.id
            return (
              <div key={r.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <TeamLogo team={team} size={10} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold">{r.requester || "שחקן"}</span>
                      <span className="text-slate-500 dark:text-slate-400"> מבקש/ת לנהל את </span>
                      <span className="font-bold">{r.team_name || team?.name || "קבוצה"}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{format(new Date(r.created_at), "d/M/yyyy HH:mm")}</p>
                    {r.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.note}"</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => doApprove(r)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> אישור
                  </button>
                  <button onClick={() => doReject(r)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> דחייה
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
