import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X, ArrowRight, Send, Plus, Search } from "lucide-react"
import { Comment as MessageCircle } from "@/components/icons/BrandIcons"
import { formatDistanceToNow, format } from 'date-fns'
import { he } from 'date-fns/locale'
import { useAuth } from '../lib/AuthContext'
import { BRAND_ORANGE } from '../lib/brand'
import {
  listConversations, getThread, sendMessage, markThreadRead,
  getTotalUnread, getMessageableMembers, subscribeToMessages,
} from '../lib/chat'
import { sizedImage } from "@/lib/imageSize"

function Avatar({ p, size = 'w-9 h-9' }) {
  const initial = (p?.display_name || '').trim().charAt(0).toUpperCase()
  if (p?.avatar_url) return <img src={sizedImage(p.avatar_url, 48)} alt="" className={`${size} rounded-full object-cover shrink-0`} />
  return (
    <div className={`${size} rounded-full shrink-0 flex items-center justify-center text-white text-sm font-bold`} style={{ backgroundColor: BRAND_ORANGE }}>
      {initial || '?'}
    </div>
  )
}

const relTime = (iso) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: he }) } catch { return '' } }
const clockTime = (iso) => { try { return format(new Date(iso), 'HH:mm') } catch { return '' } }

// Motion for the drawer. Everything here animates `transform`/`opacity` only — those are
// the two the compositor can handle off the main thread, so a message arriving never
// competes with the list that is scrolling. Durations stay at or under 200ms: this is
// interaction feedback, not decoration, and a chat that feels slow to open is worse than
// one that doesn't animate at all.
const EASE_OUT = 'easeOut'
const DRAWER_MS = 0.2
const ITEM_MS = 0.16

// The drawer is `fixed left-0`, so it slides in from the left edge in both directions —
// x is a transform, unlike animating `left`, which would relayout on every frame.
const drawerMotion = (reduced) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, x: '-100%' },
  animate: reduced ? { opacity: 1 } : { opacity: 1, x: 0 },
  exit: reduced ? { opacity: 0 } : { opacity: 0, x: '-100%' },
  transition: { duration: DRAWER_MS, ease: EASE_OUT },
})

// Views swap in place; a small horizontal offset reads as "deeper"/"back" without moving
// far enough to look like a page transition.
const viewMotion = (reduced) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, x: 12 },
  animate: reduced ? { opacity: 1 } : { opacity: 1, x: 0 },
  exit: reduced ? { opacity: 0 } : { opacity: 0, x: -12 },
  transition: { duration: ITEM_MS, ease: EASE_OUT },
})

export default function ChatDrawer() {
  const { user, isAdmin, roles, profile } = useAuth()
  // Members only: linked to a player, OR holding a role, OR admin.
  const canChat = !!user && (isAdmin || (roles?.length > 0) || !!profile?.player_id)

  // Users who ask their OS for less motion get state changes without the movement.
  const reduced = useReducedMotion()

  const [open, setOpen] = useState(false)
  const [view, setView] = useState('inbox')   // inbox | thread | new
  const [convs, setConvs] = useState([])
  const [members, setMembers] = useState([])
  const [memberQuery, setMemberQuery] = useState('')
  const [active, setActive] = useState(null)   // counterpart profile
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const activeRef = useRef(null); activeRef.current = active?.id || null
  const openRef = useRef(open);   openRef.current = open

  const loadConvs = useCallback(async () => {
    setLoading(true)
    try { setConvs(await listConversations()) } catch { /* best-effort */ } finally { setLoading(false) }
  }, [])

  // Unread badge + live incoming messages.
  useEffect(() => {
    if (!canChat) { setUnread(0); return }
    getTotalUnread().then(setUnread).catch(() => {})
    const unsub = subscribeToMessages(user.id, (msg) => {
      if (openRef.current && activeRef.current === msg.sender_id) {
        setMessages((prev) => [...prev, msg])
        markThreadRead(msg.sender_id).catch(() => {})
      } else {
        setUnread((n) => n + 1)
      }
      if (openRef.current) loadConvs()
    }, () => {
      // Socket dropped and came back: messages sent meanwhile were never delivered — refetch.
      getTotalUnread().then(setUnread).catch(() => {})
      if (!openRef.current) return
      loadConvs()
      const other = activeRef.current
      if (other) getThread(other).then((m) => { if (activeRef.current === other) setMessages(m) }).catch(() => {})
    })
    const onFocus = () => getTotalUnread().then(setUnread).catch(() => {})
    window.addEventListener('focus', onFocus)
    return () => { unsub(); window.removeEventListener('focus', onFocus) }
  }, [canChat, user, loadConvs])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const openDrawer = () => { setOpen(true); setView('inbox'); loadConvs() }
  const close = () => setOpen(false)

  const openThread = async (p) => {
    setActive(p); setView('thread'); setMessages([]); setLoading(true)
    try {
      setMessages(await getThread(p.id))
      const wasUnread = convs.find((c) => c.other_id === p.id)?.unread || 0
      if (wasUnread) { await markThreadRead(p.id); setUnread((n) => Math.max(0, n - wasUnread)) }
    } catch { /* best-effort */ } finally { setLoading(false) }
  }

  const openNew = async () => {
    setView('new'); setMemberQuery(''); setLoading(true)
    try { setMembers(await getMessageableMembers()) } catch { /* best-effort */ } finally { setLoading(false) }
  }

  const send = async () => {
    const body = draft.trim()
    if (!body || !active || sending) return
    setSending(true)
    try {
      const msg = await sendMessage(active.id, body)
      setMessages((prev) => [...prev, msg])
      setDraft('')
    } catch (e) {
      const rl = String(e?.message || '').includes('dm_rate_limit')
      alert(rl ? 'שליחת הודעות מהירה מדי, נסה שוב בעוד רגע' : 'שליחת ההודעה נכשלה')
    } finally { setSending(false) }
  }

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  if (!canChat) return null

  const filteredMembers = members.filter((m) => (m.display_name || '').toLowerCase().includes(memberQuery.toLowerCase()))

  return (
    <>
      {/* Launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            onClick={openDrawer}
            // Fixed element: keep it clear of the home indicator on iOS.
            style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
            className="fixed left-6 z-40 size-14 rounded-full bg-brand hover:bg-brand-hover text-white shadow-lg shadow-brand/30 flex items-center justify-center transition-colors"
            aria-label="הודעות"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            transition={{ duration: ITEM_MS, ease: EASE_OUT }}
            whileTap={reduced ? undefined : { scale: 0.94 }}
          >
            <MessageCircle className="size-6" />
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  // `key` on the count so an incoming message re-pops the badge — the one
                  // moment the number changing is worth noticing.
                  key={unread}
                  className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold tabular-nums flex items-center justify-center border-2 border-white dark:border-slate-900"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: ITEM_MS, ease: EASE_OUT }}
                >
                  {unread > 9 ? '9+' : unread}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Drawer */}
      <AnimatePresence>
        {open && (
        <motion.div
          dir="rtl"
          className="fixed left-0 top-16 bottom-0 z-40 w-full sm:w-[380px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col"
          {...drawerMotion(reduced)}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 h-14 border-b border-slate-100 dark:border-slate-800 shrink-0">
            {view !== 'inbox' && (
              <button onClick={() => setView('inbox')} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" aria-label="חזרה">
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
            {view === 'thread' && active ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Avatar p={active} size="w-8 h-8" />
                <span className="font-bold text-slate-900 dark:text-white truncate">{active.display_name || 'משתמש'}</span>
              </div>
            ) : (
              <h3 className="font-bold text-slate-900 dark:text-white flex-1">{view === 'new' ? 'הודעה חדשה' : 'הודעות'}</h3>
            )}
            {view === 'inbox' && (
              <button onClick={openNew} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-brand dark:text-brand-light" aria-label="שיחה חדשה" title="שיחה חדשה">
                <Plus className="w-5 h-5" />
              </button>
            )}
            <button onClick={close} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" aria-label="סגור">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body — one key per view so AnimatePresence can cross-fade the swap. */}
          <AnimatePresence mode="wait" initial={false}>
          {loading ? (
            <motion.div key="loading" className="flex-1 p-3 space-y-3" {...viewMotion(reduced)}>
              {/* Structural skeleton: the list's own shape, so the switch to real rows
                  doesn't jump the layout the way a centred spinner does. */}
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="size-9 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800/60" />
                  </div>
                </div>
              ))}
            </motion.div>
          ) : view === 'inbox' ? (
            convs.length === 0 ? (
              <motion.div key="inbox-empty" className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center" {...viewMotion(reduced)}>
                <MessageCircle className="w-10 h-10 text-slate-300 dark:text-slate-700" />
                <p className="text-sm text-slate-500 dark:text-slate-400">אין שיחות עדיין</p>
                <button onClick={openNew} className="btn-primary btn-sm">התחל שיחה חדשה</button>
              </motion.div>
            ) : (
              <motion.ul key="inbox" className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800" {...viewMotion(reduced)}>
                {convs.map((c) => (
                  <li key={c.other_id}>
                    <button onClick={() => openThread(c.profile || { id: c.other_id })} className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-right transition-colors">
                      <Avatar p={c.profile} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{c.profile?.display_name || 'משתמש'}</span>
                          <span className="text-[11px] text-slate-400 shrink-0">{relTime(c.last.created_at)}</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.last.body}</p>
                      </div>
                      {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center shrink-0">{c.unread}</span>}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )
          ) : view === 'new' ? (
            <motion.div key="new" className="flex-1 flex flex-col min-h-0" {...viewMotion(reduced)}>
              <div className="p-3 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 right-3" />
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="חיפוש חבר/ה בליגה"
                    className="w-full pr-9 pl-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                  />
                </div>
              </div>
              <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {filteredMembers.length === 0 ? (
                  <li className="p-6 text-center text-sm text-slate-400">לא נמצאו חברים</li>
                ) : filteredMembers.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => openThread(m)} className="w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-right transition-colors">
                      <Avatar p={m} />
                      <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{m.display_name || 'משתמש'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : (
            /* thread */
            <motion.div key="thread" className="flex-1 flex flex-col min-h-0" {...viewMotion(reduced)}>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
                {messages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-sm text-slate-400 text-pretty">אין הודעות עדיין — כתוב/כתבי הודעה ראשונה</div>
                ) : (
                  // `initial={false}`: opening a thread must NOT animate its whole history
                  // in. Only messages that arrive while you are looking — yours on send,
                  // theirs over realtime — get the entrance.
                  <AnimatePresence initial={false}>
                  {messages.map((m) => {
                  const mine = m.sender_id === user.id
                  return (
                    <motion.div
                      key={m.id}
                      className={`max-w-[80%] ${mine ? 'self-start' : 'self-end'}`}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: ITEM_MS, ease: EASE_OUT }}
                    >
                      {/* Logical corners, not rounded-bl/br: alignment above uses self-start/end,
                          which flip under RTL — physical corners don't, so the tail ended up
                          pointing at the opposite speaker. */}
                      <div className={`px-3 py-2 rounded-2xl text-sm break-words ${mine ? 'bg-brand text-white rounded-es-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-ee-sm'}`}>
                        {m.body}
                      </div>
                      <div className={`text-[10px] text-slate-400 tabular-nums mt-0.5 ${mine ? 'text-start' : 'text-end'}`}>{clockTime(m.created_at)}</div>
                    </motion.div>
                  )
                })}
                  </AnimatePresence>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-slate-100 dark:border-slate-800 shrink-0 flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="הקלד/י הודעה…"
                  className="flex-1 resize-none max-h-28 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/40"
                />
                <motion.button
                  onClick={send}
                  disabled={sending || !draft.trim()}
                  className="size-10 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-40 text-white flex items-center justify-center shrink-0 transition-colors"
                  aria-label="שלח"
                  whileTap={reduced ? undefined : { scale: 0.92 }}
                  transition={{ duration: 0.1, ease: EASE_OUT }}
                >
                  <Send className="size-4" />
                </motion.button>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
