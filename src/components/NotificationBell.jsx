import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Bell, BellRing } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { useAuth } from '../lib/AuthContext'
import {
  getNotifications, getUnreadCount, markAllRead,
  subscribeToNotifications, notificationText, notificationIcon, notificationHref,
} from '../lib/notifications'
import { pushSupported, pushStatus, enablePush } from '../lib/push'
import { SkeletonNotificationRows } from "@/components/skeletons/PageSkeletons"

function timeAgo(iso) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: he }) }
  catch { return '' }
}

export default function NotificationBell() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [push, setPush] = useState('default') // 'on' | 'default' | 'denied' | 'unsupported'
  const [pushBusy, setPushBusy] = useState(false)
  const wrapRef = useRef(null)

  // Reflect this browser's push state (used to show the "enable" prompt).
  useEffect(() => {
    if (!user || !pushSupported()) { setPush('unsupported'); return }
    pushStatus().then(setPush).catch(() => {})
  }, [user])

  const handleEnablePush = async () => {
    setPushBusy(true)
    try {
      const res = await enablePush()
      setPush(res.ok ? 'on' : (res.reason === 'denied' ? 'denied' : 'default'))
    } finally { setPushBusy(false) }
  }

  const refreshCount = useCallback(() => {
    getUnreadCount().then(setUnread).catch(() => {})
  }, [])

  // Initial unread count + live updates + refresh on focus.
  useEffect(() => {
    if (!user) { setUnread(0); setItems([]); return }
    refreshCount()
    const unsub = subscribeToNotifications(user.id, () => setUnread((n) => n + 1))
    const onFocus = () => refreshCount()
    window.addEventListener('focus', onFocus)
    return () => { unsub(); window.removeEventListener('focus', onFocus) }
  }, [user, refreshCount])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        const rows = await getNotifications(30)
        setItems(rows)
        if (rows.some((r) => !r.read_at)) { await markAllRead(); setUnread(0) }
      } catch { /* best-effort */ }
      finally { setLoading(false) }
    }
  }

  if (!user) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={toggle}
        className="relative p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        aria-label="התראות"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">התראות</h3>
              {push === 'on' && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <BellRing className="w-3 h-3" /> התראות דחיפה פעילות
                </span>
              )}
            </div>
            {push === 'default' && (
              <button
                onClick={handleEnablePush}
                disabled={pushBusy}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-xs font-semibold py-1.5 transition-colors"
              >
                <BellRing className="w-3.5 h-3.5" />
                {pushBusy ? 'מפעיל…' : 'הפעל התראות דחיפה במכשיר הזה'}
              </button>
            )}
            {push === 'denied' && (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                התראות חסומות בדפדפן. יש לאפשר אותן בהגדרות האתר כדי לקבל עדכונים.
              </p>
            )}
          </div>

          {loading ? (
            <div className="p-3">
              <SkeletonNotificationRows count={3} compact />
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">אין התראות עדיין</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    to={notificationHref(n)}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                      n.read_at ? '' : 'bg-brand/[0.06] dark:bg-brand/5'
                    }`}
                  >
                    {n.actor?.avatar_url ? (
                      <img src={n.actor.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-base shrink-0">
                        {notificationIcon(n)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug">{notificationText(n)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read_at && <span className="w-2 h-2 rounded-full bg-brand shrink-0 mt-1.5" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {/* Long messages (a league-manager broadcast runs to 500 chars) don't fit a
              dropdown, and they exist nowhere else — so always offer the full list. */}
          <Link to="/notifications" onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-center text-xs font-semibold text-brand hover:bg-slate-50 dark:hover:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 transition-colors">
            הצגת כל ההתראות
          </Link>
        </div>
      )}
    </div>
  )
}
