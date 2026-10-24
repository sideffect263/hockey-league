import { supabase } from './supabase'
import { listenTopic } from './realtimeTopics'

/**
 * The director's control room state for one game (table game_broadcast) and the
 * per-camera admin actions on game_videos. Reads are public — viewers follow the camera
 * on air and the overlay settings live; every write is admin-only (RLS + the
 * game_videos_guard_hidden trigger). See supabase/game-broadcast.sql.
 */

export const BROADCAST_DEFAULTS = {
  program_camera_no: null,
  overlay_score: true,
  overlay_position: 'top-right',
  max_cameras: 4,
  streaming_locked: false,
  // Multi-view (2026-10-12): how extra cameras are shown with the program camera.
  layout: 'single',          // single | pip | side | grid
  layout_cameras: [],        // camera_no of the extras, in order (max 3)
  // Auto-director (2026-10-12): phones with "מעקב אוטומטי" report their player count; the
  // server cuts to the camera with the play, `auto_delay_s` behind real time (≈ stream lag).
  auto_director: false,
  auto_delay_s: 15,
  auto_cameras: [],          // which cameras take part; empty = every approved one reporting
}

// How many extra cameras each layout shows next to the program camera.
export const LAYOUT_SLOTS = { single: 0, pip: 1, side: 1, grid: 3 }

const COLS = 'game_id, program_camera_no, overlay_score, overlay_position, max_cameras, streaming_locked, layout, layout_cameras, auto_director, auto_delay_s, auto_cameras, updated_at'

// A game's settings, or the defaults when the director never touched them.
export async function getBroadcast(gameId) {
  if (!gameId) return { ...BROADCAST_DEFAULTS }
  const { data, error } = await supabase.from('game_broadcast').select(COLS).eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return { ...BROADCAST_DEFAULTS, ...(data || {}) }
}

// Realtime: cb(settings) on every change, so viewers switch cameras / overlay at once.
// Broadcast topic bcast:<game> (supabase/realtime-broadcast.sql) carries the row, or a ping
// for test games — refetch through RLS then.
export function subscribeBroadcast(gameId, cb) {
  if (!gameId) return () => {}
  const refetch = () => getBroadcast(gameId).then(cb).catch(() => {})
  return listenTopic(`bcast:${gameId}`, 'settings',
    (p) => ('row' in p ? cb({ ...BROADCAST_DEFAULTS, ...(p.row || {}) }) : refetch()), refetch)
}

// Admin: change some settings (creates the row on first use).
export async function saveBroadcast(gameId, patch) {
  const { data, error } = await supabase
    .from('game_broadcast')
    .upsert({ game_id: gameId, ...patch }, { onConflict: 'game_id' })
    .select(COLS)
    .single()
  if (error) throw error
  return { ...BROADCAST_DEFAULTS, ...data }
}

// Admin: approve (visible to everyone) or hide a camera — all its parts at once.
export async function setCameraHidden(gameId, cameraNo, hidden) {
  const { data, error } = await supabase
    .from('game_videos').update({ hidden }).eq('game_id', gameId).eq('camera_no', cameraNo).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('העדכון נחסם — אין הרשאה')
}

// Admin: rename a camera ("מאחורי השער"). Empty = back to "מצלמה N".
export async function renameCamera(gameId, cameraNo, label) {
  const camera_label = String(label || '').trim().slice(0, 40) || null
  const { data, error } = await supabase
    .from('game_videos').update({ camera_label }).eq('game_id', gameId).eq('camera_no', cameraNo).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('העדכון נחסם — אין הרשאה')
}

// Admin: who streams each camera of a game — { [camera_no]: display name } — so the
// director knows whose camera they're approving (phase 3: any signed-in fan can stream).
export async function getCameraStreamers(gameId) {
  const { data: rows, error } = await supabase
    .from('game_videos').select('camera_no, created_by').eq('game_id', gameId).not('camera_no', 'is', null)
  if (error) throw error
  const ids = [...new Set((rows || []).map(r => r.created_by).filter(Boolean))]
  if (!ids.length) return {}
  const { data: profiles, error: e2 } = await supabase.from('profiles').select('id, display_name').in('id', ids)
  if (e2) throw e2
  const nameOf = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name]))
  const out = {}
  for (const r of rows || []) if (r.created_by && out[r.camera_no] == null) out[r.camera_no] = nameOf[r.created_by] || null
  return out
}

// Admin: fans' requests to stream this game (supabase/stream-requests.sql). A fan's "שדר"
// in the app files one and is refused; nothing exists on Cloudflare until it's approved.
// Newest first, with the requester's display name.
export async function getStreamRequests(gameId) {
  const { data: rows, error } = await supabase.from('stream_requests')
    .select('id, user_id, camera_label, status, attempts, created_at, updated_at')
    .eq('game_id', gameId).order('updated_at', { ascending: false })
  if (error) throw error
  const ids = [...new Set((rows || []).map(r => r.user_id))]
  if (!ids.length) return []
  const { data: profiles } = await supabase.from('profiles').select('id, display_name').in('id', ids)
  const nameOf = Object.fromEntries((profiles || []).map(p => [p.id, p.display_name]))
  return (rows || []).map(r => ({ ...r, name: nameOf[r.user_id] || null }))
}

export async function decideStreamRequest(id, approve) {
  const { error } = await supabase.rpc('decide_stream_request', { p_id: id, p_approve: approve })
  if (error) throw error
}

// Admin: remove a request completely. Pressing "שדר" again files a new one.
export async function deleteStreamRequest(id) {
  const { error } = await supabase.rpc('delete_stream_request', { p_id: id })
  if (error) throw error
}

// Admin: the player count each camera reported in the last few seconds — { [camera_no]: n }
// (auto-director). Cameras that stopped reporting are left out.
export async function getCameraActivity(gameId) {
  const since = new Date(Date.now() - 5000).toISOString()
  const { data, error } = await supabase
    .from('game_camera_activity').select('camera_no, players, at')
    .eq('game_id', gameId).gte('at', since).order('at', { ascending: false })
  if (error) throw error
  const out = {}
  for (const r of data || []) if (out[r.camera_no] == null) out[r.camera_no] = r.players
  return out
}
