import { useState, useEffect } from "react"
import { Check, X, RefreshCw, Unlink } from "lucide-react"
import { Gavel } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"
import {
  getPendingOfficialRoleRequests, decideOfficialRoleRequest, officialRoleLabel,
  getPendingCardUnlinkRequests, decideCardUnlinkRequest,
} from "@/lib/roleRequests"

/**
 * Review queues for the two league-manager requests (mirrors CoachRequestsReview):
 *   - שיפוט / מזכירות: approve grants the league-wide judge role (judge board).
 *   - "זה לא הכרטיס שלי": approve unlinks the account from the card, like the old
 *     self-disconnect did.
 * Until the migrations are applied the RPCs are missing and the lists are simply empty.
 */
function useQueue(fetcher) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const load = async () => {
    try { setLoading(true); setError(null); setItems(await fetcher()) }
    catch { setError("שגיאה בטעינת הבקשות") } finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return { items, loading, error, setError, load }
}

const errText = (e, verb) =>
  e?.message === "not-authorized" ? `אין לך הרשאה ${verb} בקשה זו`
  : e?.message === "request-not-found" ? "הבקשה כבר טופלה או בוטלה"
  : e?.message === "not-available" ? "האפשרות עוד לא זמינה בשרת"
  : `שגיאה ב${verb === "לאשר" ? "אישור" : "דחיית"} הבקשה`

function Section({ icon: Icon, title, subtitle, empty, error, onRefresh, children, count }) {
  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Icon className="w-5 h-5 text-brand" /> {title}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>
      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}
      {count === 0 ? (
        <div className="card p-10 text-center">
          <Icon className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{empty}</p>
        </div>
      ) : <div className="space-y-2.5">{children}</div>}
    </div>
  )
}

function Actions({ busy, onApprove, onReject }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={onApprove} disabled={busy}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
        <Check className="w-3.5 h-3.5" /> אישור
      </button>
      <button onClick={onReject} disabled={busy}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
        <X className="w-3.5 h-3.5" /> דחייה
      </button>
    </div>
  )
}

export function OfficialRoleRequestsReview() {
  const q = useQueue(getPendingOfficialRoleRequests)
  const [busyId, setBusyId] = useState(null)
  const decide = async (r, approve) => {
    setBusyId(r.id); q.setError(null)
    try { await decideOfficialRoleRequest(r.id, approve); await q.load() }
    catch (e) { q.setError(errText(e, approve ? "לאשר" : "לדחות")) } finally { setBusyId(null) }
  }
  if (q.loading) return <SkeletonPanelRows />
  return (
    <Section icon={Gavel} title="בקשות שיפוט ומזכירות" count={q.items.length}
      subtitle="אישור מעניק הרשאת שופט: לוח השיפוט, הגשת מועמדות למשחקים והזנת תוצאות"
      empty="אין בקשות שיפוט ממתינות" error={q.error} onRefresh={q.load}>
      {q.items.map(r => (
        <div key={r.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-900 dark:text-white">
              <span className="font-bold">{r.requester || "משתמש"}</span>
              <span className="text-slate-500 dark:text-slate-400"> מבקש/ת תפקיד </span>
              <span className="font-bold">{officialRoleLabel(r)}</span>
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {r.player_name ? `כרטיס: ${r.player_name} · ` : ""}<span dir="ltr">{format(new Date(r.created_at), "d/M/yyyy HH:mm")}</span>
            </p>
            {r.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.note}"</p>}
          </div>
          <Actions busy={busyId === r.id} onApprove={() => decide(r, true)} onReject={() => decide(r, false)} />
        </div>
      ))}
    </Section>
  )
}

export function CardUnlinkRequestsReview({ teamsMap = {} }) {
  const q = useQueue(getPendingCardUnlinkRequests)
  const [busyId, setBusyId] = useState(null)
  const decide = async (r, approve) => {
    setBusyId(r.id); q.setError(null)
    try {
      const out = await decideCardUnlinkRequest(r.id, approve)
      if (out === "stale") q.setError("החשבון כבר לא משויך לכרטיס הזה — הבקשה נסגרה")
      await q.load()
    } catch (e) { q.setError(errText(e, approve ? "לאשר" : "לדחות")) } finally { setBusyId(null) }
  }
  if (q.loading) return <SkeletonPanelRows />
  return (
    <Section icon={Unlink} title="בקשות ניתוק מכרטיס" count={q.items.length}
      subtitle="״זה לא הכרטיס שלי״ — אישור מנתק את החשבון מהכרטיס. הכרטיס, הסטטיסטיקות וההיסטוריה נשארים"
      empty="אין בקשות ניתוק ממתינות" error={q.error} onRefresh={q.load}>
      {q.items.map(r => (
        <div key={r.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <TeamLogo team={teamsMap[r.team_id]} size={10} />
            <div className="min-w-0">
              <p className="text-sm text-slate-900 dark:text-white">
                <span className="font-bold">{r.requester || "משתמש"}</span>
                <span className="text-slate-500 dark:text-slate-400"> אומר/ת שזה לא הכרטיס שלו/ה: </span>
                <span className="font-bold">{r.player_name || "כרטיס"}</span>
                {r.team_name && <span className="text-slate-500 dark:text-slate-400"> · {r.team_name}</span>}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5" dir="ltr">{format(new Date(r.created_at), "d/M/yyyy HH:mm")}</p>
              {r.reason && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.reason}"</p>}
            </div>
          </div>
          <Actions busy={busyId === r.id} onApprove={() => decide(r, true)} onReject={() => decide(r, false)} />
        </div>
      ))}
    </Section>
  )
}
