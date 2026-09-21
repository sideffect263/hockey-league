import { useState, useEffect } from "react"
import { getPendingTeamJoins, approveTeamJoin, rejectTeamJoin } from "@/lib/teamMembership"
import { Check, X, ArrowLeftRight, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

function joinError(e, fallback) {
  if (e?.message === "not-authorized") return "אין לך הרשאה לאשר או לדחות בקשה זו"
  return fallback
}

/**
 * Review queue for team-join requests (Package 1b). Approve/reject go through the
 * approve_team_join / reject_team_join RPCs (self-gated to admins and the team's
 * coach). RLS already scopes a coach's fetch to their own team; coachTeamIds is a
 * matching client-side guard. teamsMap is only for logos.
 */
export default function TeamJoinRequestsReview({ teamsMap = {}, coachTeamIds = null }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    try { setLoading(true); setError(null); setItems(await getPendingTeamJoins()) }
    catch { setError("שגיאה בטעינת הבקשות") } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const doApprove = async (r) => {
    setBusyId(r.id); setError(null)
    try { await approveTeamJoin(r.id); await load() }
    catch (e) { setError(joinError(e, "שגיאה באישור הבקשה")) } finally { setBusyId(null) }
  }
  const doReject = async (r) => {
    setBusyId(r.id); setError(null)
    try { await rejectTeamJoin(r.id); await load() }
    catch (e) { setError(joinError(e, "שגיאה בדחיית הבקשה")) } finally { setBusyId(null) }
  }

  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const visible = coachScoped ? items.filter(r => coachTeamIds.includes(r.team_id)) : items

  if (loading) {
    return <SkeletonPanelRows />
  }

  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <ArrowLeftRight className="w-5 h-5 text-brand" /> בקשות הצטרפות לקבוצה
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">אישור משייך את השחקן/ית לקבוצה</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {visible.length === 0 ? (
        <div className="card p-10 text-center">
          <ArrowLeftRight className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין בקשות הצטרפות ממתינות</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map(r => {
            const team = teamsMap[r.team_id] || r.teams
            const pl = r.players
            const who = pl ? `${pl.first_name} ${pl.last_name}` : (r.profiles?.display_name || "שחקן")
            const busy = busyId === r.id
            return (
              <div key={r.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <TeamLogo team={team} size={10} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold">{who}</span>
                      <span className="text-slate-500 dark:text-slate-400"> מבקש/ת להצטרף ל־</span>
                      <span className="font-bold">{team?.name || "קבוצה"}</span>
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
