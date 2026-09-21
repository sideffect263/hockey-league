import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Wand2, Crosshair, X, Send, Loader2, ChevronDown, ExternalLink, CheckCircle2, History, ArrowRight } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { describeElement, buildPayload, submitLiveEdit, reasonText } from '@/lib/liveEdit'
import LiveEditProgress from './LiveEditProgress'
import LiveEditHistory from './LiveEditHistory'

// עריכה חיה pushes code and redeploys — it belongs to the DEV deployment only.
// Both environments build from the same commit, so this has to be decided from the
// hostname at runtime; anything baked in at build time ships to rinkhockeyil.com too.
// An ALLOWLIST, not a block on the public host: a new public domain or alias must
// default to "no panel", never to "panel for every admin on the league's site".
const DEV_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|hockey-league-dev(-[a-z0-9-]+)?\.vercel\.app)$/i
const IS_DEV_SITE =
  typeof window !== 'undefined' && DEV_HOSTS.test(window.location.hostname)

const EASE_OUT = 'easeOut'
const MS = 0.18

/**
 * "עריכה חיה" — report a UI bug from the page it is on. The admin points at the
 * offending element, says what is wrong in Hebrew, and a cloud agent gets the
 * element's rendered text to find the file with.
 *
 * Mounted once in Layout, so it rides along on every route.
 */
export default function LiveEditPanel() {
  const { isAdmin } = useAuth()
  // Not "hidden for everyone else" — nothing mounts at all, so no listeners and
  // no stray floating button on a visitor's phone. The host check is first: on
  // rinkhockeyil.com this feature does not exist, admin or not.
  if (!IS_DEV_SITE || !isAdmin) return null
  return <Panel />
}

function Panel() {
  const reduced = useReducedMotion()
  const rootRef = useRef(null)

  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [eating, setEating] = useState(false)
  const [rect, setRect] = useState(null)
  const [picked, setPicked] = useState(null)
  const [request, setRequest] = useState('')
  const [showPayload, setShowPayload] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [sentRoute, setSentRoute] = useState('')
  const [history, setHistory] = useState(false)

  // Our own chrome is part of the page while picking, and capturing the panel
  // that is asking the question would be useless to the fixer.
  const isMine = useCallback((el) => !el || !!rootRef.current?.contains(el), [])

  const startPick = () => { setResult(null); setRect(null); setPicking(true) }
  const stopPick = () => { setPicking(false); setRect(null) }
  const close = () => { stopPick(); setHistory(false); setOpen(false) }
  const reset = () => { setResult(null); setRequest(''); setPicked(null); setShowPayload(false) }

  useEffect(() => {
    if (!picking) return

    // elementFromPoint, not e.target: it ignores our pointer-events-none
    // highlight and answers with whatever the admin is actually looking at.
    const elAt = (e) => document.elementFromPoint(e.clientX, e.clientY)

    const track = (e) => {
      const el = elAt(e)
      if (isMine(el)) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    const select = (e, eatTrailingClick) => {
      const el = elAt(e)
      if (isMine(el)) return // the bar's own ביטול button has to stay clickable
      e.preventDefault()
      e.stopPropagation()
      setPicked(describeElement(el))
      setRect(null)
      setPicking(false)
      setEating(eatTrailingClick)
    }

    // A mouse picks on pointerdown, before the page can act on the press at all.
    // A finger cannot: preventDefault on a touch pointerdown also cancels
    // scrolling, and at the rink the admin has to scroll to reach the element
    // they mean — so touch picks on the click that a tap, but not a scroll, ends in.
    const onPointerDown = (e) => { if (e.pointerType === 'mouse') select(e, true) }
    const onClick = (e) => select(e, false)

    const opts = { capture: true, passive: false }
    document.addEventListener('pointermove', track, true)
    document.addEventListener('pointerdown', onPointerDown, opts)
    document.addEventListener('click', onClick, opts)

    const prevCursor = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'crosshair'

    return () => {
      document.removeEventListener('pointermove', track, true)
      document.removeEventListener('pointerdown', onPointerDown, opts)
      document.removeEventListener('click', onClick, opts)
      document.documentElement.style.cursor = prevCursor
    }
  }, [picking, isMine])

  // A mouse pick ends on pointerdown, and the picker is already torn down by the
  // time the browser dispatches the click that finishes that same press — so
  // without this, picking a nav link navigates away the instant you pick it.
  useEffect(() => {
    if (!eating) return
    const eat = (e) => {
      if (isMine(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      setEating(false)
    }
    document.addEventListener('click', eat, true)
    const timer = setTimeout(() => setEating(false), 700) // no click arrived; stop waiting for one
    return () => { document.removeEventListener('click', eat, true); clearTimeout(timer) }
  }, [eating, isMine])

  // One Escape handler for both states, deliberately. Two of them — a picker's
  // and the panel's — both answer the SAME keypress: the picker's ends picking,
  // React re-renders mid-dispatch, and the panel's listener, registered a beat
  // later on the very event still travelling, then closes the panel too.
  useEffect(() => {
    if (!open && !picking) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (picking) stopPick()
      else if (history) setHistory(false) // one step back, not all the way out
      else setOpen(false)
    }
    // Capture phase: a page that stops a keydown from bubbling must not be able
    // to trap the admin inside picking mode.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, picking, history])

  const preview = useMemo(
    () => (showPayload ? buildPayload({ request, picked }) : null),
    [showPayload, request, picked]
  )

  const send = async () => {
    if (!request.trim() || sending) return
    setSending(true)
    setResult(null)
    try {
      // Rebuilt rather than reusing the preview: viewport and console errors may
      // both have moved on while the admin was typing.
      const payload = buildPayload({ request, picked })
      // Remembered for the "go look at it" button: by the time the fix lands the
      // admin may have walked the app somewhere else entirely.
      setSentRoute(payload.route)
      setResult(await submitLiveEdit(payload))
    } catch {
      setResult({ ok: false, reason: 'network' })
    } finally {
      setSending(false)
    }
  }

  const sheetMotion = {
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: reduced ? { opacity: 1 } : { opacity: 1, y: 0 },
    exit: reduced ? { opacity: 0 } : { opacity: 0, y: 16 },
    transition: { duration: MS, ease: EASE_OUT },
  }

  return (
    <div ref={rootRef} dir="rtl">
      {/* Hover highlight. A floating box rather than an outline on the element
          itself — the page's own styles stay untouched, and nothing can be left
          behind on a node that re-renders mid-pick. */}
      {picking && rect && (
        <div
          className="fixed z-[80] pointer-events-none rounded"
          style={{
            top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 2px rgb(var(--brand))',
            backgroundColor: 'rgb(var(--brand) / 0.12)',
          }}
        />
      )}

      <AnimatePresence>
        {!open && !picking && (
          <motion.button
            onClick={() => setOpen(true)}
            // Fixed element: keep it clear of the home indicator on iOS. The chat
            // launcher owns the opposite corner.
            style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
            className="fixed start-6 z-40 size-12 rounded-full bg-brand-deep text-white shadow-lg shadow-brand/30 flex items-center justify-center hover:bg-brand transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="עריכה חיה"
            title="עריכה חיה"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            transition={{ duration: MS, ease: EASE_OUT }}
            whileTap={reduced ? undefined : { scale: 0.94 }}
          >
            <Wand2 className="size-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Picking mode: the panel gets out of the way and leaves a single bar. */}
      <AnimatePresence>
        {picking && (
          <motion.div
            className="fixed top-20 inset-x-0 z-[95] flex justify-center px-4 pointer-events-none"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: MS, ease: EASE_OUT }}
          >
            <div className="pointer-events-auto card shadow-2xl flex items-center gap-2 px-3 py-2">
              <Crosshair className="size-4 text-brand shrink-0" />
              <span className="text-sm font-semibold text-fg-strong">בחרו את הרכיב הבעייתי</span>
              <span className="hidden sm:inline text-2xs text-fg-subtle">Esc לביטול</span>
              <button onClick={stopPick} className="btn-ghost btn-sm">ביטול</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && !picking && (
          <motion.div
            role="dialog"
            aria-label="עריכה חיה"
            className="fixed z-[90] inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-6 sm:start-6 sm:w-[380px]"
            {...sheetMotion}
          >
            <div
              className="card shadow-2xl rounded-b-none sm:rounded-2xl flex flex-col max-h-[85vh]"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              <div className="flex items-center gap-2 px-4 h-12 border-b border-line-subtle shrink-0">
                {history ? (
                  // Back, not close: RTL means the arrow points the way the eye
                  // came from.
                  <button onClick={() => setHistory(false)} aria-label="חזרה" className="p-2 -ms-2 rounded-lg text-fg-muted hover:bg-surface-sunken transition-colors">
                    <ArrowRight className="size-4" />
                  </button>
                ) : (
                  <Wand2 className="size-4 text-brand" />
                )}
                <h3 className="font-bold text-fg-strong flex-1">{history ? 'היסטוריית בקשות' : 'עריכה חיה'}</h3>
                {!history && (
                  <button onClick={() => setHistory(true)} className="btn-ghost btn-sm" title="היסטוריה">
                    <History className="size-3.5" />
                    היסטוריה
                  </button>
                )}
                <button onClick={close} aria-label="סגור" className="p-2 -me-2 rounded-lg text-fg-muted hover:bg-surface-sunken transition-colors">
                  <X className="size-4" />
                </button>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto">
                {history ? (
                  <LiveEditHistory />
                ) : result?.ok && result.number ? (
                  // The point of the whole feature: four-odd minutes of silence
                  // replaced by the actual stage, and then by what changed.
                  <LiveEditProgress
                    number={result.number}
                    issueHref={result.url}
                    route={sentRoute}
                    onClose={close}
                    onReset={reset}
                  />
                ) : result?.ok ? (
                  // No issue number came back, so there is nothing to poll for —
                  // don't draw a progress ladder we cannot honestly fill in.
                  <div className="space-y-3 text-center py-2">
                    <CheckCircle2 className="size-8 text-pos mx-auto" />
                    <p className="font-bold text-fg-strong">הבקשה נשלחה</p>
                    <p className="text-sm text-fg-muted">אין לנו מספר בקשה למעקב, אבל היא בדרך.</p>
                    {result.url && (
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full">
                        <ExternalLink className="size-4" />
                        צפייה בבקשה
                      </a>
                    )}
                    <button onClick={reset} className="btn-ghost btn-sm w-full">בקשה נוספת</button>
                  </div>
                ) : (
                  <>
                    {picked ? (
                      <div className="rounded-xl bg-surface-inset border border-line-subtle p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="stat-pill badge-info shrink-0" dir="ltr">{picked.tag}</span>
                          <span className="text-2xs text-fg-subtle flex-1 truncate" dir="ltr">{picked.selector}</span>
                          <button onClick={() => setPicked(null)} aria-label="נקה בחירה" className="text-fg-muted hover:text-fg-strong shrink-0">
                            <X className="size-3.5" />
                          </button>
                        </div>
                        {picked.text
                          ? <p className="text-sm text-fg-soft line-clamp-2">{picked.text}</p>
                          : <p className="text-sm text-fg-subtle">הרכיב שנבחר ללא טקסט</p>}
                        <button onClick={startPick} className="text-xs font-bold text-brand hover:underline">בחירה מחדש</button>
                      </div>
                    ) : (
                      <button onClick={startPick} className="btn-secondary w-full">
                        <Crosshair className="size-4" /> בחר רכיב
                      </button>
                    )}

                    <div>
                      <label htmlFor="live-edit-request" className="block text-xs font-bold text-fg-muted mb-1.5">מה לא בסדר כאן?</label>
                      <textarea
                        id="live-edit-request"
                        value={request}
                        onChange={(e) => setRequest(e.target.value)}
                        rows={3}
                        placeholder="למשל: שם הקבוצה נחתך בטלפון, צריך שירד שורה"
                        className="input resize-none"
                      />
                    </div>

                    <div>
                      <button
                        onClick={() => setShowPayload(v => !v)}
                        className="flex items-center gap-1 text-xs font-bold text-fg-muted hover:text-fg-strong transition-colors"
                      >
                        <ChevronDown className={`size-3.5 transition-transform ${showPayload ? '' : '-rotate-90'}`} />
                        מה נשלח
                      </button>
                      {showPayload && (
                        <pre dir="ltr" className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-inset border border-line-subtle p-2 text-[10px] leading-relaxed text-fg-muted whitespace-pre-wrap break-all">
                          {JSON.stringify(preview, null, 2)}
                        </pre>
                      )}
                    </div>

                    {result && !result.ok && (
                      <p className="text-sm font-semibold text-neg">{reasonText(result.reason)}</p>
                    )}
                  </>
                )}
              </div>

              {!result?.ok && !history && (
                <div className="px-4 pb-4 pt-1 shrink-0">
                  <button onClick={send} disabled={!request.trim() || sending} className="btn-primary w-full">
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    {sending ? 'שולח…' : 'שליחה לתיקון'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
