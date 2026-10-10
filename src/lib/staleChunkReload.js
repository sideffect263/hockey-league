/**
 * A tab left open across a deploy still runs the OLD build, which asks for page chunks
 * (assets/Feed-abc123.js…) that the new deploy no longer serves. The lazy import fails,
 * the ErrorBoundary showed "המשחק נעצר", and the user had to refresh by hand — 72
 * crashes / 11 signed-in users in two weeks, every one of them this.
 *
 * Fix: reload once to pick up the new build. Guarded so a genuinely broken asset can't
 * put the page into a reload loop: at most one automatic reload per 30 seconds.
 */
const KEY = 'stale-chunk-reload-at'
const WINDOW_MS = 30_000

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i

export function isStaleChunkError(err) {
  return STALE_CHUNK.test(String(err?.message || err || ''))
}

/** Reload once if we haven't just done so. Returns true when a reload was started. */
export function reloadForStaleChunk() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    // No sessionStorage (private mode / blocked): reloading without a guard could loop.
    return false
  }
  window.location.reload()
  return true
}

/** Vite fires this when a dynamic import's preload fails (production builds). */
export function installStaleChunkReload() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleChunk()) event.preventDefault()
  })
}
