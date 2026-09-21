import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, RefreshCw, Inbox, Undo2, CheckCircle2 } from 'lucide-react'
import { fetchLiveEditHistory, loadReasonText, relativeTime, undoLiveEdit, undoReasonText } from '@/lib/liveEdit'
import { StageChip, ChangedFiles, AgentSummary, RunLinks } from './LiveEditParts'

/**
 * The 20 newest requests, so the admin can answer "what did I ask for, and what
 * came of it?" — a list on a phone, not a table: one row per request, the detail
 * folded away until asked for.
 */
export default function LiveEditHistory() {
  const [state, setState] = useState({ status: 'loading', items: [], reason: null })
  const [open, setOpen] = useState(null)

  const load = useCallback(async (cancelled) => {
    setState((s) => ({ ...s, status: 'loading' }))
    const res = await fetchLiveEditHistory()
    if (cancelled?.()) return
    setState(res.ok
      ? { status: 'ready', items: res.items, reason: null }
      : { status: 'error', items: [], reason: res.reason })
  }, [])

  useEffect(() => {
    let gone = false
    load(() => gone)
    return () => { gone = true }
  }, [load])

  if (state.status === 'loading' && !state.items.length) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="size-5 text-fg-subtle animate-spin" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-sm font-semibold text-fg-muted">{loadReasonText(state.reason)}</p>
        <button onClick={() => load()} className="btn-ghost btn-sm">
          <RefreshCw className="size-3.5" />
          נסו שוב
        </button>
      </div>
    )
  }

  if (!state.items.length) {
    return (
      <div className="py-8 text-center space-y-3">
        <Inbox className="size-7 text-fg-faint mx-auto" />
        <p className="text-sm text-fg-muted">עדיין לא נשלחו בקשות תיקון</p>
        <button onClick={() => load()} className="btn-ghost btn-sm">
          <RefreshCw className="size-3.5" />
          רענון
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs text-fg-subtle flex-1">{state.items.length} הבקשות האחרונות</span>
        <button onClick={() => load()} className="btn-ghost btn-sm" disabled={state.status === 'loading'}>
          {state.status === 'loading'
            ? <Loader2 className="size-3.5 animate-spin" />
            : <RefreshCw className="size-3.5" />}
          רענון
        </button>
      </div>

      <ul className="space-y-2">
        {state.items.map((item) => (
          <Row
            key={item?.number ?? item?.createdAt}
            item={item}
            open={open === item?.number}
            onToggle={() => setOpen((n) => (n === item?.number ? null : item?.number))}
            onUndone={() => load()}
          />
        ))}
      </ul>
    </div>
  )
}

function Row({ item, open, onToggle, onUndone }) {
  const request = (item?.request || item?.title || '').trim()

  return (
    <li className="rounded-xl bg-surface-inset border border-line-subtle overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-start p-3 space-y-1.5 hover:bg-surface-sunken transition-colors"
      >
        <div className="flex items-center gap-2">
          <StageChip stage={item?.stage} />
          <span className="text-2xs text-fg-subtle flex-1">{relativeTime(item?.createdAt)}</span>
          <ChevronDown className={`size-4 text-fg-muted shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        </div>
        <p className={`text-sm text-fg-soft ${open ? '' : 'line-clamp-2'}`}>
          {request || 'ללא תיאור'}
        </p>
        {/* A route is an LTR path inside an RTL row — dir keeps the slashes put. */}
        {item?.route && (
          <p dir="ltr" className="text-2xs text-fg-subtle truncate text-start">{item.route}</p>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-line-subtle pt-2">
          {item?.summary
            ? <AgentSummary summary={item.summary} />
            : <p className="text-xs text-fg-subtle">אין סיכום מהסוכן.</p>}
          <ChangedFiles commit={item?.commit} />
          <RunLinks item={item} />
          <Undo sha={item?.commit?.sha} onUndone={onUndone} />
        </div>
      )}
    </li>
  )
}

/**
 * "בטל את השינוי" — put the code back the way it was before this request.
 *
 * Only offered when the request actually produced a commit: a queued, refused or
 * failed request changed nothing, and a button promising to undo nothing is worse
 * than no button.
 *
 * Confirms first. The undo is itself a commit that redeploys the dev site, so it is
 * not a free action to take by accident — and the server may refuse it (the same
 * files edited again since, a fenced path), which is a sentence worth reading rather
 * than a spinner that ends in nothing.
 */
function Undo({ sha, onUndone }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  if (!sha) return null

  const run = async () => {
    setBusy(true)
    const res = await undoLiveEdit(sha)
    setBusy(false)
    setAsking(false)
    setResult(res)
    // The list now says something untrue about this request — it has been undone,
    // and the row still shows the change as live. Reload rather than patch it.
    if (res.ok) onUndone?.()
  }

  if (result?.ok) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-semibold text-pos">
        <CheckCircle2 className="size-3.5 shrink-0" />
        השינוי בוטל באתר הבדיקות
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      {result && !result.ok && (
        <p className="text-xs text-neg font-semibold">
          {undoReasonText(result.reason)}
          {Array.isArray(result.files) && result.files.length > 0 && (
            <span dir="ltr" className="block font-mono font-normal text-fg-subtle mt-1 text-start">
              {result.files.slice(0, 5).join(', ')}
            </span>
          )}
        </p>
      )}

      {asking ? (
        <div className="flex gap-2">
          <button onClick={run} disabled={busy} className="btn-secondary btn-sm flex-1">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
            כן, לבטל
          </button>
          <button onClick={() => setAsking(false)} disabled={busy} className="btn-ghost btn-sm">
            השאר
          </button>
        </div>
      ) : (
        <button onClick={() => { setResult(null); setAsking(true) }} className="btn-ghost btn-sm w-full">
          <Undo2 className="size-3.5" />
          בטל את השינוי
        </button>
      )}
    </div>
  )
}
