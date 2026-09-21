import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { supabase } from './supabase'

/**
 * "עריכה חיה" — an admin standing anywhere in the app describes a UI bug and a
 * cloud agent fixes it. The agent never sees the screen, so everything it has to
 * go on is assembled here: the route, the rendered text of the element the admin
 * pointed at (which is what actually locates the file), and whatever the console
 * was complaining about at the time.
 *
 * The payload shape is a contract with /api/live-edit — keys and types are fixed.
 */

const MAX_TEXT = 200      // rendered text, per the payload contract
const MAX_ERRORS = 5
const MAX_ERROR_LEN = 300 // one runaway stack shouldn't crowd out the other four

// ─── Console error ring buffer ──────────────────────────────────────────────

const recentErrors = []

function remember(message) {
  if (!message) return
  recentErrors.push(String(message).slice(0, MAX_ERROR_LEN))
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift()
}

// console.error is handed anything at all — Errors, React elements, circular
// objects — and none of it may throw on the way to a string.
function asText(value) {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (typeof value === 'string') return value
    return JSON.stringify(value) ?? String(value)
  } catch {
    try { return String(value) } catch { return '[unprintable]' }
  }
}

let installed = false

function installErrorCapture() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const original = console.error
  console.error = function (...args) {
    // The app's own logging runs first and unconditionally: a fault in our
    // bookkeeping must never be the reason an error stops reaching the console.
    try {
      original.apply(console, args)
    } finally {
      try { remember(args.map(asText).join(' ')) } catch { /* recording is best-effort */ }
    }
  }

  // addEventListener rather than `window.onerror = ...`: assigning would silently
  // replace whatever handler is already there (today: none, tomorrow: anyone's).
  window.addEventListener('error', (e) => {
    try {
      const where = e?.filename ? ` (${e.filename}:${e.lineno})` : ''
      remember(e?.message ? `${e.message}${where}` : 'Unknown window error')
    } catch { /* never throw from an error handler */ }
  })

  // A failed data fetch usually surfaces here rather than as a thrown error, and
  // it is exactly the kind of thing that explains a broken-looking page.
  window.addEventListener('unhandledrejection', (e) => {
    try { remember(`Unhandled rejection: ${asText(e?.reason)}`) } catch { /* as above */ }
  })
}

installErrorCapture()

// ─── Element description ────────────────────────────────────────────────────

const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim()

// SVG elements carry an SVGAnimatedString in .className, so read the attribute.
const classOf = (el) => collapse(el?.getAttribute?.('class') || '')

/**
 * A short, human-readable CSS path. Deliberately not a unique selector: the app
 * is Tailwind, so a full class list is forty utilities of noise and half of them
 * (`hover:`, `sm:`, `w-[3px]`) aren't even valid unescaped. Two plain classes per
 * level, five levels, and an id ends the climb because it already pins the node.
 */
function selectorFor(el) {
  const parts = []
  let node = el

  while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
    if (node.id) { parts.unshift(`#${node.id}`); break }

    let part = node.tagName.toLowerCase()
    const classes = classOf(node).split(' ').filter(c => /^[a-zA-Z][\w-]*$/.test(c)).slice(0, 2)
    if (classes.length) part += `.${classes.join('.')}`

    const twins = node.parentElement
      ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName)
      : []
    if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`

    parts.unshift(part)
    node = node.parentElement
  }

  return parts.join(' > ')
}

/**
 * Snapshot of the picked element, taken at pick time rather than at send time —
 * the admin types for a while and a live page can re-render the node out from
 * under us. Returns the four element fields of the payload.
 */
export function describeElement(el) {
  if (!el) return null
  return {
    text: collapse(el.innerText || el.textContent).slice(0, MAX_TEXT),
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    classes: classOf(el),
  }
}

// ─── Payload ────────────────────────────────────────────────────────────────

export function buildPayload({ request, picked }) {
  return {
    route: window.location.pathname + window.location.search,
    request: (request || '').trim(),
    text: picked?.text || '',
    selector: picked?.selector || '',
    tag: picked?.tag || '',
    classes: picked?.classes || '',
    viewport: { w: window.innerWidth, h: window.innerHeight },
    // Read off the DOM, not the theme context: /market re-skins <html> too, and
    // what matters to the fixer is which stylesheet branch the admin is looking at.
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    errors: recentErrors.slice(-MAX_ERRORS),
  }
}

// ─── Submit ─────────────────────────────────────────────────────────────────

const REASONS = {
  'not-configured': "הפיצ'ר עדיין לא מחובר",
  forbidden: 'אין לך הרשאה',
  busy: 'יש כבר בקשה שרצה, נסו בעוד רגע',
}

export const reasonText = (reason) => REASONS[reason] || 'השליחה נכשלה. נסו שוב בעוד רגע'

/**
 * POST the payload and always resolve to the endpoint's own { ok, ... } shape —
 * the caller renders one thing either way, so a dead network or Vercel's HTML
 * 404 page has to arrive as a `reason` rather than as a thrown exception.
 *
 * The access token rides along because this fires a paid agent; the endpoint
 * re-checks admin server-side (the client flag proves nothing).
 */
export async function submitLiveEdit(payload) {
  let token = null
  try {
    const { data } = await supabase.auth.getSession()
    token = data?.session?.access_token || null
  } catch { /* unauthenticated is the endpoint's call to make, not ours */ }

  let res
  try {
    res = await fetch('/api/live-edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, reason: 'network' }
  }

  let body = null
  try { body = await res.json() } catch { /* not JSON — handled below */ }
  if (body && typeof body.ok === 'boolean') return body

  // An answer that isn't JSON means nothing is listening on the route: Vercel's
  // own 404, or (in dev) the SPA fallback handing back index.html with a 200.
  // Either way "not wired up" is exactly what the admin needs to be told.
  return { ok: false, reason: res.ok || res.status === 404 ? 'not-configured' : `http-${res.status}` }
}

// ─── Run status ─────────────────────────────────────────────────────────────
/**
 * The other half of the round trip. A request takes minutes (agent → push → CI
 * deploy), so GET /api/live-edit answers with what became of it:
 *   ?number=N  → { ok: true, items: [item] }   (0 or 1)
 *   no params  → { ok: true, items: [...20] }
 *
 * item = { number, title, request, route, createdAt, closedAt, stage, summary,
 *          commit: { sha, shortSha, url, files, additions, deletions,
 *                    changedFiles[] } | null,
 *          ci: { status, conclusion, url } | null }
 */

const LADDER = ['queued', 'working', 'pushed', 'deploying', 'done']

// What the admin sees on the ladder. 'done' closes it; 'failed' and 'refused'
// never appear as steps — a run that ends in either did NOT reach מוכן, and
// drawing it on the ladder would be the lie this whole view exists to prevent.
export const STAGE_STEPS = [
  { stage: 'queued', label: 'נשלח' },
  { stage: 'working', label: 'הסוכן עובד' },
  { stage: 'pushed', label: 'הקוד נדחף' },
  { stage: 'deploying', label: 'נפרס' },
  { stage: 'done', label: 'מוכן' },
]

const TERMINAL = new Set(['done', 'failed', 'refused'])

/** Nothing more will happen — polling stops here. */
export const isTerminalStage = (stage) => TERMINAL.has(stage)

// -1 for anything we don't recognise, including a stage the server grows later.
// Callers render that as "לא ידוע" rather than guessing a position.
export const stageIndex = (stage) => LADDER.indexOf(stage)

const STAGE_LABELS = {
  queued: 'נשלח',
  working: 'הסוכן עובד',
  pushed: 'הקוד נדחף',
  deploying: 'נפרס',
  done: 'מוכן',
  failed: 'נכשל',
  refused: 'לא בוצע',
}

export const stageLabel = (stage) => STAGE_LABELS[stage] || 'לא ידוע'

const STAGE_BADGES = {
  done: 'badge-success',
  failed: 'badge-danger',
  refused: 'badge-warning',
  queued: 'badge-neutral',
  working: 'badge-info',
  pushed: 'badge-info',
  deploying: 'badge-info',
}

export const stageBadge = (stage) => STAGE_BADGES[stage] || 'badge-neutral'

// ─── Reading ────────────────────────────────────────────────────────────────

// The bearer token both directions: reading a run says who is asking, and the
// endpoint re-checks admin server-side exactly as it does on POST.
async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) return { Authorization: `Bearer ${token}` }
  } catch { /* unauthenticated is the endpoint's call to make, not ours */ }
  return {}
}

/**
 * Same discipline as submitLiveEdit: never throws, always resolves to the
 * endpoint's own { ok, ... } shape. Until the GET half is deployed the SPA
 * fallback answers with index.html and a 200 — which isn't JSON, and means
 * "nothing is listening", not "no runs".
 */
async function getRuns(query) {
  let res
  try {
    res = await fetch(`/api/live-edit${query}`, { headers: await authHeaders() })
  } catch {
    return { ok: false, reason: 'network' }
  }

  let body = null
  try { body = await res.json() } catch { /* not JSON — handled below */ }
  if (body && typeof body.ok === 'boolean') return body

  return { ok: false, reason: res.ok || res.status === 404 ? 'not-configured' : `http-${res.status}` }
}

/** One run. Resolves to { ok: true, item } or { ok: false, reason }. */
export async function fetchLiveEditRun(number) {
  const n = Number(number)
  if (!Number.isFinite(n)) return { ok: false, reason: 'not-found' }

  const body = await getRuns(`?number=${encodeURIComponent(n)}`)
  if (!body.ok) return body

  const item = Array.isArray(body.items) ? body.items[0] : null
  return item ? { ok: true, item } : { ok: false, reason: 'not-found' }
}

/** The 20 newest. Resolves to { ok: true, items } or { ok: false, reason }. */
export async function fetchLiveEditHistory() {
  const body = await getRuns('')
  if (!body.ok) return body
  return { ok: true, items: Array.isArray(body.items) ? body.items : [] }
}

const LOAD_REASONS = {
  'not-configured': "מעקב הבקשות עדיין לא מחובר",
  unauthorized: 'צריך להתחבר מחדש',
  forbidden: 'אין לך הרשאה',
  'not-found': 'הבקשה לא נמצאה',
  network: 'אין חיבור לשרת',
}

export const loadReasonText = (reason) => LOAD_REASONS[reason] || 'לא הצלחנו לטעון את המצב'

// ─── Item helpers ───────────────────────────────────────────────────────────

/**
 * The item carries no issue URL, so derive it from a sibling GitHub link when
 * there is one — the repo is whatever the server is actually filing into, which
 * beats hardcoding it here. No link rather than a guessed one.
 */
export function issueUrl(item) {
  if (!item) return null
  if (typeof item.issueUrl === 'string') return item.issueUrl

  const sibling = item.commit?.url || item.ci?.url || ''
  const repo = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\//.exec(sibling)
  return repo && Number.isFinite(Number(item.number)) ? `${repo[1]}/issues/${item.number}` : null
}

/**
 * changedFiles entries may be bare paths or GitHub-shaped objects; both have to
 * render. Anything else is dropped rather than printed as "[object Object]".
 */
export function changedFiles(commit) {
  const list = Array.isArray(commit?.changedFiles) ? commit.changedFiles : []
  return list
    .map((f) => {
      if (typeof f === 'string') return { path: f, additions: null, deletions: null }
      const path = f?.filename || f?.path || f?.name
      if (typeof path !== 'string' || !path) return null
      const add = Number(f?.additions)
      const del = Number(f?.deletions)
      return {
        path,
        additions: Number.isFinite(add) ? add : null,
        deletions: Number.isFinite(del) ? del : null,
      }
    })
    .filter(Boolean)
}

/** mm:ss, for an elapsed count the admin watches tick. */
export function elapsedText(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** In-app navigation only — a route from the server is never allowed off-site. */
export const safeRoute = (route) =>
  typeof route === 'string' && /^\/(?!\/)/.test(route) ? route : null

/** "לפני 3 שעות". Same helper the bell and the chat use, same locale. */
export function relativeTime(iso) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: he }) }
  catch { return '' }
}

// ─── Promote & undo ─────────────────────────────────────────────────────────
/**
 * The last mile. `dev` is where edits land and where they are safe to look at;
 * these two are the only ways an admin moves anything after that.
 *
 *   promote — ship everything sitting on `dev` to the league's site
 *   undo    — put one change back the way it was, on `dev`
 *
 * Both are POSTs with consequences, so both follow submitLiveEdit's discipline
 * exactly: never throw, always resolve to the endpoint's own { ok, ... } shape.
 * A dead network must arrive as a `reason` the panel can say in Hebrew, because
 * a thrown exception here reads to the admin as "nothing happened" — and with a
 * promote in flight that is the one thing we cannot let them believe.
 */
async function call(path, init = {}) {
  let res
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(await authHeaders()),
      },
    })
  } catch {
    return { ok: false, reason: 'network' }
  }

  let body = null
  try { body = await res.json() } catch { /* not JSON — handled below */ }
  if (body && typeof body.ok === 'boolean') return body

  return { ok: false, reason: res.ok || res.status === 404 ? 'not-configured' : `http-${res.status}` }
}

/**
 * What is waiting to go public.
 * { ok: true, pending: [{sha, shortSha, message, ...}], count, lastPromotedAt,
 *   blockedFiles: [] }
 */
export const fetchPending = () => call('/api/live-edit-promote')

/** Ship it. { ok: true, merged, run, count, branch, deployTriggered, ... } */
export const promoteToLeague = () => call('/api/live-edit-promote', { method: 'POST' })

/** Undo one change on `dev`. { ok: true, sha, shortSha, reverted, files, url } */
export const undoLiveEdit = (sha) =>
  call('/api/live-edit-revert', { method: 'POST', body: JSON.stringify({ sha }) })

// Said in full sentences, because each one is the admin's whole explanation for why
// a button they pressed did not do the thing. "needs-human" and "changed-since" are
// not failures — they are the safety rules working, and they have to read that way
// rather than as something broken.
const PROMOTE_REASONS = {
  'nothing-to-promote': 'אין שינויים חדשים לשליחה — אתר הליגה כבר מעודכן',
  'needs-human': 'השינויים נוגעים בקבצים רגישים. צריך אישור ידני ב-GitHub',
  conflict: 'השינויים לא מתמזגים אוטומטית. צריך טיפול ידני ב-GitHub',
  'github-error': 'GitHub לא זמין כרגע. נסו שוב בעוד רגע',
  'wrong-environment': 'אפשר לשלוח רק מאתר הבדיקות',
  'not-configured': "השליחה לאתר הליגה עדיין לא מחוברת",
  forbidden: 'אין לך הרשאה',
  unauthorized: 'צריך להתחבר מחדש',
  network: 'אין חיבור לשרת',
}

export const promoteReasonText = (reason) =>
  PROMOTE_REASONS[reason] || 'השליחה נכשלה. נסו שוב בעוד רגע'

const UNDO_REASONS = {
  'changed-since': 'מאז השינוי הזה נערכו אותם קבצים שוב — ביטול ימחק גם את העריכה המאוחרת',
  'needs-human': 'השינוי נוגע בקבצים רגישים. צריך ביטול ידני ב-GitHub',
  'not-revertable': 'אי אפשר לבטל את השינוי הזה אוטומטית',
  'not-on-dev': 'השינוי כבר לא נמצא בענף הפיתוח',
  'nothing-to-undo': 'אין מה לבטל — הקוד כבר במצב הקודם',
  'too-large': 'השינוי גדול מדי לביטול אוטומטי',
  'too-far-behind': 'השינוי ישן מדי לביטול אוטומטי',
  moved: 'משהו נדחף לענף בזמן הביטול. נסו שוב',
  'not-found': 'השינוי לא נמצא',
  'bad-request': 'השינוי לא נמצא',
  'github-error': 'GitHub לא זמין כרגע. נסו שוב בעוד רגע',
  'wrong-environment': 'אפשר לבטל רק מאתר הבדיקות',
  'not-configured': 'הביטול עדיין לא מחובר',
  forbidden: 'אין לך הרשאה',
  unauthorized: 'צריך להתחבר מחדש',
  network: 'אין חיבור לשרת',
}

export const undoReasonText = (reason) => UNDO_REASONS[reason] || 'הביטול נכשל. נסו שוב בעוד רגע'
