import { supabase } from '@/lib/supabase'

// 3D scene replays (supabase/video-lab-scenes.sql), uploaded by video-analysis/scene3d/upload_scene.py.
// Editors only (RLS: is_admin() or is_content_editor()).

export async function getScenes() {
  const { data, error } = await supabase.from('video_lab_scenes')
    .select('id,title,youtube_id,t0,dur,score,created_at,game_id')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getScene(id) {
  const { data, error } = await supabase.from('video_lab_scenes')
    .select('id,title,youtube_id,t0,dur,score,scene,meta,created_at,game_id').eq('id', id).single()
  if (error) throw error
  return data
}
