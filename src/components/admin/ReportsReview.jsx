import { useState, useEffect } from "react"
import { getReports, resolveReport, removeReportedContent, TARGET_LABEL } from "@/lib/moderation"
import { Flag, Trash2, X, RefreshCw, Loader2 } from "lucide-react"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Admin review queue for user-submitted content reports (moderation).
 * Loads open/actioned/dismissed reports via getReports(). Each open report can be
 * actioned ("מחק תוכן" → soft-delete the target + mark actioned) or dismissed
 * ("התעלם" → mark dismissed). Both go through an inline confirm — no window.confirm.
 * Self-contained: owns its own data + filter state.
 */

const STATUS_FILTERS = [
  { id: "open", label: "פתוחים" },
  { id: "actioned", label: "טופלו" },
  { id: "dismissed", label: "נדחו" },
]

const EMPTY_TEXT = {
  open: "אין דיווחים פתוחים",
  actioned: "אין דיווחים שטופלו",
  dismissed: "אין דיווחים שנדחו",
}

const REPORTER_FALLBACK = "משתמש"

export default function ReportsReview() {
  const [status, setStatus] = useState("open")
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)         // load failure → retry card
  const [actionError, setActionError] = useState(null) // action failure → banner
  const [confirm, setConfirm] = useState(null)     // { id, kind: 'remove' | 'dismiss' }
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setLoading(true); setError(null); setActionError(null); setConfirm(null)
      setReports(await getReports(status))
    } catch {
      setError("שגיאה בטעינת הדיווחים")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [status])

  // Optimistically drop the row, run the action, roll back + surface an error on failure.
  const runAction = async (report, kind) => {
    setConfirm(null); setActionError(null); setBusy(true)
    const prev = reports
    setReports(rs => rs.filter(r => r.id !== report.id))
    try {
      if (kind === "remove") {
        await removeReportedContent(report.target_type, report.target_id)
        await resolveReport(report.id, "actioned")
      } else {
        await resolveReport(report.id, "dismissed")
      }
    } catch {
      setReports(prev) // rollback
      setActionError(kind === "remove" ? "מחיקת התוכן נכשלה" : "עדכון הדיווח נכשל")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Flag className="w-5 h-5 text-brand" /> דיווחים על תוכן
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            סקירת דיווחי משתמשים על פוסטים ותגובות
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map(f => (
          <button key={f.id} onClick={() => setStatus(f.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              status === f.id
                ? "bg-brand text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {loading ? (
        <SkeletonPanelRows />
      ) : error ? (
        <div className="card p-10 text-center space-y-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          <button onClick={load} className="flex items-center gap-1.5 mx-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      ) : reports.length === 0 ? (
        <div className="card p-10 text-center">
          <Flag className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{EMPTY_TEXT[status]}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {reports.map(report => (
            <ReportRow
              key={report.id}
              report={report}
              busy={busy}
              confirm={confirm?.id === report.id ? confirm.kind : null}
              onAskConfirm={kind => { setActionError(null); setConfirm({ id: report.id, kind }) }}
              onCancel={() => setConfirm(null)}
              onConfirm={kind => runAction(report, kind)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReportRow({ report, busy, confirm, onAskConfirm, onCancel, onConfirm }) {
  const { target, author, reporter } = report
  const gone = !target                          // hard-deleted
  const softDeleted = !!target?.deleted_at       // still readable to admins, but already removed
  const canRemove = !gone && !softDeleted
  const isOpen = report.status === "open"

  return (
    <div className="card p-4 space-y-3">
      {/* Reason + kind + date */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-slate-900 dark:text-white">{report.reason}</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              {TARGET_LABEL[report.target_type] || report.target_type}
            </span>
            {softDeleted && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">נמחק</span>
            )}
          </div>
          {report.details && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic break-words">"{report.details}"</p>
          )}
        </div>
        <span className="text-[11px] text-slate-400 shrink-0">
          {new Date(report.created_at).toLocaleDateString("he-IL")}
        </span>
      </div>

      {/* Reported content */}
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
        {gone ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">התוכן כבר נמחק</p>
        ) : (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-200 line-clamp-3 break-words whitespace-pre-wrap">
              {target.body?.trim() ? target.body : "(ללא טקסט)"}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              מאת {author?.display_name || REPORTER_FALLBACK}
            </p>
          </>
        )}
      </div>

      {/* Who reported */}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        דווח ע״י {reporter?.display_name || REPORTER_FALLBACK}
      </p>

      {/* Actions — open reports only */}
      {isOpen && (
        confirm ? (
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {confirm === "remove" ? "למחוק את התוכן ולסמן את הדיווח כטופל?" : "לסמן את הדיווח כנדחה?"}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => onConfirm(confirm)} disabled={busy}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors disabled:opacity-50 ${
                  confirm === "remove" ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:bg-brand-hover"
                }`}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : confirm === "remove" ? <Trash2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {confirm === "remove" ? "כן, מחק" : "כן, התעלם"}
              </button>
              <button onClick={onCancel} disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            {canRemove && (
              <button onClick={() => onAskConfirm("remove")}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                <Trash2 className="w-3.5 h-3.5" /> מחק תוכן
              </button>
            )}
            <button onClick={() => onAskConfirm("dismiss")}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <X className="w-3.5 h-3.5" /> התעלם
            </button>
          </div>
        )
      )}
    </div>
  )
}
