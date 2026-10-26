import { useState, useRef, useEffect } from "react"
import { MoreHorizontal, Trash2, Loader2, Check, X } from "lucide-react"
import { EditIcon as Pencil, Report as Flag, Declined as Ban, Tag } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { reportContent, blockUser, REPORT_REASONS, DETAILS_MAX } from "@/lib/moderation"

/**
 * Inline "•••" moderation menu for a post or comment — parity with the mobile apps.
 * Self-contained for report + block; delegates edit/delete to the host via
 * onEdit / onDelete (the host owns the row's optimistic state + rollback).
 *
 * Visibility (RTL, dir="rtl"):
 *   - signed out                    → renders nothing
 *   - author OR admin               → עריכה + מחיקה
 *   - signed-in, not the author     → דיווח + חסימת משתמש
 *
 *   - manageItems                   → appended for the author / admins / content editors only
 *                                     (e.g. "שייך למשחק") — [{ key, label, icon, onClick }]
 *   - extraItems                    → appended for anyone signed in (e.g. "הסר תיוג",
 *                                     MentionText.jsx untagItems) — [{ key, label, onClick }]
 *
 * Props: { targetType, targetId, authorId, onEdit, onDelete, manageItems, extraItems }
 */
export default function ModerationMenu({ targetType, targetId, authorId, onEdit, onDelete, manageItems = [], extraItems = [] }) {
  const { user, isAdmin, isContentEditor } = useAuth()
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(null) // null | 'delete' | 'block'
  const [showReport, setShowReport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)

  const close = () => { setOpen(false); setConfirm(null); setBusy(false); setBlocked(false) }

  // Close the dropdown on outside-click and Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) close() }
    const onKey = (e) => { if (e.key === "Escape") close() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (!user) return null
  const isAuthor = !!authorId && user.id === authorId
  const canManage = isAuthor || isAdmin || isContentEditor // edit + delete (moderators never also get report/block)

  const handleEdit = () => { close(); onEdit?.() }
  // Delete: host owns the optimistic remove + rollback; close first so we never
  // setState on this (about-to-unmount) menu after the await.
  const handleDelete = () => { setOpen(false); setConfirm(null); onDelete?.() }
  const handleBlock = async () => {
    setBusy(true)
    try {
      await blockUser(authorId)
      setBusy(false); setBlocked(true)
      setTimeout(close, 1200)
    } catch {
      setBusy(false) // leave the confirm open so the user can retry
    }
  }

  const item = "w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors"

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="אפשרויות"
        aria-haspopup="menu"
        aria-expanded={open}
        className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        // Anchored at the button (which sits at the row's visual-left end in RTL);
        // left-0 makes the panel open rightward, into the card, so it never clips.
        <div
          role="menu"
          className="absolute top-full left-0 mt-1 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg"
        >
          {confirm === 'delete' ? (
            <div className="px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">למחוק?</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleDelete}
                  className="flex-1 flex items-center justify-center gap-1 text-xs font-bold px-2 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> כן
                </button>
                <button type="button" onClick={() => setConfirm(null)}
                  className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  ביטול
                </button>
              </div>
            </div>
          ) : confirm === 'block' ? (
            <div className="px-3 py-2.5">
              {blocked ? (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5" /> המשתמש נחסם
                </p>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">לחסום את המשתמש?</p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={handleBlock} disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1 text-xs font-bold px-2 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-4 h-4" />} כן, חסום
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} disabled={busy}
                      className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      ביטול
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : canManage ? (
            <>
              <button type="button" role="menuitem" onClick={handleEdit}
                className={`${item} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700`}>
                <Pencil className="w-4 h-4" /> עריכה
              </button>
              <button type="button" role="menuitem" onClick={() => setConfirm('delete')}
                className={`${item} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}>
                <Trash2 className="w-3.5 h-3.5" /> מחיקה
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => { setOpen(false); setShowReport(true) }}
                className={`${item} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700`}>
                <Flag className="w-4 h-4" /> דיווח
              </button>
              <button type="button" role="menuitem" onClick={() => setConfirm('block')}
                className={`${item} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}>
                <Ban className="w-4 h-4" /> חסימת משתמש
              </button>
            </>
          )}
          {!confirm && canManage && manageItems.map(it => {
            const Icon = it.icon || Tag
            return (
              <button key={it.key} type="button" role="menuitem" onClick={() => { close(); it.onClick() }}
                className={`${item} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border-t border-slate-100 dark:border-slate-700`}>
                <Icon className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{it.label}</span>
              </button>
            )
          })}
          {!confirm && extraItems.map(it => (
            <button key={it.key} type="button" role="menuitem" onClick={() => { close(); it.onClick() }}
              className={`${item} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 border-t border-slate-100 dark:border-slate-700`}>
              <Tag className="w-4 h-4 shrink-0" /> <span className="truncate">{it.label}</span>
            </button>
          ))}
        </div>
      )}

      {showReport && (
        <ReportModal targetType={targetType} targetId={targetId} onClose={() => setShowReport(false)} />
      )}
    </div>
  )
}

/* ---- Report modal: pick a reason (+ optional details) → reportContent ---- */
function ReportModal({ targetType, targetId, onClose }) {
  const [reason, setReason] = useState(REPORT_REASONS[0])
  const [details, setDetails] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(false)
    try {
      await reportContent({ targetType, targetId, reason, details: details.trim() || null })
      setDone(true)
      setTimeout(onClose, 1600)
    } catch {
      setError(true); setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onMouseDown={onClose}>
      <div className="card w-full max-w-sm p-5" onMouseDown={e => e.stopPropagation()}>
        {done ? (
          <div className="flex flex-col items-center text-center gap-2 py-4">
            <div className="w-11 h-11 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">תודה, הדיווח התקבל</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                <Flag className="w-4 h-4 text-red-500" /> דיווח על תוכן
              </h3>
              <button type="button" onClick={onClose} aria-label="סגור"
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">סיבת הדיווח</p>
            <div className="space-y-1 mb-3">
              {REPORT_REASONS.map(r => (
                <label key={r}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 has-[:checked]:border-brand has-[:checked]:bg-brand/[0.06] dark:has-[:checked]:bg-brand/10">
                  <input type="radio" name="report-reason" value={r} checked={reason === r}
                    onChange={() => setReason(r)} className="accent-brand" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{r}</span>
                </label>
              ))}
            </div>

            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">פרטים נוספים (רשות)</label>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value.slice(0, DETAILS_MAX))}
              rows={3}
              maxLength={DETAILS_MAX}
              placeholder="מה קרה?"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
            />
            <div className="mt-1 text-[10px] text-slate-400 text-left tabular-nums">{details.length}/{DETAILS_MAX}</div>

            {error && <p className="mt-1 text-xs text-red-500">שליחת הדיווח נכשלה, נסו שוב</p>}

            <div className="flex items-center gap-2 mt-3">
              <button type="submit" disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-4 h-4" />} שליחת דיווח
              </button>
              <button type="button" onClick={onClose} disabled={busy}
                className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                ביטול
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
