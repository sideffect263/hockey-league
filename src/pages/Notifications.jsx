import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@/lib/AuthContext"
import {
  getNotifications, markAllRead, markRead,
  notificationText, notificationIcon, notificationHref,
} from "@/lib/notifications"
import { useSeo } from "@/lib/seo"
import { Bell, CheckCheck, ArrowRight, RefreshCw } from "lucide-react"
import { SkeletonNotificationRows } from "@/components/skeletons/PageSkeletons"

/**
 * Full notifications list.
 *
 * The bell dropdown is a glance — narrow, and on a phone it is cramped. Some
 * notifications carry real content that exists NOWHERE else: a league-manager broadcast
 * is up to 500 characters and is not stored on the game page, so a message that can't be
 * read in the dropdown is simply lost. Here each one gets the full width of the screen
 * and wraps rather than being squeezed.
 */
export default function Notifications() {
  const { user, loading: authLoading } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useSeo({ title: "התראות", path: "/notifications", noindex: true })

  const load = async () => {
    try { setError(null); setRows(await getNotifications(100)) }
    catch { setError("שגיאה בטעינת ההתראות"); setRows([]) }
  }
  useEffect(() => { if (user) load() }, [user])

  const readAll = async () => {
    try { await markAllRead(); await load() } catch { /* best-effort */ }
  }

  if (authLoading) return null
  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          יש להתחבר כדי לראות התראות
        </div>
      </div>
    )
  }

  const unread = (rows || []).filter(n => !n.read_at).length

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> חזרה למגרש
      </Link>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="page-title flex items-center gap-2">
          <Bell className="w-5 h-5 text-brand" /> התראות
          {unread > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-fg tabular-nums">{unread}</span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={readAll}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              <CheckCheck className="w-3.5 h-3.5" /> סמן הכל כנקרא
            </button>
          )}
          <button onClick={load}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> רענון
          </button>
        </div>
      </div>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {rows === null ? (
        <SkeletonNotificationRows />
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500 dark:text-slate-400">אין התראות</div>
      ) : (
        <ul className="space-y-2">
          {rows.map(n => (
            <li key={n.id}>
              <Link to={notificationHref(n)} onClick={() => !n.read_at && markRead(n.id).catch(() => {})}
                className={`card p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                  n.read_at ? "" : "border-brand/30 bg-brand/[0.04] dark:bg-brand/5"}`}>
                {n.actor?.avatar_url ? (
                  <img src={n.actor.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-base shrink-0">
                    {notificationIcon(n)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {/* break-words, not truncate — the whole point of this page is that a
                      long message is readable in full. */}
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed break-words whitespace-pre-line">
                    {notificationText(n)}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(n.created_at).toLocaleString("he-IL", {
                      day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand shrink-0 mt-1.5" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
