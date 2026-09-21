import { useState, useEffect } from "react"
import { getPendingPlayerSubmissions, approvePlayerSubmission, rejectPlayerSubmission } from "@/lib/playerSubmissions"
import { Check, X, UserCheck, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

function submissionError(e, fallback) {
  if (e?.message === "not-authorized") return "אין לך הרשאה לאשר או לדחות בקשה זו"
  return fallback
}

/**
 * Review queue for user-created player cards (#7). Approve/reject go through the
 * approve_player_submission / reject_player_submission RPCs (self-gated to admins
 * and the team's coach). RLS already scopes a coach's fetch to their own team;
 * coachTeamIds is a matching client-side guard. teamsMap is only for logos.
 */
export default function PlayerSubmissionsReview({ teamsMap = {}, coachTeamIds = null }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)   // which row is asking for a reason
  const [rejectText, setRejectText] = useState({})

  const load = async () => {
    try { setLoading(true); setError(null); setItems(await getPendingPlayerSubmissions()) }
    catch { setError("שגיאה בטעינת הבקשות") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const doApprove = async (s) => {
    setBusyId(s.id); setError(null)
    try { await approvePlayerSubmission(s.id); await load() }
    catch (e) { setError(submissionError(e, "שגיאה באישור הבקשה")) }
    finally { setBusyId(null) }
  }
  // A reason is mandatory (server-enforced). The submitter and the team's coach both
  // receive it, so the rejection tells them what to fix instead of just saying no.
  //
  // Collected in an inline panel rather than window.prompt(): a native dialog blocks the
  // whole renderer, cannot be styled, and lands in the middle of an otherwise Hebrew,
  // RTL, themed admin page looking like a browser error.
  const submitReject = async (s) => {
    const reason = (rejectText[s.id] || "").trim()
    if (!reason) { setError("יש להזין סיבה לדחייה"); return }
    setBusyId(s.id); setError(null)
    try {
      await rejectPlayerSubmission(s.id, reason)
      setRejectingId(null)
      setRejectText(t => ({ ...t, [s.id]: "" }))
      await load()
    } catch (e) {
      setError(e?.message === "reason-required"
        ? "יש להזין סיבה לדחייה"
        : submissionError(e, "שגיאה בדחיית הבקשה"))
    }
    finally { setBusyId(null) }
  }

  // Non-admin coach: show only submissions for their own team(s).
  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const visible = coachScoped ? items.filter(s => coachTeamIds.includes(s.team_id)) : items

  if (loading) {
    return <SkeletonPanelRows />
  }

  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <UserCheck className="w-5 h-5 text-brand" /> כרטיסי שחקן חדשים
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            אישור יוצר את כרטיס השחקן ומשייך אותו לחשבון המבקש/ת
          </p>
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
          <UserCheck className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין כרטיסים חדשים ממתינים</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map(s => {
            const team = teamsMap[s.team_id] || s.teams
            const submitter = s.profiles?.display_name || "משתמש"
            const meta = [
              s.jersey_number != null ? `#${s.jersey_number}` : null,
              s.position || null,
              s.age != null ? `גיל ${s.age}` : null,
            ].filter(Boolean).join(" · ")
            const busy = busyId === s.id
            return (
              <div key={s.id} className="card p-4 flex flex-col gap-3">
               <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <TeamLogo team={team} size={10} />
                  <div className="min-w-0">
                    <p className="text-sm text-slate-900 dark:text-white">
                      <span className="font-bold">{submitter}</span>
                      <span className="text-slate-500 dark:text-slate-400"> מבקש/ת כרטיס עבור </span>
                      <span className="font-bold">{s.first_name} {s.last_name}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {team?.name || "—"}{meta ? ` · ${meta}` : ""} · {format(new Date(s.created_at), "d/M/yyyy HH:mm")}
                    </p>
                    {s.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{s.note}"</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => doApprove(s)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> אישור
                  </button>
                  <button onClick={() => setRejectingId(rejectingId === s.id ? null : s.id)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> דחייה
                  </button>
                </div>
               </div>

                {/* Row 30 — the reason is required and is sent to the submitter and the
                    coach, so the refusal says what to fix rather than just "נדחה". */}
                {rejectingId === s.id && (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      סיבת הדחייה — תישלח למגיש/ה ולמאמן
                    </label>
                    <textarea
                      value={rejectText[s.id] || ""}
                      onChange={e => setRejectText(t => ({ ...t, [s.id]: e.target.value }))}
                      rows={2} maxLength={300} autoFocus
                      placeholder="למשל: חסרה תמונה, או שם לא תואם לתעודת הזהות"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
                    <div className="flex items-center gap-2">
                      <button onClick={() => submitReject(s)} disabled={busy || !(rejectText[s.id] || "").trim()}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <X className="w-3.5 h-3.5" /> שליחת דחייה
                      </button>
                      <button onClick={() => setRejectingId(null)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                        ביטול
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
