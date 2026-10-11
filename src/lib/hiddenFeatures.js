// Hidden, switch-on-later features — the /admin "תכונות מוסתרות" tab.
// Contract: docs/HIDDEN-FEATURES-SPEC.md. Server: supabase/hidden-features.sql.
//
// The switches are plain league_settings rows (anon-readable, admin-writable by RLS).
// A MISSING key means OFF; the apps treat anything but 'on' as off.
import { supabase } from './supabase'

export const HIDDEN_KEYS = [
  'feature_review_prompt', 'review_prompt_min_opens',
  'feature_push_nudge', 'push_nudge_interval_days',
  'announcement',
]

export const DEFAULTS = { review_prompt_min_opens: 5, push_nudge_interval_days: 21 }

export async function getHiddenSettings() {
  const { data, error } = await supabase
    .from('league_settings').select('key, value, updated_at').in('key', HIDDEN_KEYS)
  if (error) throw error
  return Object.fromEntries((data || []).map(r => [r.key, r]))
}

// Upsert, then read back: an RLS-refused upsert can come back without an error.
export async function setHiddenSetting(key, value) {
  if (!HIDDEN_KEYS.includes(key)) throw new Error(`unknown key ${key}`)
  const v = String(value ?? '')
  const { error } = await supabase
    .from('league_settings')
    .upsert({ key, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
  const { data, error: e2 } = await supabase
    .from('league_settings').select('value').eq('key', key).maybeSingle()
  if (e2) throw e2
  if ((data?.value ?? null) !== v) throw new Error('השמירה לא נקלטה (אין הרשאה?)')
}

// ---- announcement JSON ------------------------------------------------------

/** Parse the stored value; null for empty / invalid JSON. */
export function parseAnnouncement(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const a = JSON.parse(value)
    return a && typeof a === 'object' && !Array.isArray(a) ? a : null
  } catch { return null }
}

/** "ff-tickets" + date → "ff-tickets-2026-10-11". Latin slug only (ids are device-local keys). */
export function suggestAnnouncementId(seed, date = new Date()) {
  const slug = String(seed || '')
    .toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  const day = date.toISOString().slice(0, 10)
  return `${slug || 'announcement'}-${day}`
}

/** Validate the editor form → { ok, errors[], json } (json = the canonical object to store). */
export function buildAnnouncement(f) {
  const errors = []
  const id = String(f.id || '').trim()
  const title = String(f.title || '').trim()
  const body = String(f.body || '').replace(/\r\n/g, '\n').trim()
  const label = String(f.button_label || '').trim()
  const url = String(f.button_url || '').trim()
  const audience = ['all', 'signed_in', 'signed_out'].includes(f.audience) ? f.audience : 'all'
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) errors.push('מזהה: 3–64 תווים, אותיות לטיניות/ספרות/מקף')
  if (!title) errors.push('חסרה כותרת')
  if (!body) errors.push('חסר תוכן')
  if (!!label !== !!url) errors.push('כפתור: גם טקסט וגם קישור, או אף אחד')
  if (url && !/^https?:\/\/\S+$/.test(url)) errors.push('קישור הכפתור חייב להתחיל ב-https://')
  const toIso = (v) => {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  const starts_at = toIso(f.starts_at)
  const ends_at = toIso(f.ends_at)
  if (starts_at === undefined || ends_at === undefined) errors.push('תאריך לא תקין')
  if (starts_at && ends_at && starts_at >= ends_at) errors.push('תאריך הסיום חייב להיות אחרי ההתחלה')

  const json = { id, active: f.active !== false, title, body, audience }
  if (label && url) { json.button_label = label; json.button_url = url }
  if (starts_at) json.starts_at = starts_at
  if (ends_at) json.ends_at = ends_at
  return { ok: errors.length === 0, errors, json }
}

// ---- admin broadcast push ------------------------------------------------------

/** Recipient count only — nothing is written. */
export async function countBroadcastRecipients({ title, body, href, audience }) {
  const { data, error } = await supabase.rpc('admin_broadcast_notification', {
    p_title: title, p_body: body, p_href: href || null, p_audience: audience, p_dry_run: true,
  })
  if (error) throw error
  return data
}

/** Sends for real: one bell row + push per recipient. Returns how many. */
export async function sendBroadcast({ title, body, href, audience }) {
  const { data, error } = await supabase.rpc('admin_broadcast_notification', {
    p_title: title, p_body: body, p_href: href || null, p_audience: audience, p_dry_run: false,
  })
  if (error) throw error
  return data
}

export async function getRecentBroadcasts(limit = 10) {
  const { data, error } = await supabase
    .from('admin_broadcasts')
    .select('id, title, body, href, audience, recipients, sent_email, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

const ERRORS = {
  rate_limited: 'אפשר לשלוח עד 3 התראות בשעה',
  bad_title: 'כותרת: 1–80 תווים',
  bad_body: 'תוכן: 1–500 תווים',
  bad_href: 'קישור חייב להיות נתיב באתר, למשל /games',
  bad_audience: 'קהל לא תקין',
  not_authorized: 'אין הרשאה',
}
export const broadcastError = (e) => ERRORS[e?.message] || e?.message || String(e)
