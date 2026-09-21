import { useState, useEffect } from "react"
import { getPendingClaims, approveClaim, rejectClaim } from "@/lib/claims"
import { Check, X, UserPlus, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

// Translate claims.js error codes into the Hebrew copy shown in the queue.
function claimErrorMessage(e, fallback) {
  if (e?.message === "player-already-linked") return "השחקן כבר משויך לחשבון אחר"
  if (e?.message === "not-authorized") return "אין לך הרשאה לאשר או לדחות בקשה זו"
  return fallback
}

/**
 * Review queue for "claim your player" requests (Stage B1). Approve/reject go
 * through the approve_claim / reject_claim RPCs (self-gated to admins and the
 * claimed player's coach). Self-contained: loads its own pending claims.
 * `teamsMap` is only for logos. A non-admin coach passes `coachTeamIds` so the
 * queue shows only claims for players on their own team (RLS already scopes the
 * fetch; this is a matching client-side guard).
 */
export default function ClaimsReview({ teamsMap = {}, coachTeamIds = null }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    try { setLoading(true); setError(null); setClaims(await getPendingClaims()) }
    catch { setError("שגיאה בטעינת הבקשות") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const doApprove = async (claim) => {
    setBusyId(claim.id); setError(null)
    try { await approveClaim(claim.id); await load() }
    catch (e) { setError(claimErrorMessage(e, "שגיאה באישור הבקשה")) }
    finally { setBusyId(null) }
  }
  const doReject = async (claim) => {
    setBusyId(claim.id); setError(null)
    try { await rejectClaim(claim.id); await load() }
    catch (e) { setError(claimErrorMessage(e, "שגיאה בדחיית הבקשה")) }
    finally { setBusyId(null) }
  }

  // Non-admin coach: show only claims for players on their own team(s).
  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const visibleClaims = coachScoped
    ? claims.filter(c => coachTeamIds.includes(c.players?.team_id))
    : claims

  if (loading) {
    return <SkeletonPanelRows />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <UserPlus className="w-5 h-5 text-brand" /> בקשות בעלות על פרופיל
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            אישור מקשר את החשבון לשחקן ומעניק תפקיד שחקן
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {visibleClaims.length === 0 ? (
        <div className="card p-10 text-center">
          <UserPlus className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין בקשות בעלות ממתינות</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleClaims.map(claim => {
            const player = claim.players
            const team = teamsMap[player?.team_id]
            const claimant = claim.profiles?.display_name || "משתמש"
            const busy = busyId === claim.id
            return (
              <div key={claim.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <TeamLogo team={team} size={10} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold">{claimant}</span>
                      <span className="text-slate-500 dark:text-slate-400"> מבקש/ת להיות </span>
                      <span className="font-bold">{player ? `${player.first_name} ${player.last_name}` : "שחקן לא ידוע"}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {team?.name || "—"} · {format(new Date(claim.created_at), "d/M/yyyy HH:mm")}
                    </p>
                    {claim.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{claim.note}"</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => doApprove(claim)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> אישור
                  </button>
                  <button onClick={() => doReject(claim)} disabled={busy}
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
