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
