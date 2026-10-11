import { supabase } from '@/lib/supabase'

// Video lab (supabase/video-lab.sql): /creators "מעבדת וידאו". Editors review a clip frame by frame
// against the AI's ball track, fix it, and queue a re-render. Processing happens off-site
// (video-analysis/lab_worker.py on the Mac polls status='queued'|'new'). Admin / content editor only (RLS).

const BUCKET = 'video-lab'
const CLIP_COLS = 'id,title,game_id,source_path,processed_path,fps,width,height,n_frames,goal_frame,strike_frame,no_replay,status,worker_note,note,sort,created_at,updated_at'

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
