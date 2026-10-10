import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Game video (YouTube) attach + marker timeline. Embed-only: no Data API, no
 * upload, no quota. A live broadcast and its eventual VOD are ONE row (YouTube
 * keeps the same video id), so "is it live now?" is derived from game status by
 * the caller, not stored here. See docs/VIDEO-HIGHLIGHTS-SPEC.md.
 *
 * Reads are public (anon SELECT). Writes are RLS-gated: attaching a video runs
 * through can_stream_game() (admin ∪ content-editor ∪ judge ∪ coach-of-a-team);
 * markers are editor/admin only.
 */

// Parse a YouTube id from any common URL shape (watch?v=, youtu.be/, embed/,
// shorts/, live/) or accept a bare id. Returns null if it can't find one.
export function parseYouTubeId(input) {
  const s = (input || '').trim()
  if (!s) return null
  if (/^[\w-]{6,32}$/.test(s) && !s.includes('/')) return s
  const m = s.match(/(?:[?&]v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([\w-]{6,32})/)
  return m ? m[1] : null
}

// Seconds → "m:ss" / "h:mm:ss" for marker labels (renders LTR in the RTL UI).
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

const VIDEO_COLS = 'id, provider, video_id, cf_customer_code, ingest, cf_live_input, title, kind, clock_offset_seconds, is_primary, created_at, camera_no, camera_label'

// Every video of a game, oldest first, each with its markers. A game can have several:
// the streamer stopped and restarted, or the connection dropped long enough for
// Cloudflare to start a new recording — the game page shows them as חלק 1, חלק 2…
// Public read — safe for anon spectators.
export async function getGameVideos(gameId) {
  if (!gameId) return []
  const { data: videos, error } = await supabase
    .from('game_videos')
    .select(VIDEO_COLS)
    .eq('game_id', gameId)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!videos?.length) return []
  const { data: markers, error: e2 } = await supabase
    .from('game_video_markers')
    .select('id, video_ref, video_seconds, kind, label, player_id, team_id, source')
    .in('video_ref', videos.map(v => v.id))
    .order('video_seconds', { ascending: true })
  if (e2) throw e2
  return videos.map(v => ({ ...v, markers: (markers || []).filter(m => m.video_ref === v.id) }))
}

// A row still pointing at its Cloudflare live input = a broadcast that's on air (or just
// ended and not yet swapped to its recording). WebRTC rows never swap; they're "live"
// while their kind says so.
export const isLiveRow = (v) =>
  v?.kind === 'live' || (!!v?.cf_live_input && v.video_id === v.cf_live_input)

// A game's videos grouped into CAMERAS (angles), each holding its parts in recording
// order. A camera = one streamer's broadcasts in this game: stream-golive gives every
// streamer a camera_no per game, and the same person restarting keeps it (so a dropped
// and restarted phone is חלק 2 of the same camera, not a new angle). A video without a
// camera_no (an uploaded full game) is a camera of its own, labelled by its title.
// Order: numbered cameras first, then by first recording. Mirrored in both apps.
export function groupCameras(videos) {
  const byKey = new Map()
  for (const v of videos || []) {
    const key = v.camera_no != null ? `n${v.camera_no}` : `v${v.id}`
    if (!byKey.has(key)) byKey.set(key, { key, no: v.camera_no ?? null, label: null, parts: [] })
    const cam = byKey.get(key)
    cam.parts.push(v)
    cam.label = cam.label || v.camera_label || null
  }
  const cams = [...byKey.values()].sort((a, b) =>
    (a.no ?? Infinity) - (b.no ?? Infinity) ||
    String(a.parts[0].created_at).localeCompare(String(b.parts[0].created_at)))
  cams.forEach((c, i) => {
    c.live = c.parts.some(isLiveRow)
    if (!c.label) c.label = (c.no == null && c.parts[0].title) || `מצלמה ${c.no ?? i + 1}`
  })
  return cams
}

// A game's primary video (the newest) + its markers, or null. Kept for callers that
// only ever show one video.
export async function getGameVideo(gameId) {
  const all = await getGameVideos(gameId)
  return all.length ? all[all.length - 1] : null
}

// Every recorded game video across the league, newest first, for the /media page —
// joined to its game and teams. Live rows are excluded (nothing to replay yet).
export async function getAllGameVideos({ limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('game_videos')
    .select(`${VIDEO_COLS}, game:games!inner(id, slug, game_date, status, game_type, home_score, away_score, home_team_id, away_team_id, is_test)`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []).filter(v => !isLiveRow(v) || v.game?.status === 'in_progress')
}

// Poster image for a video card.
export function videoThumb(v) {
  if (v.provider === 'cloudflare' && v.cf_customer_code) {
    return `https://customer-${v.cf_customer_code}.cloudflarestream.com/${v.video_id}/thumbnails/thumbnail.jpg?time=10s&height=360`
  }
  if (v.provider === 'youtube') return `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`
  return null
}

// Editor/streamer: attach a video to a game. `kind` is 'live' while the game is
// in progress; it becomes the VOD replay unchanged after the game ends. Returns
// the new row; throws a Hebrew message on a bad URL or an RLS refusal.
export async function attachVideo(gameId, { url, kind = 'full', offset = 0 } = {}) {
  const video_id = parseYouTubeId(url)
  if (!video_id) throw new Error('קישור YouTube לא תקין')
  const user = await sessionUser()
  if (!user) throw new Error('יש להתחבר')
  const { data, error } = await supabase
    .from('game_videos')
    .insert({ game_id: gameId, video_id, kind, clock_offset_seconds: offset, created_by: user.id })
    .select('id, video_id, kind')
    .single()
  if (error) throw error
  return data
}

// Viewer: fetch ICE servers (Cloudflare STUN + short-lived TURN) for WHEP
// playback. Anon-callable (spectators aren't signed in). TURN is what lets a
// viewer on a strict/mobile network watch the WebRTC-only live stream; falls
// back to STUN-only if the endpoint is unreachable.
//
// Detailed variant: reports WHY it came back empty. A silent null here degrades
// the player to STUN-only, which is invisible on a permissive network and fatal
// on a strict one — so the reason has to survive, not get swallowed.
export async function getViewerIceServersDetailed() {
  const t0 = performance.now()
  const ms = () => Math.round(performance.now() - t0)
  try {
    const { data, error } = await supabase.functions.invoke('turn-creds', { body: {} })
    if (error) return { iceServers: null, error: error.message || String(error), ms: ms() }
    const iceServers = data?.iceServers || null
    return { iceServers, error: iceServers ? null : 'turn-creds returned no iceServers', ms: ms() }
  } catch (e) {
    // Thrown here = blocked before it left the device: ad-blocker, captive
    // portal, corporate proxy or DNS failure on the Supabase host.
    return { iceServers: null, error: String(e?.message || e), ms: ms() }
  }
}

// An app (RTMP) broadcast's row points at the live input until the recording is
// ready; this asks the server to swap it over. Anon-callable and idempotent — any
// viewer's page can trigger it, so the replay appears even if the streamer's app died.
// Returns { state: 'live' | 'processing' | 'ready' | 'none' | 'skip' }.
export async function requestReplay(videoRowId) {
  try {
    const { data, error } = await supabase.functions.invoke('stream-replay', { body: { videoRowId } })
    if (error) return { state: 'error' }
    return data || { state: 'error' }
  } catch {
    return { state: 'error' }
  }
}

// Is a Cloudflare live input on air right now? Cloudflare's public, CORS-open lifecycle
// endpoint — no edge-function hop. true / false, or null when it couldn't be asked.
export async function cfInputIsLive(customerCode, inputId) {
  try {
    const r = await fetch(`https://customer-${customerCode}.cloudflarestream.com/${inputId}/lifecycle`, { cache: 'no-store' })
    if (!r.ok) return null
    return !!(await r.json())?.live
  } catch {
    return null
  }
}

export async function getViewerIceServers() {
  return (await getViewerIceServersDetailed()).iceServers
}

// Editor/streamer: remove a video (and its markers, via FK cascade). Selects the
// row back so a silently-refused delete (RLS → 0 rows) surfaces as an error.
export async function detachVideo(id) {
  const { data, error } = await supabase.from('game_videos').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('המחיקה נחסמה — אין הרשאה')
}

// Editor: add a marker. video_seconds comes from player.getCurrentTime().
export async function addMarker(videoRef, { videoSeconds, kind, label = null, playerId = null, teamId = null } = {}) {
  const user = await sessionUser()
  const { data, error } = await supabase
    .from('game_video_markers')
    .insert({
      video_ref: videoRef,
      video_seconds: Math.max(0, Math.round(videoSeconds || 0)),
      kind,
      label: label ? String(label).slice(0, 120) : null,
      player_id: playerId,
      team_id: teamId,
      source: 'manual',
      created_by: user?.id ?? null,
    })
    .select('id, video_seconds, kind, label, player_id, team_id, source')
    .single()
  if (error) throw error
  return data
}

// Editor: delete a marker. Selects back so an RLS refusal surfaces.
export async function deleteMarker(id) {
  const { data, error } = await supabase.from('game_video_markers').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('המחיקה נחסמה — אין הרשאה')
}

// Realtime: a spectator already on /games/:id should see a video pop in the
// moment the streamer goes live, without reloading. Invokes cb() on any change
// to this game's videos; caller re-fetches via getGameVideo. No-op-safe if
// Realtime is unreachable. Mirrors subscribeLiveGame in lib/live.js.
export function subscribeGameVideo(gameId, cb) {
  if (!gameId) return () => {}
  const channel = supabase
    .channel(`game_video:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_videos', filter: `game_id=eq.${gameId}` },
      () => cb(),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
