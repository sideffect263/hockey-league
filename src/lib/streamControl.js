import { supabase } from './supabase'

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
}

const COLS = 'game_id, program_camera_no, overlay_score, overlay_position, max_cameras, streaming_locked, updated_at'

// A game's settings, or the defaults when the director never touched them.
export async function getBroadcast(gameId) {
  if (!gameId) return { ...BROADCAST_DEFAULTS }
  const { data, error } = await supabase.from('game_broadcast').select(COLS).eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return { ...BROADCAST_DEFAULTS, ...(data || {}) }
}

// Realtime: cb(settings) on every change, so viewers switch cameras / overlay at once.
export function subscribeBroadcast(gameId, cb) {
  if (!gameId) return () => {}
  const channel = supabase
    .channel(`game_broadcast:${gameId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'game_broadcast', filter: `game_id=eq.${gameId}` },
      (payload) => cb({ ...BROADCAST_DEFAULTS, ...(payload.eventType === 'DELETE' ? {} : payload.new) }))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
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
