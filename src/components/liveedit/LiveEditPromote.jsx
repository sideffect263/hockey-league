import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, Rocket, ExternalLink, CheckCircle2, ShieldAlert, Inbox } from 'lucide-react'
import { fetchPending, promoteToLeague, promoteReasonText, relativeTime } from '@/lib/liveEdit'

/**
 * "שליחה לאתר הליגה" — the one deliberate step in live-edit.
 *
 * Everything else here ships itself: an edit lands on `dev` and the dev site
 * redeploys with nobody's permission. This is the screen where that stops being
 * true. What it shows before the button is the whole point — the list of changes
 * that are ABOUT to become the league's website, so the answer to "what am I
 * publishing?" is on screen rather than in somebody's memory of the last hour.
 *
 * Two-step on purpose. The confirm is not ceremony: the first press is reachable
 * by a thumb on a phone at the rink, and the thing on the other side of it is
 * read by the league.
 */
export default function LiveEditPromote() {
  const [state, setState] = useState({ status: 'loading', data: null, reason: null })
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null)
  const [failed, setFailed] = useState(null)

  const load = useCallback(async (cancelled) => {
    setState((s) => ({ ...s, status: 'loading' }))
    const res = await fetchPending()
    if (cancelled?.()) return
    setState(res.ok
      ? { status: 'ready', data: res, reason: null }
      : { status: 'error', data: null, reason: res.reason })
  }, [])

  useEffect(() => {
    let gone = false
    load(() => gone)
    return () => { gone = true }
  }, [load])

  const ship = async () => {
    setSending(true)
    setFailed(null)
    const res = await promoteToLeague()
    setSending(false)
    setConfirming(false)
    if (res.ok) { setDone(res); return }
    setFailed(res)
    // A refusal is about what is on the branch right now, so the list the admin is
    // looking at is out of date the moment they see one. Re-read it.
    load()
  }

  // ---- after shipping -------------------------------------------------------
  if (done) {
    return (
      <div className="space-y-3 text-center py-2">
        <CheckCircle2 className="size-8 text-pos mx-auto" />
        <p className="font-bold text-fg-strong">
          {done.count} שינויים נשלחו לאתר הליגה
        </p>
        {/* Said plainly, because the admin's next move is to open rinkhockeyil.com
            and not see the change yet. That is the build, not a failure. */}
        <p className="text-sm text-fg-muted">
          {done.deployTriggered
            ? 'הבנייה רצה עכשיו. האתר יתעדכן בעוד כמה דקות.'
            : 'המיזוג בוצע, אבל לא הצלחנו להפעיל את הבנייה. צריך להריץ אותה ידנית ב-GitHub.'}
        </p>
        <div className="space-y-2">
          {(done.run?.url || done.runsUrl) && (
            <a href={done.run?.url || done.runsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full">
              <ExternalLink className="size-4" />
              מעקב אחרי הבנייה
            </a>
          )}
          <a href="https://rinkhockeyil.com" target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm w-full">
            פתיחת אתר הליגה
          </a>
        </div>
      </div>
    )
  }

  // ---- loading / error ------------------------------------------------------
  if (state.status === 'loading' && !state.data) {
    return <div className="py-8 flex justify-center"><Loader2 className="size-5 text-fg-subtle animate-spin" /></div>
  }

  if (state.status === 'error') {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-sm font-semibold text-fg-muted">{promoteReasonText(state.reason)}</p>
        <button onClick={() => load()} className="btn-ghost btn-sm">
          <RefreshCw className="size-3.5" />
          נסו שוב
        </button>
      </div>
    )
  }

  const { pending = [], count = 0, lastPromotedAt, blockedFiles = [] } = state.data || {}
  const blocked = blockedFiles.length > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xs text-fg-subtle flex-1">
          {lastPromotedAt ? `נשלח לאחרונה ${relativeTime(lastPromotedAt)}` : 'עדיין לא נשלח מכאן'}
        </span>
        <button onClick={() => load()} className="btn-ghost btn-sm" disabled={state.status === 'loading'}>
          {state.status === 'loading'
            ? <Loader2 className="size-3.5 animate-spin" />
            : <RefreshCw className="size-3.5" />}
          רענון
        </button>
      </div>

      {!count ? (
        <div className="py-8 text-center space-y-2">
          <Inbox className="size-7 text-fg-faint mx-auto" />
          <p className="text-sm text-fg-muted">אתר הליגה מעודכן</p>
          <p className="text-2xs text-fg-subtle">אין שינויים שממתינים לשליחה</p>
        </div>
      ) : (
        <>
          <p className="text-sm font-bold text-fg-strong">
            {count} שינויים ממתינים לאתר הליגה
          </p>

          <ul className="rounded-xl bg-surface-inset border border-line-subtle divide-y divide-line-subtle overflow-hidden">
            {pending.map((c) => (
              <li key={c.sha} className="p-3 space-y-1">
                <p className="text-xs text-fg-soft">{c.message || '(ללא תיאור)'}</p>
                <div className="flex items-center gap-2 text-2xs text-fg-subtle">
                  <span dir="ltr" className="font-mono shrink-0">{c.shortSha}</span>
                  {c.date && <span className="flex-1 truncate">{relativeTime(c.date)}</span>}
                </div>
              </li>
            ))}
          </ul>

          {/* Advisory — the POST re-checks this per commit and is the only thing
              that decides. Shown here so the refusal is not a surprise AFTER the
              admin has worked up to pressing a publish button. */}
          {blocked && (
            <div className="rounded-xl bg-surface-inset border border-amber-300 dark:border-amber-800/60 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-xs font-bold text-fg-muted">צריך אישור ידני</span>
              </div>
              <p className="text-2xs text-fg-subtle">
                חלק מהשינויים נוגעים בקבצים רגישים, ולכן השליחה מכאן תיחסם:
              </p>
              <ul className="space-y-0.5">
                {blockedFiles.slice(0, 8).map((f) => (
                  <li key={f} dir="ltr" className="text-2xs font-mono text-fg-subtle truncate text-start">{f}</li>
                ))}
              </ul>
            </div>
          )}

          {failed && (
            <p className="text-xs text-neg font-semibold">
              {promoteReasonText(failed.reason)}
              {Array.isArray(failed.files) && failed.files.length > 0 && (
                <span dir="ltr" className="block font-mono font-normal text-fg-subtle mt-1 text-start">
                  {failed.files.slice(0, 5).join(', ')}
                </span>
              )}
            </p>
          )}

          {confirming ? (
            <div className="space-y-2">
              <p className="text-xs text-fg-muted text-center">
                זה יפרסם את השינויים באתר שהליגה רואה.
              </p>
              <div className="flex gap-2">
                <button onClick={ship} disabled={sending} className="btn-primary flex-1">
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                  כן, לשלוח
                </button>
                <button onClick={() => setConfirming(false)} disabled={sending} className="btn-ghost">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setFailed(null); setConfirming(true) }} className="btn-primary w-full">
              <Rocket className="size-4" />
              שליחה לאתר הליגה
            </button>
          )}
        </>
      )}
    </div>
  )
}
