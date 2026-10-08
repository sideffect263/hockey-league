// Feed impressions: which cards a signed-in viewer actually looked at, for how long,
// and which ones they tapped through. Feeds the personalised ranking in feed.js via
// public.feed_impressions (see supabase/feed-personalization.sql).
//
// Same rules as telemetry.js: never break the page, never block, never carry content —
// only the item key, its tags (team/player/source ids) and three numbers.
//
// "Looked at" = at least half the card on screen (or, for a card taller than the
// viewport, covering half of it) while the tab is visible. Time is only counted in
// that state, so a tab left open in the background doesn't make anything "loved".

import { supabase } from './supabase'

const FLUSH_MS = 10000
const MIN_VIEW_MS = 300        // shorter than this is a card flying past, not a view
const MAX_EPISODE_MS = 120000  // one look is capped: someone walked away mid-card

let enabled = false
let accessToken = null
let observer = null
let timer = null

const tracked = new Map()   // element -> { key, tags }
const visibleSince = new Map() // key -> ms timestamp the current look started
const pending = new Map()   // key -> { key, tags, views, dwell_ms, opens }

function bucket(key, tags) {
  let b = pending.get(key)
  if (!b) { b = { key, tags, views: 0, dwell_ms: 0, opens: 0 }; pending.set(key, b) }
  if (tags?.length && !b.tags?.length) b.tags = tags
  return b
}

function endLook(key, tags, now = Date.now()) {
  const start = visibleSince.get(key)
  if (start == null) return
  visibleSince.delete(key)
  const ms = Math.min(now - start, MAX_EPISODE_MS)
  if (ms < MIN_VIEW_MS) return
  const b = bucket(key, tags)
  b.views += 1
  b.dwell_ms += ms
  schedule()
}

function isLooking(entry) {
  if (!entry.isIntersecting) return false
  if (entry.intersectionRatio >= 0.5) return true
  const vh = entry.rootBounds?.height || window.innerHeight || 0
  return vh > 0 && entry.intersectionRect.height >= vh * 0.5
}

function onIntersect(entries) {
  const now = Date.now()
  for (const entry of entries) {
    const info = tracked.get(entry.target)
    if (!info) continue
    if (isLooking(entry) && document.visibilityState === 'visible') {
      if (!visibleSince.has(info.key)) visibleSince.set(info.key, now)
    } else {
      endLook(info.key, info.tags, now)
    }
  }
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer
  observer = new IntersectionObserver(onIntersect, { threshold: [0, 0.25, 0.5, 0.75, 1] })
  return observer
}

function schedule() {
  if (timer) return
  timer = setTimeout(() => flush(false), FLUSH_MS)
}

/** Close every open look (tab hidden / leaving the page), then send. */
function closeAllAndFlush(unloading) {
  const now = Date.now()
  for (const info of tracked.values()) endLook(info.key, info.tags, now)
  flush(unloading)
}

async function flush(unloading) {
  clearTimeout(timer); timer = null
  if (!pending.size || !enabled) { pending.clear(); return }
  const batch = [...pending.values()]
  pending.clear()
  try {
    if (unloading && accessToken) {
      // Same reason as telemetry.js: a normal client call dies with the page.
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/log_feed_impressions`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ p_events: batch }),
      })
      return
    }
    await supabase.rpc('log_feed_impressions', { p_events: batch })
  } catch {
    // Dropped, not retried — an impression is never worth a retry loop.
  }
}

let listenersInstalled = false
function installListeners() {
  if (listenersInstalled || typeof document === 'undefined') return
  listenersInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { closeAllAndFlush(true); return }
    // Back to the tab: whatever is on screen now starts a fresh look. The observer
    // won't re-fire for cards that never moved, so re-check them by hand.
    const now = Date.now()
    for (const [el, info] of tracked) {
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const shown = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      if (r.height > 0 && (shown / r.height >= 0.5 || shown >= vh * 0.5)) visibleSince.set(info.key, now)
    }
  })
  window.addEventListener('pagehide', () => closeAllAndFlush(true))
  try {
    supabase.auth.onAuthStateChange((_e, session) => { accessToken = session?.access_token || null })
  } catch { /* no auth → nothing is sent anyway */ }
}

/**
 * Turn tracking on for a signed-in viewer, off for a guest. Guests are not tracked at
 * all: there is nothing to personalise, and the RPC would ignore them anyway.
 */
export function setFeedTracking(on) {
  enabled = !!on
  if (enabled) installListeners()
  else { pending.clear(); visibleSince.clear() }
}

/**
 * Watch one feed card. Returns the cleanup for a React effect.
 * Also counts taps on any link or button inside the card as an "open" — delegated, so
 * the card components themselves need no changes.
 */
export function observeFeedItem(el, key, tags) {
  if (!el || !key) return () => {}
  const obs = ensureObserver()
  const info = { key, tags }
  tracked.set(el, info)
  obs?.observe(el)
  const onClick = (e) => {
    if (!enabled) return
    const hit = e.target?.closest?.('a,button,[role="button"],iframe')
    if (!hit || !el.contains(hit)) return
    // Likes and comments are read server-side from the reaction tables themselves;
    // only count going somewhere / expanding / starting media here.
    if (hit.closest('[data-reactions]')) return
    bucket(key, tags).opens += 1
    schedule()
  }
  el.addEventListener('click', onClick)
  return () => {
    el.removeEventListener('click', onClick)
    obs?.unobserve(el)
    endLook(key, tags)
    tracked.delete(el)
  }
}

/**
 * Count an "open" for a feed item tapped OUTSIDE its card — the videos row at the top
 * of the feed plays items that also sit further down the stream.
 */
export function noteFeedOpen(key, tags) {
  if (!enabled || !key) return
  bucket(key, tags).opens += 1
  schedule()
}

/** The viewer's ranking inputs, or null for a guest / on any failure. */
export async function getFeedPersonalization() {
  try {
    const { data, error } = await supabase.rpc('feed_personalization')
    if (error || !data) return null
    return data
  } catch {
    return null
  }
}
