import { useState, useEffect } from "react"
import { getPendingMedical, reviewMedical, signMedical } from "@/lib/medical"
import { HeartPulse, Check, X, Eye, RefreshCw } from "lucide-react"
import { format } from "date-fns"

/**
 * Coach/admin review of pending medical certificates (#2) — STAGE 1 of two. "View"
 * opens a short-lived signed URL to the private file; approve/reject go through the
 * review_medical_certificate RPC (self-gated to the player's coach or an admin). RLS
 * already scopes the fetch to the coach's team; coachTeamIds is a matching client-side
 * guard. Hidden when empty.
 *
 * Approving here does NOT let the player play: it hands the certificate to a league
 * manager to verify he is registered in פודיום (MedicalPodiumReview). The button copy
 * says so, because a coach who thinks he just cleared a player would find out on a
 * Saturday morning otherwise.
 */
export default function MedicalReview({ coachTeamIds = null }) {
  const [items, setItems] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [examDates, setExamDates] = useState({}) // per-item exam date, required to approve
  const todayStr = new Date().toLocaleDateString('en-CA') // local date, not UTC

  const load = async () => {
    try { setError(null); setItems(await getPendingMedical()) }
    catch { setError("שגיאה בטעינת האישורים"); setItems([]) }
  }
  useEffect(() => { load() }, [])

  const act = async (item, status) => {
    if (status === "approved" && !examDates[item.id]) {
      setError("יש להזין את תאריך הבדיקה הרפואית לפני אישור")
      return
    }
    setBusyId(item.id); setError(null)
    try {
      await reviewMedical(item.id, status, status === "approved" ? examDates[item.id] : null)
      setItems(prev => (prev || []).filter(i => i.id !== item.id))
    } catch (e) {
      setError(e?.message === "exam-date-required" ? "יש להזין את תאריך הבדיקה" : "הפעולה נכשלה")
    } finally { setBusyId(null) }
  }
  const view = async (item) => {
    const url = await signMedical(item.file_path)
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const visible = (items || []).filter(i => !coachScoped || coachTeamIds.includes(i.players?.team_id))

  if (items === null || visible.length === 0) return null

  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <HeartPulse className="w-5 h-5 text-brand" /> אישורים רפואיים
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        לאחר אישורך הבקשה עוברת לאימות רישום בפודיום אצל מנהלת הליגה — רק לאחר מכן השחקן יוכל להירשם למשחקים.
      </p>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      <div className="space-y-2.5">
        {visible.map(item => {
          const p = item.players
          const busy = busyId === item.id
          return (
            <div key={item.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{p ? `${p.first_name} ${p.last_name}` : "שחקן"}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{p?.teams?.name || "—"} · {format(new Date(item.created_at), "d/M/yyyy HH:mm")}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400" title="תאריך ביצוע הבדיקה הרפואית — האישור בתוקף לשנה מתאריך זה">
                  תאריך בדיקה
                  <input type="date" value={examDates[item.id] || ""} max={todayStr}
                    onChange={e => setExamDates(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                </label>
                <button onClick={() => view(item)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <Eye className="w-3.5 h-3.5" /> צפייה
                </button>
                <button onClick={() => act(item, "approved")} disabled={busy}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> אישור והעברה למנהלת
                </button>
                <button onClick={() => act(item, "rejected")} disabled={busy}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                  <X className="w-3.5 h-3.5" /> דחייה
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
