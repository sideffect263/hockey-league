import { supabase } from '@/lib/supabase'

// Feed drafts (supabase/feed-drafts.sql): posts prepared for review in /creators. Admin /
// content editor only (RLS). Publishing goes through publish_feed_draft(), which inserts
// the post as the approver and removes the draft in one transaction.

export async function getFeedDrafts() {
  const { data, error } = await supabase
    .from('feed_drafts')
    .select('*')
    .order('sort', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createFeedDraft({ body, video = null, gameId = null, teamId = null, note = null, sort = 0 }) {
  const row = { body: body.trim(), game_id: gameId, team_id: teamId, note, sort }
  if (video?.uid) Object.assign(row, { video_uid: video.uid, video_cf_code: video.cfCode, video_ratio: video.ratio })
  const { data, error } = await supabase.from('feed_drafts').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateFeedDraft(id, patch) {
  const { error } = await supabase.from('feed_drafts').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteFeedDraft(id) {
  const { error } = await supabase.from('feed_drafts').delete().eq('id', id)
  if (error) throw error
}

// Returns the new post id.
export async function publishFeedDraft(id) {
  const { data, error } = await supabase.rpc('publish_feed_draft', { p_id: id })
  if (error) throw error
  return data
}

// "תקציר גולים" (supabase/video-lab-reels.sql): editors queue a top-5-goals reel; the Mac lab worker
// (video-analysis/highlight_reel.py) picks the latest game day's goal clips, renders a 9:16 countdown
// and leaves it here as a draft. The status row is polled while it renders.
export async function requestGoalReel() {
  const { data, error } = await supabase.from('video_lab_reels').insert({}).select('*').single()
  if (error) throw error
  return data
}

export async function getLatestGoalReel() {
  const { data, error } = await supabase.from('video_lab_reels')
    .select('id,status,game_day,picks,draft_id,video_path,note,created_at,updated_at')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}

export function goalReelDownloadUrl(path) {
  return path ? supabase.storage.from('video-lab').getPublicUrl(path).data.publicUrl : null
}
