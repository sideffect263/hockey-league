import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

/**
 * Who uses the native apps. There is no install event — an account counts as an
 * app user once the app has signed in with it (auth session user-agent, a native
 * push registration, or native telemetry). See supabase/app-users.sql.
 */

/** Every account, one row each, with its app/web footprint. Admin-only RPC. */
export async function getAppUsers() {
  const { data, error } = await supabase.rpc('admin_app_users')
  if (error) throw error
  return data || []
}

const cacheKey = (uid) => `rh_app_platforms:${uid}`

/**
 * The signed-in user's own app platforms (['ios'], ['android'], [] …), or null
 * while unknown. Cached per user for the tab's life so the feed's "download the
 * app" prompts don't flash in and out on every navigation. A failed lookup stays
 * null — callers treat null as "don't know", i.e. keep showing the prompt.
 */
export function useMyAppPlatforms() {
  const { user } = useAuth()
  const uid = user?.id
  const [platforms, setPlatforms] = useState(() => {
    if (!uid) return null
    try { return JSON.parse(sessionStorage.getItem(cacheKey(uid)) || 'null') } catch { return null }
  })

  useEffect(() => {
    if (!uid) { setPlatforms(null); return }
    let alive = true
    supabase.rpc('my_app_platforms').then(({ data, error }) => {
      if (!alive || error || !Array.isArray(data)) return
      setPlatforms(data)
      try { sessionStorage.setItem(cacheKey(uid), JSON.stringify(data)) } catch { /* private mode */ }
    })
    return () => { alive = false }
  }, [uid])

  return platforms
}

/** True only when we KNOW this user already has the app. */
export function useHasNativeApp() {
  const platforms = useMyAppPlatforms()
  return Array.isArray(platforms) && platforms.length > 0
}

/**
 * Fold one account into another (admin-only, see supabase/admin-merge-accounts.sql).
 * Returns { kept, deleted, player_id, rows, lost_email_login }. Irreversible.
 */
export async function mergeAccounts(keepId, dropId) {
  const { data, error } = await supabase.rpc('admin_merge_accounts', { p_keep: keepId, p_drop: dropId })
  if (error) {
    const m = error.message || ''
    if (/different player cards/i.test(m)) throw new Error('שני החשבונות מקושרים לכרטיסי שחקן שונים — לא מאחדים אוטומטית.')
    if (/admin account/i.test(m)) throw new Error('לא ניתן למחוק חשבון של מנהל.')
    if (/not authorized/i.test(m)) throw new Error('אין הרשאה.')
    throw new Error('האיחוד נכשל: ' + m)
  }
  return data
}

/**
 * Google Play closed-test candidates: accounts that use the Android app AND have a
 * Google address (play_email = the one to paste into Play Console). Admin-only RPC,
 * see supabase/android-testers.sql.
 */
export async function getAndroidTesters() {
  const { data, error } = await supabase.rpc('admin_android_testers')
  if (error) throw error
  return data || []
}

/**
 * Per-user Android health from telemetry (last activity, version, device, installer,
 * active days in Play's 14-day window, startup crashes on that device model) + a phone
 * to reach them. Admin-only RPC, see supabase/android-tester-health.sql.
 */
export async function getAndroidTesterHealth() {
  const { data, error } = await supabase.rpc('admin_android_tester_health')
  if (error) throw error
  return data || []
}

/** The hand-kept tester flags (on Play list / in WhatsApp group / opted in / note), by email. */
export async function getAndroidTesterStatus() {
  const { data, error } = await supabase
    .from('android_tester_status')
    .select('email, on_play_list, in_group, opted_in, note, updated_at')
  if (error) throw error
  return data || []
}

/** Upsert one tester's flags; fields left undefined stay as they are. */
export async function setAndroidTesterStatus(email, { onPlayList, inGroup, optedIn, note } = {}) {
  const { data, error } = await supabase.rpc('admin_set_android_tester_status', {
    p_email: email,
    p_on_play_list: onPlayList ?? null,
    p_in_group: inGroup ?? null,
    p_opted_in: optedIn ?? null,
    p_note: note ?? null,
  })
  if (error) throw error
  return data
}

/** The Android build the site serves (league_settings, public). */
export async function getAndroidLatestVersion() {
  const { data, error } = await supabase
    .from('league_settings')
    .select('key, value')
    .in('key', ['android_latest_version', 'android_latest_name'])
  if (error) throw error
  const m = Object.fromEntries((data || []).map(r => [r.key, r.value]))
  return { code: Number(m.android_latest_version) || null, name: m.android_latest_name || null }
}
