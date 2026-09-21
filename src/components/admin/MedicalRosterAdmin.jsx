import { useState, useEffect, useMemo } from "react"
import { getMedicalRoster, signMedical, getPlayerMedicalCerts, revokeMedical, setMedicalExamDate } from "@/lib/medical"
import { HeartPulse, RefreshCw, Search, Eye, Ban, CalendarClock, X, Loader2 } from "lucide-react"
import { format } from "date-fns"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

// Problems-first severity ranking, so the default "חומרה" sort surfaces the
// players who need attention (missing/expired) above those already covered.
const MED_SEVERITY = { missing: 0, expired: 1, rejected: 1, pending: 2, expiring: 3, valid: 4 }
const MED_SORT_OPTIONS = [
  { key: "severity", label: "חומרה", dir: "asc" },
  { key: "name", label: "שם", dir: "asc" },
  { key: "team", label: "קבוצה", dir: "asc" },
  { key: "expiry", label: "תפוגה", dir: "asc" },
]
const MED_ACCESSORS = {
  severity: r => MED_SEVERITY[r.st.key] ?? 9,
  name: r => `${r.first_name} ${r.last_name}`.trim(),
  team: r => r.team_name || "",
  expiry: r => (r.valid_until ? new Date(r.valid_until).getTime() : null),
}

/**
 * B4 — league-manager / admin medical roster. One row per player: who holds a valid
 * medical, who's missing/expired, who's about to expire (≤30 days). Backed by the
 * medical_roster RPC (summary only — no files). Ordered problems-first by the RPC.
 */
const DAY = 86400000
const EXPIRY_WARN_DAYS = 30

function statusOf(row) {
  if (row.has_valid) {
    if (row.valid_until) {
      const d = new Date(row.valid_until)
      const days = Math.ceil((d - new Date()) / DAY)
      if (days <= EXPIRY_WARN_DAYS) return { key: "expiring", label: `פג ${format(d, "d/M/yy")}`, cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }
      return { key: "valid", label: `בתוקף עד ${format(d, "d/M/yy")}`, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }
    }
    return { key: "valid", label: "בתוקף", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }
  }
  if (row.latest_status === "pending") return { key: "pending", label: "ממתין לאישור", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" }
  if (row.latest_status === "approved") return { key: "expired", label: "פג תוקף", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
  if (row.latest_status === "rejected") return { key: "rejected", label: "נדחה", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
  return { key: "missing", label: "חסר", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" }
}

export default function MedicalRosterAdmin() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("issues") // all | issues | expiring
  const [q, setQ] = useState("")
  const [sort, setSort] = useState({ key: "severity", dir: "asc" })
  // Acting on a specific certificate needs its id, which the roster RPC deliberately
  // doesn't return (it's a status-only summary) — so the file is fetched on demand.
  const [modal, setModal] = useState(null)   // { row, mode:'date'|'revoke', cert }
  const [reason, setReason] = useState("")
  const [examDate, setExamDate] = useState("")
  const [busy, setBusy] = useState(false)

  const openFor = async (row, mode) => {
    setError(null); setReason(""); setBusy(true)
    try {
      const certs = await getPlayerMedicalCerts(row.player_id)
      const cert = certs.find(c => c.status === "approved") || certs[0]
      if (!cert) { setError("לא נמצא אישור לטיפול"); return }
      setExamDate(cert.exam_date || "")
      setModal({ row, mode, cert })
    } catch { setError("שגיאה בטעינת האישור") } finally { setBusy(false) }
  }
  const openManage = (row) => openFor(row, "date")
  const openRevoke = (row) => openFor(row, "revoke")

  const confirmAction = async () => {
    if (!modal) return
    setBusy(true); setError(null)
    try {
      if (modal.mode === "revoke") await revokeMedical(modal.cert.id, reason)
      else await setMedicalExamDate(modal.cert.id, examDate)
      setModal(null)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const load = async () => {
    try { setError(null); setRows(await getMedicalRoster()) }
    catch { setError("שגיאה בטעינת המעקב הרפואי"); setRows([]) }
  }
  useEffect(() => { load() }, [])

  // Open the player's medical document via a short-lived signed URL (RLS lets
  // admins + league managers read the private file).
  const view = async (path) => {
    if (!path) return
    const url = await signMedical(path)
    if (url) window.open(url, "_blank", "noopener,noreferrer")
    else setError("לא ניתן לפתוח את המסמך")
  }

  const decorated = useMemo(() => (rows || []).map(r => ({ ...r, st: statusOf(r) })), [rows])
  const counts = useMemo(() => ({
    valid: decorated.filter(r => r.st.key === "valid").length,
    expiring: decorated.filter(r => r.st.key === "expiring").length,
    issues: decorated.filter(r => !["valid", "expiring"].includes(r.st.key)).length,
    total: decorated.length,
  }), [decorated])

  const shown = sortItems(decorated.filter(r => {
    if (filter === "issues" && ["valid", "expiring"].includes(r.st.key)) return false
    if (filter === "expiring" && r.st.key !== "expiring") return false
    if (q.trim()) {
      const hay = `${r.first_name} ${r.last_name} ${r.team_name || ""}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  }), sort, MED_ACCESSORS)

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter === id ? "bg-orange-500 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
      {label}{n != null ? ` (${n})` : ""}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <HeartPulse className="w-5 h-5 text-orange-500" /> מעקב רפואי
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">{counts.valid}</p><p className="text-[11px] text-slate-400 mt-0.5">בתוקף</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">{counts.expiring}</p><p className="text-[11px] text-slate-400 mt-0.5">פג בקרוב</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-red-600 dark:text-red-400 tabular-nums">{counts.issues}</p><p className="text-[11px] text-slate-400 mt-0.5">חסר / פג</p></div>
      </div>

      {/* Filters + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterBtn id="issues" label="בעיות" n={counts.issues} />
        <FilterBtn id="expiring" label="פג בקרוב" n={counts.expiring} />
        <FilterBtn id="all" label="הכל" n={counts.total} />
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שחקן או קבוצה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/30" />
        </div>
      </div>

      <SortBar options={MED_SORT_OPTIONS} sort={sort} onChange={setSort} />

      {rows === null ? (
        <SkeletonPanelRows />
      ) : shown.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">אין שחקנים תואמים</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="text-right font-bold px-4 py-2.5">שחקן</th>
                  <th className="text-right font-bold px-3 py-2.5">קבוצה</th>
                  <th className="text-right font-bold px-3 py-2.5">סטטוס רפואי</th>
                  <th className="text-right font-bold px-3 py-2.5">תאריך בדיקה</th>
                  <th className="text-right font-bold px-3 py-2.5">מסמך</th>
                  <th className="text-right font-bold px-3 py-2.5">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {shown.map(r => (
                  <tr key={r.player_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{r.first_name} {r.last_name}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.team_name || "—"}</td>
                    <td className="px-3 py-2.5"><span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded ${r.st.cls}`}>{r.st.label}</span></td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
                      {r.exam_date ? format(new Date(r.exam_date), "d/M/yy") : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {/* Only an APPROVED certificate's file is viewable (pending/rejected stay private). */}
                      {r.approved_file_path ? (
                        <button onClick={() => view(r.approved_file_path)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                          <Eye className="w-3.5 h-3.5" /> צפייה
                        </button>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    {/* The manager reviews these himself: correct a wrong exam date, or
                        revoke a file he judges inadequate. Only meaningful while the
                        player actually holds a valid certificate. */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.has_valid ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openManage(r)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                            <CalendarClock className="w-3.5 h-3.5" /> תאריך
                          </button>
                          <button onClick={() => openRevoke(r)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                            <Ban className="w-3.5 h-3.5" /> ביטול
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Correct a wrong exam date, or revoke a file the manager judges inadequate.
          Revoking takes the player's ability to register away, so it demands a reason
          and says so plainly — the player and his coach both receive it. */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" dir="rtl"
          onClick={() => !busy && setModal(null)}>
          <div className="w-full max-w-sm card p-4 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {modal.mode === "revoke" ? "ביטול אישור רפואי" : "שינוי תאריך בדיקה"}
                {" · "}{modal.row.first_name} {modal.row.last_name}
              </h3>
              <button onClick={() => setModal(null)} disabled={busy} aria-label="סגירה"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
            </div>

            {modal.mode === "revoke" ? (
              <>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  לאחר הביטול השחקן לא יוכל להירשם למשחקים עד להעלאת אישור חדש. הסיבה
                  תישלח אליו ולמאמן.
                </p>
                <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} autoFocus
                  placeholder="סיבה (למשל: הצילום לא קריא, התאריך לא ברור)" aria-label="סיבת הביטול"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              </>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  תוקף האישור מחושב אוטומטית — שנה לתאריך הבדיקה בפועל.
                </p>
                <input type="date" value={examDate} max={new Date().toLocaleDateString("en-CA")}
                  onChange={e => setExamDate(e.target.value)} aria-label="תאריך בדיקה"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              </>
            )}

            <div className="flex items-center gap-2">
              <button onClick={confirmAction}
                disabled={busy || (modal.mode === "revoke" ? !reason.trim() : !examDate)}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  modal.mode === "revoke" ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:bg-brand-hover"}`}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : modal.mode === "revoke" ? <Ban className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                {modal.mode === "revoke" ? "ביטול האישור" : "שמירת התאריך"}
              </button>
              <button onClick={() => setModal(null)} disabled={busy}
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
