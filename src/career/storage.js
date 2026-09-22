/**
 * Saving and sharing a career.
 *
 * Because a career IS `{config, choices}` and nothing else (see engine.js),
 * both of these are almost trivial — a save is a few hundred bytes of JSON,
 * and a share link is that same JSON base64'd into a query string. No table,
 * no upload, no account needed to play or to send someone your career.
 *
 * Everything is wrapped in try/catch: localStorage throws outright in a
 * private window on some browsers, and a career that can't be saved should
 * still be playable.
 */

const SAVE_KEY = 'rinkhockey:career:v1'
const HALL_KEY = 'rinkhockey:career:hall:v1'
const MAX_HALL = 30

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function writeSave(config, choices) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ config, choices }))
  } catch {
    /* private mode — the career still plays, it just won't survive a reload */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch { /* ignore */ }
}

/** Finished careers, newest first. The local "hall of fame". */
export function loadHall() {
  try {
    const raw = localStorage.getItem(HALL_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addToHall(entry) {
  try {
    const hall = [entry, ...loadHall().filter((e) => e.seed !== entry.seed)].slice(0, MAX_HALL)
    localStorage.setItem(HALL_KEY, JSON.stringify(hall))
    return hall
  } catch {
    return loadHall()
  }
}

// ── Share links ───────────────────────────────────────────────────────────
// btoa() is Latin-1 only and our payload carries Hebrew names, so the string
// is UTF-8 encoded first. Without this, sharing a career whose player has a
// Hebrew surname throws.
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeShare(config, choices) {
  return toBase64Url(JSON.stringify({ c: config, k: choices }))
}

export function decodeShare(token) {
  try {
    const { c, k } = JSON.parse(fromBase64Url(token))
    if (!c?.seed || !Array.isArray(k)) return null
    return { config: c, choices: k }
  } catch {
    return null
  }
}

export function shareUrl(config, choices) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/career?c=${encodeShare(config, choices)}`
}
