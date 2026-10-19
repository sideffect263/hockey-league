import { supabase } from './supabase'

/**
 * The /admin "התראות" tracker: who got which notification, when, and on which device.
 * Backed by supabase/notification-tracker.sql — `notifications` gives the who/when,
 * `push_deliveries` (written by send-push, one row per device tried) the device and
 * the outcome. Both RPCs are admin-only.
 */

/** Notifications since `since`, newest first, each with `deliveries: [...]`. */
export async function getNotificationLog(since, limit = 2000) {
  const { data, error } = await supabase.rpc('admin_notification_log', {
    p_since: since.toISOString(), p_limit: limit,
  })
  if (error) throw error
  return data || []
}

/** Every registered push device, with sent/failed counts since `since`. */
export async function getPushDevices(since) {
  const { data, error } = await supabase.rpc('admin_push_devices', { p_since: since.toISOString() })
  if (error) throw error
  return data || []
}

/**
 * One outcome per notification, from its delivery rows:
 *   delivered — reached at least one device
 *   failed    — had devices, none accepted it
 *   no_device — nothing to push to (bell only, or the email fallback)
 *   skipped   — deliberately not pushed (market types)
 *   untracked — written before the delivery log existed
 */
export function outcomeOf(n) {
  const ds = n.deliveries || []
  if (!ds.length) return 'untracked'
  if (ds.some(d => d.status === 'sent')) return 'delivered'
  if (ds.some(d => d.status === 'failed' || d.status === 'pruned')) return 'failed'
  if (ds.some(d => d.status === 'skipped' && d.platform === 'none')) return 'skipped'
  return 'no_device'
}

/** "Chrome · Mac" out of a browser user agent; null when there is none. */
export function describeUserAgent(ua) {
  if (!ua) return null
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'דפדפן'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null
  return os ? `${browser} · ${os}` : browser
}

/** Short device name for a delivery row or a push_subscriptions row. */
export function deviceLabel(d) {
  if (d.platform === 'ios') return `iPhone${d.app_version_name ? ` ${d.app_version_name}` : ''}`
  if (d.platform === 'android') return `Android${d.app_version_name ? ` ${d.app_version_name}` : ''}`
  if (d.platform === 'web') return describeUserAgent(d.user_agent) || 'דפדפן'
  if (d.platform === 'email') return 'מייל'
  return 'ללא מכשיר'
}
