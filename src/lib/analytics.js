// Google Analytics 4 — dormant unless VITE_GA4_ID is set.
//
// When the env var is absent (local dev, Preview deploys, or before the GA4
// property is provisioned) every export is a no-op and NOT a single network
// request is made: initAnalytics() injects no gtag script and trackPageview()
// returns immediately. The tag lights up only in the Production build that
// carries VITE_GA4_ID.

const GA_ID = import.meta.env.VITE_GA4_ID
let started = false

// Admins and developers browse the site all day (/admin and /devs were the 2nd and
// 4th most viewed pages). Their hits carry traffic_type=internal, which GA4's
// "Internal Traffic" data filter drops. The flag is remembered on the device so the
// very first page_view of the next visit is tagged too — before the session loads.
const INTERNAL_KEY = 'ga_internal'
const readInternal = () => { try { return localStorage.getItem(INTERNAL_KEY) === '1' } catch { return false } }

/**
 * Load gtag.js and configure GA4 once. Safe to call unconditionally at boot —
 * it self-guards on the env var and on double-invocation.
 */
export function initAnalytics() {
  if (!GA_ID || started || typeof document === 'undefined') return
  started = true

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  // gtag must forward `arguments` verbatim to the dataLayer, so keep it a
  // classic function (not an arrow) — this is GA's canonical snippet.
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag
  gtag('js', new Date())
  // send_page_view:false — this is an SPA. We fire page_view manually on each
  // route change (see trackPageview) so the per-route <title> settles first and
  // the initial load isn't double-counted.
  if (readInternal()) gtag('set', { traffic_type: 'internal' })
  gtag('config', GA_ID, { send_page_view: false })
}

const live = () => !!GA_ID && typeof window !== 'undefined' && typeof window.gtag === 'function'

/**
 * Describe the signed-in account (or its absence) to GA4. Only ids and categories —
 * never a name, email or phone (Google's terms forbid PII, and it is not ours to send).
 * user_id is the Supabase auth uuid, so one person counts once across devices.
 * @param {{userId?:string|null, role?:string, team?:string|null, linkedPlayer?:boolean, internal?:boolean}} a
 */
export function identifyUser({ userId = null, role = 'guest', team = null, linkedPlayer = false, internal = false } = {}) {
  try {
    if (internal) localStorage.setItem(INTERNAL_KEY, '1')
    else if (userId) localStorage.removeItem(INTERNAL_KEY) // signed in as a plain account
  } catch { /* storage blocked */ }
  if (!live()) return
  const isInternal = internal || (!userId && readInternal())
  // null clears a value set earlier in this page (sign-out, or switching to a plain account).
  window.gtag('set', { user_id: userId || null, traffic_type: isInternal ? 'internal' : null })
  window.gtag('set', 'user_properties', {
    user_role: role,
    signed_in: userId ? 'yes' : 'no',
    linked_player: linkedPlayer ? 'yes' : 'no',
    user_team: team || '(none)',
  })
}

/**
 * A meaningful action, as a GA4 event. Keep params to ids, types and small counts.
 * @param {string} name snake_case, e.g. 'follow', 'game_availability'
 * @param {object} [params]
 */
export function trackEvent(name, params = {}) {
  if (!live()) return
  try { window.gtag('event', name, params) } catch { /* never throw into the caller */ }
}

/**
 * Tag a link we hand out so GA4 knows where the visit came from. WhatsApp strips
 * the referrer, so untagged shares all landed in "Direct".
 * @param {string} url absolute URL
 * @param {{source:string, medium?:string, campaign?:string}} utm
 */
export function withUtm(url, { source, medium = 'share', campaign } = {}) {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', source)
    u.searchParams.set('utm_medium', medium)
    if (campaign) u.searchParams.set('utm_campaign', campaign)
    return u.toString()
  } catch { return url }
}

/**
 * Report a virtual pageview for SPA navigation. No-op until initAnalytics() has
 * run and the tag is live.
 * @param {string} path e.g. '/players/abc-123'
 */
export function trackPageview(path) {
  if (!GA_ID || typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  })
}
