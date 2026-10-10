import React from 'react'
import { trackError, flush } from '@/lib/telemetry'
import { isStaleChunkError, reloadForStaleChunk } from '@/lib/staleChunkReload'

/**
 * Catches a render-time crash, reports it, and shows something human instead of the
 * blank page React leaves behind when a component throws.
 *
 * A thrown render is the worst failure this app has, because it is completely silent:
 * the user sees white, the server sees a clean 200, and nobody files a report — they
 * just stop using it. This turns that into a row in the telemetry tab.
 *
 * A class component on purpose: componentDidCatch has no hook equivalent.
 */
const DEV_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|hockey-league-dev(-[a-z0-9-]+)?\.vercel\.app)$/i

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    // `?crash-preview` shows this page without a real crash (and without reporting
    // one) so it can be looked at — dev hosts only, never on the public site.
    const preview = DEV_HOSTS.test(window.location.hostname) &&
      new URLSearchParams(window.location.search).has('crash-preview')
    this.state = { crashed: preview }
  }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error, info) {
    // An old tab asking for a page file the latest deploy replaced: not a bug, just stale.
    // Reload once (guarded) instead of showing the crash page.
    if (isStaleChunkError(error) && reloadForStaleChunk()) return

    // The component stack names the screen that broke, which is the single most
    // useful field when reading this back. The message is a developer string, never
    // user content, so it is safe to carry.
    const component = String(info?.componentStack || '')
      .trim().split('\n')[0]?.trim().replace(/^(at|in)\s+/, '') || 'unknown'
    trackError('render_crash', {
      reason: String(error?.message || error || 'unknown').slice(0, 200),
      component: component.slice(0, 80),
    })
    // The user's next move is a reload, which discards the queue — send it now.
    flush()
  }

  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center p-6 text-center bg-white dark:bg-slate-950">
        <div className="max-w-sm space-y-4">
          <BallOutOfRink />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            המשחק נעצר – הכדור יצא מהמגרש
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            נסו לרענן את העמוד ונחזור לשחק 🛼
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-brand text-white text-sm font-semibold"
          >
            רענון
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            בטח בדיוק דחפנו עדכון חדש 😅
          </p>
        </div>
      </div>
    )
  }
}

// The crash illustration, drawn in the HockeyIcons family's language (2px rounded
// strokes in currentColor, the ball as the one brand-colored accent): the rink from
// above with an empty faceoff spot, and the ball bouncing off past the boards.
function BallOutOfRink() {
  return (
    <svg
      viewBox="0 0 120 84"
      className="w-40 h-28 mx-auto text-slate-400 dark:text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="30" width="80" height="48" rx="13" />
      <line x1="48" y1="30" x2="48" y2="78" />
      <circle cx="48" cy="54" r="8" />
      <path d="M8 46 h7 v16 h-7" />
      <path d="M88 46 h-7 v16 h7" />
      {/* the ball's flight: from center ice, over the boards, out */}
      <path d="M48 54 C 62 30, 86 12, 104 16" strokeDasharray="2 5" opacity="0.6" />
      <g className="ball-out">
        <circle cx="106" cy="16" r="5" fill="rgb(var(--brand))" stroke="none" />
      </g>
    </svg>
  )
}
