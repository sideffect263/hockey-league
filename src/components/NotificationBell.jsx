import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { getNotifications, getUnreadCount, markAllRead, subscribeToNotifications } from '../lib/notifications'
import { pushSupported, pushStatus, enablePush } from '../lib/push'
import { SkeletonNotificationRows } from "@/components/skeletons/PageSkeletons"
import { Spinner } from "@/components/fl/account/AccountKit"
import { NotifRow, FilterChips, EmptyNotifs, FILTERS, groupByAge } from "@/components/fl/account/NotifKit"
import { useLeagueTeams } from "@/components/fl/account/MyPageParts"

/** The bell drawn like the shell's other header icons (search): 23px line, 1.9 stroke. */
function BellGlyph() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.6 2H4.4zM10 20.5a2 2 0 0 0 4 0" />
    </svg>
  )
}

/**
 * Header bell (board NotifBell). Phones: opens /notifications, the full page. Desktop: a
 * dropdown with the same rows (today / this week / earlier, filter chips, answer
 * buttons). The unread badge stays live over the private Broadcast topic and refreshes
 * on focus; opening the dropdown marks everything read, as before.
 */
export default function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState("all")
  const [push, setPush] = useState('default') // 'on' | 'default' | 'denied' | 'unsupported'
  const [pushBusy, setPushBusy] = useState(false)
  const wrapRef = useRef(null)
  const teams = useLeagueTeams()
  const teamsByName = useMemo(() => Object.fromEntries(teams.map(t => [t.name, t])), [teams])

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
    const unsub = subscribeToNotifications(user.id, () => setUnread((n) => n + 1), refreshCount)
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
    // Phones get the full page (board NotifBell is a page, and a dropdown is cramped there).
    if (window.matchMedia('(max-width: 1023px)').matches) { navigate('/notifications'); return }
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

  const f = FILTERS.find(x => x.id === filter) || FILTERS[0]
  const shown = items.filter(f.test)

  return (
    <div ref={wrapRef} className="relative">
      <button onClick={toggle} aria-haspopup="dialog" aria-expanded={open}
        className="relative size-11 rounded-full flex items-center justify-center text-fg-strong hover:bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent"
        aria-label={unread > 0 ? `התראות, ${unread} חדשות` : "התראות"}>
        <BellGlyph />
        {unread > 0 && (
          <span className="absolute top-1 left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-fl-accent text-fl-inkOnLight text-[10.5px] font-extrabold flex items-center justify-center ring-2 ring-surface-page tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="התראות"
          className="absolute left-0 mt-2 w-[420px] max-w-[calc(100vw-2rem)] max-h-[min(78vh,720px)] flex flex-col rounded-[22px] bg-surface-page shadow-[0_18px_50px_rgba(0,0,0,.22)] ring-1 ring-line z-50 overflow-hidden fl-fade-in">
          <div className="px-4 pt-3.5 pb-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[20px] font-extrabold text-fg-strong">התראות</h3>
              {push === 'on' && <span className="text-[12px] font-semibold text-[#1B5E2A] dark:text-emerald-300">פוש פעיל במכשיר הזה</span>}
            </div>
            {push === 'default' && (
              <button onClick={handleEnablePush} disabled={pushBusy}
                className="mt-2.5 w-full h-11 rounded-xl bg-brand text-brand-fg text-[13.5px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">
                {pushBusy ? <Spinner /> : null}{pushBusy ? 'מפעיל…' : 'הפעלת התראות במכשיר הזה'}
              </button>
            )}
            {push === 'denied' && <p className="mt-2 text-[12px] text-fg-muted leading-snug">ההתראות חסומות בדפדפן. מאפשרים אותן בהגדרות האתר כדי לקבל עדכונים.</p>}
            <div className="mt-2.5"><FilterChips value={filter} onChange={setFilter} rows={items} /></div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="p-3"><SkeletonNotificationRows count={3} compact /></div>
            ) : shown.length === 0 ? (
              <EmptyNotifs filtered={filter !== "all"} />
            ) : groupByAge(shown).map(([title, list]) => (
              <section key={title} aria-label={title}>
                <h4 className="px-4 pt-2 pb-1.5 text-[12.5px] font-extrabold text-fg-muted">{title}</h4>
                <ul className="bg-surface divide-y divide-line">
                  {list.map(n => <li key={n.id}><NotifRow n={n} teamsByName={teamsByName} onOpen={() => setOpen(false)} /></li>)}
                </ul>
              </section>
            ))}
          </div>
          {/* Long messages (a league-manager broadcast runs to 500 chars) don't fit a
              dropdown, and they exist nowhere else — so always offer the full list. */}
          <Link to="/notifications" onClick={() => setOpen(false)}
            className="shrink-0 h-12 flex items-center justify-center text-[13.5px] font-bold text-fg-strong hover:bg-surface border-t border-line transition-colors">
            כל ההתראות
          </Link>
        </div>
      )}
    </div>
  )
}
