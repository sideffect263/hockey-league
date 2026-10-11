// First-party telemetry — every screen, every deliberate action, every failure.
//
// GA4 (analytics.js) answers "how many people looked at the players page". It cannot
// answer the question that actually costs us days: "did the thing the user pressed
// WORK?" The failures that keep biting this project are invisible server-side — a
// request rejected at the row-level, a render that threw, a fetch that never left the
// browser. All of those are silent in the Supabase edge logs. So the client reports.
//
// Design constraints, in order:
//  1. NEVER break the app. Every entry point swallows its own errors. A telemetry
//     bug must not be able to take down a page it is only supposed to watch.
//  2. Never block. Events queue in memory and flush on a timer / on page hide.
//  3. Never carry personal data. Names, emails, dates of birth and free text the user
//     typed do NOT belong here — see `scrub` below. The row already carries user_id;
//     anything more is a liability, and some of these accounts belong to minors.

import { supabase, setRequestReporter } from './supabase'

const PLATFORM = 'web'
const FLUSH_MS = 5000
const MAX_QUEUE = 50

// Identifies one browsing session so a path through the app can be followed without
// the person being signed in. sessionStorage, not localStorage: it dies with the tab,
// which is the point — this is not a durable tracking id.
const SESSION_ID = (() => {
  try {
    const k = 'rh_telemetry_session'
    let v = sessionStorage.getItem(k)
    if (!v) {
      v = (crypto.randomUUID?.() || String(Math.random()).slice(2)) + ''
      sessionStorage.setItem(k, v)
    }
    return v
  } catch {
    // Private mode / storage blocked: still report, just unlinked between events.
    return 'nostore-' + String(Math.random()).slice(2)
  }
})()

// The deployed bundle name is the most honest version marker the web app has: it
// changes exactly when a new build goes out, which is precisely the question you ask
// when an error starts appearing ("is this the release I shipped an hour ago?").
const APP_VERSION = (() => {
  try {
    const src = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || ''
    return src.split('/').pop()?.replace(/\.js$/, '') || 'dev'
  } catch { return 'dev' }
})()

let queue = []
let timer = null
let started = false
// Cached so the unload path can authenticate WITHOUT awaiting getSession(): once the
// page is hiding there is no time left to resolve a promise.
let accessToken = null
let lastPage = { path: null, at: 0 }

/**
 * Strip anything that could be personal before it leaves the browser.
 *
 * Telemetry detail is for DIAGNOSIS — a code, a status, an id, a count. It is not a
 * place to stash what someone typed. Keys whose names suggest human content are
 * dropped outright, strings are truncated, and nesting is flattened away so a whole
 * record object can never ride along inside one innocent-looking field.
 */
function scrub(detail) {
  if (!detail || typeof detail !== 'object') return {}
  const BANNED = /name|email|phone|birth|dob|address|token|password|secret|key|message|text|body|content|note|comment|title/i
  const out = {}
  for (const [k, v] of Object.entries(detail)) {
    if (BANNED.test(k)) continue
    if (v == null) continue
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue }
    if (typeof v === 'string') { out[k] = v.slice(0, 200); continue }
    // Objects and arrays are summarised, never copied: a nested payload is exactly
    // how free text sneaks into a "safe" field.
    if (Array.isArray(v)) out[k] = `[${v.length}]`
  }
  return out
}

/**
 * Turn a Supabase request into a readable action name.
 *
 * `POST /rest/v1/rpc/approve_claim` → "approve_claim"
 * `PATCH /rest/v1/games`            → "update:games"
 * `POST /storage/v1/object/medical` → "upload:medical"
 *
 * The RPC name is the good case: these functions are already named after the thing
 * the user did, so the action log reads like a sentence instead of like HTTP.
 */
function describe(path, method) {
  const rpc = path.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)$/i)
  if (rpc) return rpc[1]
  const rest = path.match(/\/rest\/v1\/([a-z0-9_]+)$/i)
  if (rest) {
    const verb = { POST: 'insert', PATCH: 'update', PUT: 'upsert', DELETE: 'delete' }[method] || method.toLowerCase()
    return `${verb}:${rest[1]}`
  }
  const bucket = path.match(/\/storage\/v1\/object(?:\/[a-z]+)?\/([a-z0-9_-]+)\//i)
  if (bucket) return `${method === 'DELETE' ? 'delete' : 'upload'}:${bucket[1]}`
  if (path.startsWith('/auth/v1/')) return `auth:${path.split('/').pop()}`
  if (path.startsWith('/functions/v1/')) return `fn:${path.split('/').pop()}`
  return `${method.toLowerCase()}:${path.split('/').pop() || 'root'}`
}

function schedule() {
  if (timer) return
  try { timer = setTimeout(flush, FLUSH_MS) } catch { /* no timers (SSR) */ }
}

/**
 * Send whatever is queued. Fire-and-forget: a failed flush drops the batch.
 *
 * @param {boolean} [unloading] true when the page is going away. The normal client
 *   call is cancelled the moment the document is torn down, which would silently
 *   lose the last thing that happened before someone navigated off or closed the tab
 *   — i.e. precisely the event worth having when they left because it broke. A
 *   `keepalive` fetch is handed to the browser to finish on its own after the page
 *   is gone. It is used ONLY here: keepalive bodies are capped at 64 KB.
 */
export async function flush(unloading = false) {
  try { clearTimeout(timer) } catch { /* ignore */ }
  timer = null
  if (!queue.length) return
  const batch = queue
  queue = []
  try {
    if (unloading) {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/log_app_events`
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY
      await fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          // Falls back to the anon key when signed out, which is what Supabase
          // expects — the event is then simply recorded without a user_id.
          Authorization: `Bearer ${accessToken || key}`,
        },
        body: JSON.stringify({ p_events: batch }),
      })
      return
    }
    await supabase.rpc('log_app_events', { p_events: batch })
  } catch {
    // Deliberately dropped, not retried. A retry loop on a failing network is how a
    // watcher turns into the outage it was meant to report.
  }
}

/**
 * Queue one event. Safe to call from anywhere, including inside an error handler.
 * @param {'page'|'action'|'error'} kind
 * @param {string} name   short, stable identifier — 'page_view', 'game_saved', 'rest_error'
 * @param {{path?:string,status?:number,duration_ms?:number,detail?:object}} [extra]
 */
export function track(kind, name, extra = {}) {
  try {
    if (!started) return
    queue.push({
      at: new Date().toISOString(),
      session_id: SESSION_ID,
      platform: PLATFORM,
      app_version: APP_VERSION,
      kind,
      name: String(name).slice(0, 120),
      path: (extra.path ?? (typeof location !== 'undefined' ? location.pathname : null))?.slice(0, 400) ?? null,
      status: Number.isFinite(extra.status) ? extra.status : null,
      duration_ms: Number.isFinite(extra.duration_ms) ? Math.round(extra.duration_ms) : null,
      detail: scrub(extra.detail),
    })
    // An error is the one thing worth sending immediately: the very next instruction
    // may be the navigation (or the crash) that loses the queue.
    if (kind === 'error' || queue.length >= MAX_QUEUE) flush()
    else schedule()
  } catch { /* never let telemetry throw into the caller */ }
}

/**
 * A screen was shown.
 *
 * Deduped within a second of the same path. React StrictMode double-invokes effects
 * in development, and a render loop could do the same in production — either way a
 * doubled count is worse than a missed one, because it quietly halves every
 * per-user number on the dashboard. A genuine re-visit a second later still counts.
 */
export function trackPage(path) {
  const now = Date.now()
  if (path === lastPage.path && now - lastPage.at < 1000) return
  lastPage = { path, at: now }
  track('page', 'page_view', { path })
}

/** The user deliberately did something. */
export const trackAction = (name, detail) => track('action', name, { detail })

/** Something failed. */
export const trackError = (name, detail, status) => track('error', name, { detail, status })

const BOT_UA = /\bbot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|prerender|phantomjs|puppeteer|playwright/i

/** A crawler, headless browser or automation driver rather than a person. */
export function isAutomated(nav = typeof navigator !== 'undefined' ? navigator : null) {
  try {
    if (!nav) return false
    return nav.webdriver === true || BOT_UA.test(nav.userAgent || '')
  } catch { return false }
}

/**
 * Install the global listeners and start reporting.
 *
 * Called once from main.jsx. Until this runs, track() is a no-op — so an import cycle
 * or an early module-scope error can never produce half-formed events.
 */
export function initTelemetry() {
  if (started || typeof window === 'undefined') return
  // Crawlers and headless browsers render the SPA but skip images, so each one logged
  // a page view plus an asset_error for the logo — ~200 fake one-page "visitors" a
  // week, every ~15 min, burying the real errors and inflating anonymous traffic.
  // The local dev server is just as noisy (HMR mid-edit crashes). Neither is a user.
  if (import.meta.env.DEV || isAutomated()) return
  started = true

  // Uncaught exceptions — the white-screen class.
  window.addEventListener('error', (e) => {
    // Failed <img>/<script> loads surface here too, with no Error object. Those are
    // worth knowing about (a dead crest, a chunk that 404s after a deploy) but they
    // are a different animal from a thrown exception, so name them apart.
    if (e?.target && e.target !== window && e.target.tagName) {
      trackError('asset_error', { tag: e.target.tagName.toLowerCase(), src: String(e.target.src || e.target.href || '').slice(0, 200) })
      return
    }
    trackError('js_error', {
      reason: String(e?.message || 'unknown').slice(0, 200),
      at: `${String(e?.filename || '').split('/').pop()}:${e?.lineno || 0}`,
    })
  }, true)

  // Rejected promises — the "nothing happened when I pressed it" class.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason
    trackError('promise_rejection', {
      reason: String(r?.message || r || 'unknown').slice(0, 200),
      code: r?.code ? String(r.code).slice(0, 40) : undefined,
    })
  })

  // Every Supabase request the app makes. Failures become errors — the class of bug
  // that is invisible in the edge logs because the caller catches it and renders an
  // empty list instead. Writes become the action log.
  setRequestReporter(({ path, method, status, ok, duration_ms, error }) => {
    // The telemetry RPC travels through the same instrumented fetch. Reporting ITS
    // failure would queue an event, whose flush fails, which queues another event:
    // a self-feeding loop that hammers the server precisely when it is already
    // unhealthy. Stay silent about ourselves.
    if (path.endsWith('/rpc/log_app_events')) return

    if (!ok) {
      track('error', 'request_failed', { path, status, duration_ms, detail: { method, op: describe(path, method), ...error } })
      return
    }
    // A successful read is not news. A successful write is exactly what "what are
    // people doing in the system" means.
    if (method !== 'GET' && method !== 'HEAD') {
      track('action', describe(path, method), { path, status, duration_ms })
    }
  })

  // A queued batch must survive the tab closing. visibilitychange fires reliably on
  // mobile Safari where 'unload' does not.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true) })
  window.addEventListener('pagehide', () => flush(true))

  // Keep the token the unload path uses in step with the session. onAuthStateChange
  // fires with the current session on subscribe, so this covers the already-signed-in
  // case as well as later sign-in/out.
  try {
    supabase.auth.onAuthStateChange((_event, session) => { accessToken = session?.access_token || null })
  } catch { /* auth unavailable — events are still recorded, just without a user */ }
}
