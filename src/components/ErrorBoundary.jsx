import React from 'react'
import { trackError, flush } from '@/lib/telemetry'
import { BrandIcon } from '@/components/icons/BrandIcons'
import { isStaleChunkError, reloadForStaleChunk, isReloadingForStaleChunk } from '@/lib/staleChunkReload'

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
    if (isReloadingForStaleChunk()) return
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
    // The new build is already loading; a blank beat beats a crash page.
    if (isReloadingForStaleChunk()) return null
    // ShellStates board, "4 · תקלה": today's copy, our whistle, the ink button.
    return (
      <div dir="rtl" className="min-h-screen flex items-center justify-center px-8 py-6 text-center bg-surface-page text-fg-strong">
        <div className="max-w-sm flex flex-col items-center gap-3">
          <BrandIcon name="referee" variant="large" className="w-[92px] h-[92px]" />
          <h1 className="text-[26px] font-black">המשחק נעצר</h1>
          <p className="text-[15px] text-fg-soft leading-relaxed">
            בטח בדיוק דחפנו עדכון חדש. נסו לרענן ונחזור לשחק.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-1.5 h-[52px] px-[30px] rounded-2xl bg-brand text-brand-fg text-[15.5px] font-extrabold"
          >
            רענון
          </button>
          <p className="text-[12px] text-fg-muted">התקלה נשלחה אלינו אוטומטית</p>
        </div>
      </div>
    )
  }
}
