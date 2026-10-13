import { supabase } from '@/lib/supabase'

// Video lab (supabase/video-lab.sql): /creators "מעבדת וידאו". Editors review a clip frame by frame
// against the AI's ball track, fix it, and queue a re-render. Processing happens off-site
// (video-analysis/lab_worker.py on the Mac polls status='queued'|'new'). Admin / content editor only (RLS).

const BUCKET = 'video-lab'
const CLIP_COLS = 'id,title,game_id,source_path,processed_path,fps,width,height,n_frames,goal_frame,strike_frame,no_replay,status,worker_note,note,sort,created_at,updated_at,post_id,feed_status,feed_uid,feed_prev_uid,feed_processed_path,feed_replaced_at,feed_note,goal2_frame,strike2_frame,cuts,mark_style,mark_color,processed_at,watermark'

export function labUrl(path) {
  if (!path) return null
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// List without the (large) track; the editor loads it per clip.
export async function getLabClips() {
  const { data, error } = await supabase.from('video_lab_clips').select(CLIP_COLS)
    .order('sort', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getLabClip(id) {
  const { data, error } = await supabase.from('video_lab_clips').select(CLIP_COLS + ',track').eq('id', id).single()
  if (error) throw error
  return data
}

export async function updateLabClip(id, patch) {
  const { error } = await supabase.from('video_lab_clips').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteLabClip(clip) {
  const paths = [clip.source_path, clip.processed_path].filter(Boolean)
  const { error } = await supabase.from('video_lab_clips').delete().eq('id', clip.id)
  if (error) throw error
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {})
}

export async function getLabLabels(clipId) {
  const { data, error } = await supabase.from('video_lab_labels').select('frame,kind,x,y')
    .eq('clip_id', clipId).order('frame')
  if (error) throw error
  return data || []
}

export async function saveLabLabel(clipId, frame, kind, x = null, y = null) {
  const { error } = await supabase.from('video_lab_labels')
    .upsert({ clip_id: clipId, frame, kind, x, y, labelled_at: new Date().toISOString() }, { onConflict: 'clip_id,frame' })
  if (error) throw error
}

export async function deleteLabLabel(clipId, frame) {
  const { error } = await supabase.from('video_lab_labels').delete().eq('clip_id', clipId).eq('frame', frame)
  if (error) throw error
}

// A user's own clip: straight to storage, then a 'new' row — the Mac worker runs the AI and flips it to 'review'.
export async function uploadLabClip(file, title, gameId = null) {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
  const path = `uploads/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'video/mp4' })
  if (upErr) throw upErr
  const { data, error } = await supabase.from('video_lab_clips')
    .insert({ title: title.trim() || file.name, source_path: path, game_id: gameId, status: 'new' })
    .select(CLIP_COLS).single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw error
  }
  return data
}

// The feed post a lab clip belongs to (public read, like the feed).
export async function getPostBrief(postId) {
  const { data, error } = await supabase.from('posts').select('id,body,video_uid,deleted_at').eq('id', postId).maybeSingle()
  if (error) throw error
  return data
}

// "החלף בפיד" / "החזר את הסרטון הקודם": only a REQUEST — the Mac worker (service role) uploads the
// full-quality render to Cloudflare and repoints posts.video_uid, keeping the previous video for revert.
export async function requestFeedSwap(id, revert = false) {
  await updateLabClip(id, { feed_status: revert ? 'revert_requested' : 'requested', feed_note: null })
}

// Clip columns only (no track) — for polling while the worker swaps.
export async function getLabClipStatus(id) {
  const { data, error } = await supabase.from('video_lab_clips').select(CLIP_COLS).eq('id', id).single()
  if (error) throw error
  return data
}

// Every render of a clip (newest first) — the editor plays / compares them.
export async function getLabVersions(clipId) {
  const { data, error } = await supabase.from('video_lab_versions').select('id,path,label,created_at')
    .eq('clip_id', clipId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ---- Shot tagging (supabase/video-lab-shots.sql) --------------------------------------------
// One row per shot in a clip: shooter, rink origin, net target, result, keeper stance. Scouting data.

const SHOT_COLS = 'id,clip_id,frame,team_id,shooter_id,shooter_number,goalie_id,result,shot_type,gk_stance,origin_x,origin_y,net_x,net_y,screened,note,created_at'

export async function getLabShots(clipId) {
  const { data, error } = await supabase.from('video_lab_shots').select(SHOT_COLS).eq('clip_id', clipId).order('frame')
  if (error) throw error
  return data || []
}

// Every tagged shot in the lab (the summary card on the clip list).
export async function getAllLabShots() {
  const { data, error } = await supabase.from('video_lab_shots').select(SHOT_COLS).order('created_at').limit(5000)
  if (error) throw error
  return data || []
}

export async function saveLabShot(shot) {
  const { id, created_at: _c, ...row } = shot
  const q = id
    ? supabase.from('video_lab_shots').update(row).eq('id', id)
    : supabase.from('video_lab_shots').insert(row)
  const { data, error } = await q.select(SHOT_COLS).single()
  if (error) throw error
  return data
}

export async function deleteLabShot(id) {
  const { error } = await supabase.from('video_lab_shots').delete().eq('id', id)
  if (error) throw error
}

// The two teams of the clip's game, each with its roster (primary team or a player_teams membership).
// players has column-level grants: name the columns, never select('*').
export async function getGameSides(gameId) {
  const { data: g, error } = await supabase.from('games').select('id,home_team_id,away_team_id').eq('id', gameId).maybeSingle()
  if (error) throw error
  if (!g) return []
  const ids = [g.home_team_id, g.away_team_id].filter(Boolean)
  const [{ data: teams, error: tErr }, { data: links, error: lErr }] = await Promise.all([
    supabase.from('teams').select('id,name,primary_color').in('id', ids),
    supabase.from('player_teams').select('player_id,team_id').in('team_id', ids),
  ])
  if (tErr) throw tErr
  if (lErr) throw lErr
  const linkIds = [...new Set((links || []).map(l => l.player_id))]
  const cols = 'id,first_name,last_name,jersey_number,position,team_id'
  const [{ data: own, error: oErr }, { data: linked, error: kErr }] = await Promise.all([
    supabase.from('players').select(cols).in('team_id', ids),
    linkIds.length ? supabase.from('players').select(cols).in('id', linkIds) : Promise.resolve({ data: [] }),
  ])
  if (oErr) throw oErr
  if (kErr) throw kErr
  const byId = new Map([...(own || []), ...(linked || [])].map(p => [p.id, p]))
  const teamOf = (p) => new Set([p.team_id, ...(links || []).filter(l => l.player_id === p.id).map(l => l.team_id)])
  return ids.map(tid => {
    const t = (teams || []).find(x => x.id === tid) || { id: tid, name: '' }
    const roster = [...byId.values()].filter(p => teamOf(p).has(tid))
      .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999))
    return { ...t, roster }
  })
}

// ── Rink points (supabase/video-lab-rink.sql): tap rink landmarks on sharp frames of one venue camera;
// video-analysis/rink_points.py fits the floor + rink size from them and writes `fit` back.
export async function getRinkSets() {
  const { data, error } = await supabase.from('video_lab_rink_sets')
    .select('id,title,venue,status,fit,worker_note,fitted_at,created_at,video_lab_rink_frames(count)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getRinkSet(id) {
  const { data, error } = await supabase.from('video_lab_rink_sets')
    .select('id,title,venue,source_note,status,fit,worker_note,fitted_at,video_lab_rink_frames(id,image_path,width,height,sort)')
    .eq('id', id).single()
  if (error) throw error
  data.frames = (data.video_lab_rink_frames || []).sort((a, b) => a.sort - b.sort)
  delete data.video_lab_rink_frames
  return data
}

export async function getRinkSetStatus(id) {
  const { data, error } = await supabase.from('video_lab_rink_sets')
    .select('status,fit,worker_note,fitted_at').eq('id', id).single()
  if (error) throw error
  return data
}

export async function getRinkPoints(frameIds) {
  if (!frameIds.length) return []
  const { data, error } = await supabase.from('video_lab_rink_points')
    .select('frame_id,landmark,x,y').in('frame_id', frameIds)
  if (error) throw error
  return data || []
}

export async function saveRinkPoint(frameId, landmark, x, y) {
  const { error } = await supabase.from('video_lab_rink_points')
    .upsert({ frame_id: frameId, landmark, x, y, labelled_at: new Date().toISOString() }, { onConflict: 'frame_id,landmark' })
  if (error) throw error
}

export async function deleteRinkPoint(frameId, landmark) {
  const { error } = await supabase.from('video_lab_rink_points').delete().eq('frame_id', frameId).eq('landmark', landmark)
  if (error) throw error
}

export async function requestRinkFit(id) {
  const { error } = await supabase.from('video_lab_rink_sets').update({ status: 'queued', worker_note: null }).eq('id', id)
  if (error) throw error
}
