import { supabase } from './supabase'

// סיפור המשחק — written stories for finished games (table game_stories; drafts come from the
// game-story routine, see scripts/game-story/ROUTINE.md). RLS: everyone reads PUBLISHED; content
// editors + admins read and edit all, and are the only ones who can publish.
//
// A story is an evidence-backed TIMELINE (game_stories.timeline, supabase/game-timeline.sql):
// beats, each citing game_events and game_media. `body` stays as plain paragraphs for SEO
// (api/seo.js) and is rebuilt from the beat texts whenever an editor saves the timeline.

const STORY_COLUMNS = 'game_id,status,title,summary,body,moments,hero_image_url,hero_media_id,media_post_ids,timeline,pending_revision,version,auto_published,generated_at,published_at,updated_at'
const GAME_EMBED = 'game:games(id,slug,game_date,home_score,away_score,home_team_id,away_team_id,home:teams!games_home_team_id_fkey(name,primary_color),away:teams!games_away_team_id_fkey(name,primary_color))'

/** The story for one game, or null. Visitors only ever get a published one (RLS). */
export async function getGameStory(gameId) {
  const { data, error } = await supabase.from('game_stories').select(STORY_COLUMNS).eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return data
}

/** Stories waiting for an editor: drafts, and live stories with a newer version pending. */
export async function getStoriesForReview() {
  const { data, error } = await supabase
    .from('game_stories')
    .select(`${STORY_COLUMNS},${GAME_EMBED}`)
    .or('status.eq.draft,pending_revision.not.is.null')
    .neq('status', 'rejected')
    .order('generated_at', { ascending: false })
  if (error) throw error
  return (data || []).sort((a, b) => String(b.game?.game_date || '').localeCompare(String(a.game?.game_date || '')))
}

/** Kept for older callers: drafts only. */
export async function getStoryDrafts() {
  return (await getStoriesForReview()).filter(s => s.status === 'draft')
}

/** How many stories need an editor (drafts + pending revisions). */
export async function countStoryDrafts() {
  const { count } = await supabase.from('game_stories').select('game_id', { count: 'exact', head: true })
    .or('status.eq.draft,pending_revision.not.is.null').neq('status', 'rejected')
  return count || 0
}

/** Plain-paragraph body from timeline beats (what crawlers and old clients read). */
export const bodyFromTimeline = (timeline) =>
  (Array.isArray(timeline) ? timeline : []).map(b => String(b?.text || '').trim()).filter(Boolean).join('\n\n')

/**
 * Edit + set status in one write ('draft' | 'published' | 'rejected'). Who/when is stamped
 * server-side. Passing `timeline` saves it and rebuilds `body` from the beat texts.
 */
export async function saveGameStory(gameId, { title, summary, body, timeline, status }) {
  const patch = { title, summary, ...(status ? { status } : {}) }
  if (Array.isArray(timeline)) {
    patch.timeline = timeline
    const rebuilt = bodyFromTimeline(timeline)
    patch.body = rebuilt || body
  } else if (body !== undefined) {
    patch.body = body
  }
  const { error } = await supabase.from('game_stories').update(patch).eq('game_id', gameId)
  if (error) throw error
}

/** Copy the pending revision over the live story (editors only; server checks). */
export async function approveStoryRevision(gameId) {
  const { error } = await supabase.rpc('approve_story_revision', { p_game_id: gameId })
  if (error) throw error
}

/** Keep the live story and drop the pending revision. */
export async function discardStoryRevision(gameId) {
  const { error } = await supabase.from('game_stories').update({ pending_revision: null }).eq('game_id', gameId)
  if (error) throw error
}

/** Paragraphs of a story body (blank-line separated). */
export const storyParagraphs = (body) => String(body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

/** Every media_id a timeline (and hero) cites. */
export function storyMediaIds(timeline, heroMediaId) {
  const ids = new Set()
  for (const b of Array.isArray(timeline) ? timeline : []) {
    for (const m of Array.isArray(b?.media) ? b.media : []) if (m?.media_id) ids.add(m.media_id)
  }
  if (heroMediaId) ids.add(heroMediaId)
  return [...ids]
}

export const storyEventIds = (timeline) =>
  [...new Set((Array.isArray(timeline) ? timeline : []).flatMap(b => (Array.isArray(b?.event_ids) ? b.event_ids : [])))]

// ── media ────────────────────────────────────────────────────────────────────

const MEDIA_COLUMNS = 'id,game_id,kind,origin,cf_uid,cf_code,public_url,storage_path,parent_id,event_id,clip_start_s,clip_end_s,title,note,recorded_at,duration_s,status,worker_note,is_public,uploaded_by,created_at'

// Private images (bucket game-media) are only readable by the game's contributors; sign them
// for 10 minutes. Public ones carry public_url. Adds `src` to image rows.
async function withImageUrls(rows) {
  const needSign = rows.filter(r => r.kind === 'image' && !r.public_url && r.storage_path)
  let signed = {}
  if (needSign.length) {
    const { data } = await supabase.storage.from('game-media').createSignedUrls(needSign.map(r => r.storage_path), 600)
    for (const s of data || []) if (s?.signedUrl && s.path) signed[s.path] = s.signedUrl
  }
  return rows.map(r => (r.kind === 'image' ? { ...r, src: r.public_url || signed[r.storage_path] || null } : r))
}

/**
 * game_media rows by id → { [id]: row }. RLS returns only what the viewer may see (public
 * footage for visitors). A derived clip without its own Stream uid gets its parent's uid +
 * code, with clip_start_s as the offset.
 */
export async function getMediaByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await supabase.from('game_media').select(MEDIA_COLUMNS).in('id', list)
  if (error) throw error
  let rows = data || []
  const parentIds = rows.filter(r => r.kind === 'video' && !r.cf_uid && r.parent_id).map(r => r.parent_id)
  if (parentIds.length) {
    const { data: parents } = await supabase.from('game_media').select('id,cf_uid,cf_code').in('id', parentIds)
    const byId = Object.fromEntries((parents || []).map(p => [p.id, p]))
    rows = rows.map(r => (!r.cf_uid && byId[r.parent_id] ? { ...r, cf_uid: byId[r.parent_id].cf_uid, cf_code: byId[r.parent_id].cf_code } : r))
  }
  rows = await withImageUrls(rows)
  return Object.fromEntries(rows.map(r => [r.id, r]))
}

/** game_events by id → { [id]: row } (visitors: confirmed only, by RLS). */
export async function getEventsByIds(ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await supabase.from('game_events')
    .select('id,kind,side,player_id,player_name,own_goal,period,clock_ms,source,status').in('id', list)
  if (error) throw error
  return Object.fromEntries((data || []).map(e => [e.id, e]))
}

/** Cloudflare Stream player URL, starting at `startS` seconds. */
export function streamIframeUrl(m, startS = 0) {
  if (!m?.cf_uid) return null
  const t = Math.max(0, Math.floor(startS || 0))
  const q = `?startTime=${t}s&autoplay=true&preload=auto`
  return m.cf_code
    ? `https://customer-${m.cf_code}.cloudflarestream.com/${m.cf_uid}/iframe${q}`
    : `https://iframe.videodelivery.net/${m.cf_uid}${q}`
}

/** Cloudflare Stream still at `atS` seconds. */
export function streamThumbUrl(m, atS = 0) {
  if (!m?.cf_uid) return null
  const t = Math.max(0, Math.floor(atS || 0))
  return m.cf_code
    ? `https://customer-${m.cf_code}.cloudflarestream.com/${m.cf_uid}/thumbnails/thumbnail.jpg?time=${t}s&height=720`
    : `https://videodelivery.net/${m.cf_uid}/thumbnails/thumbnail.jpg?time=${t}s&height=720`
}

/** Can the signed-in user add footage to this game? (coaches, officials, LM, editors, admins) */
export async function canContributeGame(gameId) {
  const { data, error } = await supabase.rpc('can_contribute_game', { p_game_id: gameId })
  if (error) return false
  return data === true
}

/** Raw uploads for a game — all of them, or just `userId`'s. Newest first. */
export async function getGameUploads(gameId, { userId } = {}) {
  let q = supabase.from('game_media').select(MEDIA_COLUMNS).eq('game_id', gameId).eq('origin', 'upload')
    .order('created_at', { ascending: false })
  if (userId) q = q.eq('uploaded_by', userId)
  const { data, error } = await q
  if (error) throw error
  return withImageUrls(data || [])
}

/** Recent uploads across all games, with the game (editors' overview in /creators). */
export async function getRecentUploads(limit = 30) {
  const { data, error } = await supabase.from('game_media')
    .select(`${MEDIA_COLUMNS},${GAME_EMBED}`)
    .eq('origin', 'upload')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

/** Remove an upload (own uploads; editors any). The image object goes too when policy allows. */
export async function deleteGameUpload(row) {
  const { error } = await supabase.from('game_media').delete().eq('id', row.id)
  if (error) throw error
  if (row.storage_path) await supabase.storage.from('game-media').remove([row.storage_path]).catch(() => {})
}

export const MAX_GAME_VIDEO_MB = 200 // Cloudflare's limit for a basic (non-tus) upload
export const MAX_GAME_IMAGE_MB = 20  // bucket file_size_limit

const errCode = (error) => error?.context?.status

/** Video → Cloudflare Stream via `game-media-upload`. onProgress(0..1). Resolves { media_id }. */
export async function uploadGameVideo(gameId, file, { note, onProgress = () => {} } = {}) {
  if (!file?.type?.startsWith('video/')) throw new Error('not_video')
  if (file.size > MAX_GAME_VIDEO_MB * 1024 * 1024) throw new Error('too_big')
  const { data, error } = await supabase.functions.invoke('game-media-upload', {
    body: {
      game_id: gameId, name: file.name,
      recorded_at: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      note: note || undefined,
    },
  })
  if (error || !data?.uploadURL) {
    const s = errCode(error)
    throw new Error(s === 403 ? 'forbidden' : s === 409 ? 'not_played' : s === 429 ? 'rate_limited' : 'upload_url_failed')
  }
  await new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', data.uploadURL)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload_failed')))
    xhr.onerror = () => reject(new Error('upload_failed'))
    xhr.send(form)
  })
  onProgress(1)
  return { media_id: data.media_id }
}

/** Image → private `game-media` bucket + a game_media row. Resolves { media_id }. */
export async function uploadGameImage(gameId, file, { userId, note, onProgress = () => {} } = {}) {
  if (!file?.type?.startsWith('image/')) throw new Error('not_image')
  if (file.size > MAX_GAME_IMAGE_MB * 1024 * 1024) throw new Error('too_big')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${gameId}/${crypto.randomUUID()}.${ext}`
  onProgress(0.1)
  const { error: upErr } = await supabase.storage.from('game-media').upload(path, file, { contentType: file.type, upsert: false })
  if (upErr) throw new Error(/mime|type/i.test(upErr.message || '') ? 'bad_type' : 'upload_failed')
  onProgress(0.9)
  const { data, error } = await supabase.from('game_media').insert({
    game_id: gameId, kind: 'image', origin: 'upload', storage_path: path, title: file.name.slice(0, 120),
    note: note || null, status: 'uploaded', is_public: false, uploaded_by: userId,
    recorded_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
  }).select('id').single()
  if (error) throw new Error('register_failed')
  onProgress(1)
  return { media_id: data.id }
}

/** Save/replace the note on an upload (own upload or editor). */
export async function setUploadNote(id, note) {
  const { error } = await supabase.from('game_media').update({ note: note || null }).eq('id', id)
  if (error) throw error
}

// ── publish mode ─────────────────────────────────────────────────────────────

export const PUBLISH_MODES = ['review', 'verified', 'auto']

export async function getStoryPublishMode() {
  const { data, error } = await supabase.from('league_settings').select('value').eq('key', 'game_story_publish_mode').maybeSingle()
  if (error) throw error
  return PUBLISH_MODES.includes(data?.value) ? data.value : 'review'
}

/** Admin only (RLS). Read back: a refused upsert can come back without an error. */
export async function setStoryPublishMode(mode) {
  if (!PUBLISH_MODES.includes(mode)) throw new Error('bad mode')
  const { error } = await supabase.from('league_settings')
    .upsert({ key: 'game_story_publish_mode', value: mode, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
  if ((await getStoryPublishMode()) !== mode) throw new Error('השמירה לא נקלטה (אין הרשאה?)')
}
