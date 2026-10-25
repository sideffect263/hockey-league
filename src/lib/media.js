import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

// Face clusters surfaced on the Media page. Default: unidentified players.
export async function getMediaClusters({ status = 'unresolved' } = {}) {
  let q = supabase
    .from('face_clusters')
    .select('cluster_key, size, status, player_name, cover_url, source_detail_url, album_idx, albums, game_date')
    .order('size', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

// Per-cluster suggestion summary (count + most-suggested name).
export async function getSuggestionSummary() {
  const { data, error } = await supabase
    .from('cluster_suggestion_summary')
    .select('cluster_key, suggestion_count, top_name')
  if (error) throw error
  return Object.fromEntries((data || []).map(r => [r.cluster_key, r]))
}

// All suggestions for one cluster (names + when).
export async function getClusterSuggestions(clusterKey) {
  const { data, error } = await supabase
    .from('cluster_suggestions')
    .select('id, first_name, last_name, created_at')
    .eq('cluster_key', clusterKey)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// Submit a name suggestion. Requires a signed-in user (the DB rejects anonymous
// inserts — see supabase/foundation-safety.sql); callers should openAuth first.
export async function submitSuggestion(clusterKey, firstName, lastName) {
  const first = (firstName || '').trim()
  const last = (lastName || '').trim()
  if (!first || !last) throw new Error('נא למלא שם פרטי ושם משפחה')
  const user = await sessionUser()
  if (!user) throw new Error('יש להתחבר כדי להציע שם')
  const { error } = await supabase.from('cluster_suggestions').insert({
    cluster_key: clusterKey,
    first_name: first.slice(0, 80),
    last_name: last.slice(0, 80),
    suggested_by: user.id,
  })
  if (error) throw error
}

// Load the full photo index (photos + which recognized player is in each) for the
// auto-illustrated feed. Paged so it survives the PostgREST 1000-row cap.
async function fetchAll(table, select) {
  const size = 1000
  const page = (i) =>
    supabase.from(table).select(select).range(i * size, i * size + size - 1)
      .then(({ data, error }) => { if (error) throw error; return data || [] })

  // The photo tables are ~2k rows. Fetch the first two pages in parallel — one round-trip
  // instead of the old await-one-page-then-the-next loop, which serialized the feed's
  // photo load and pushed out the LCP image by ~a second. Keep paging sequentially only
  // in the rare case the table has grown past 2000 rows (every page so far came back full).
  const [first, second] = await Promise.all([page(0), page(1)])
  const out = [...first, ...second]
  for (let i = 2; out.length === i * size; i++) out.push(...(await page(i)))
  return out
}

export async function getPhotoIndex() {
  const [photos, photoPlayers] = await Promise.all([
    fetchAll('photos', 'photo_id,album_idx,album_title,album_date,image_url,detail_url,n_faces,width,height'),
    fetchAll('photo_players', 'photo_id,player_id,name,box,face_h'),
  ])
  const index = { photos, photoPlayers }
  try { localStorage.setItem(PHOTO_INDEX_CACHE_KEY, JSON.stringify(index)) } catch { /* full / blocked: next visit just waits */ }
  return index
}

/**
 * The photo index this browser loaded last time, or null. The full index is ~0.7 MB
 * from the database and takes 1.2–1.8 s to arrive from Tokyo, so the feed's photos
 * start from this copy and getPhotoIndex() refreshes it behind them. Albums change
 * a few times a season; a copy one visit old is fine.
 */
const PHOTO_INDEX_CACHE_KEY = 'photo-index-v1'
export function getCachedPhotoIndex() {
  try {
    const c = JSON.parse(localStorage.getItem(PHOTO_INDEX_CACHE_KEY) || 'null')
    return c && Array.isArray(c.photos) && Array.isArray(c.photoPlayers) ? c : null
  } catch { return null }
}

// ---- Admin: review queue for name suggestions (shown in the "requests" tab) ----

// Unresolved clusters that have >=1 suggestion, with their suggested names tallied.
export async function getSuggestionQueue() {
  const { data: sugg, error } = await supabase
    .from('cluster_suggestions')
    .select('cluster_key, first_name, last_name')
  if (error) throw error
  if (!sugg?.length) return []
  const byCluster = {}
  for (const s of sugg) {
    const full = `${(s.first_name || '').trim()} ${(s.last_name || '').trim()}`.trim()
    const c = (byCluster[s.cluster_key] ||= { total: 0, names: {} })
    c.total++; c.names[full] = (c.names[full] || 0) + 1
  }
  const keys = Object.keys(byCluster)
  const { data: clusters, error: e2 } = await supabase
    .from('face_clusters')
    .select('cluster_key, size, status, cover_url, albums, game_date')
    .in('cluster_key', keys)
    .eq('status', 'unresolved')
  if (e2) throw e2
  return (clusters || []).map(c => ({
    ...c,
    total: byCluster[c.cluster_key].total,
    suggestions: Object.entries(byCluster[c.cluster_key].names)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  })).sort((a, b) => (b.total - a.total) || (b.size - a.size))
}

// Approve: link the cluster to a roster player + mark resolved. The photo_players
// view is derived from this, so the feed picks it up immediately.
export async function resolveCluster(clusterKey, { playerId, playerName }) {
  const { error } = await supabase
    .from('face_clusters')
    .update({ player_id: playerId ?? null, player_name: playerName, status: 'resolved' })
    .eq('cluster_key', clusterKey)
  if (error) throw error
}

// Dismiss: hide the cluster (not a real/identifiable player) — leaves the queue & Media page.
export async function hideCluster(clusterKey) {
  const { error } = await supabase
    .from('face_clusters')
    .update({ status: 'hidden' })
    .eq('cluster_key', clusterKey)
  if (error) throw error
}

// ---- Admin: edit clusters (the "picture clusters" tab) ----

// Every cluster, regardless of status — the admin tab groups them into
// resolved / hidden / unresolved sub-tabs. Paged so it survives the row cap
// (there are ~900+ unresolved clusters, over PostgREST's default 1000 someday).
export async function getAllClusters() {
  const sel = 'cluster_key, size, status, player_id, player_name, cover_url, source_detail_url, albums, game_date'
  const out = []; let from = 0; const size = 1000
  while (true) {
    const { data, error } = await supabase
      .from('face_clusters')
      .select(sel)
      .order('size', { ascending: false })
      .range(from, from + size - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < size) break
    from += size
  }
  return out
}

// Undo a decision: send the cluster back to the Media page for fresh crowd suggestions.
// The old suggestions are deleted first — otherwise the cluster reappears in the review
// queue with the same tally and the same (just-rejected) name pre-selected. Delete before
// the status flip so a failure leaves the cluster decided rather than re-opened with stale
// suggestions.
export async function reopenCluster(clusterKey) {
  const { error: delErr } = await supabase
    .from('cluster_suggestions')
    .delete()
    .eq('cluster_key', clusterKey)
  if (delErr) throw delErr
  // RLS blocks an UPDATE by returning zero rows, not an error — select the row back
  // so a silently-refused write surfaces instead of showing a fake success.
  const { data, error } = await supabase
    .from('face_clusters')
    .update({ player_id: null, player_name: null, status: 'unresolved' })
    .eq('cluster_key', clusterKey)
    .select('cluster_key')
  if (error) throw error
  if (!data?.length) throw new Error('העדכון נחסם — אין הרשאה')
}

// Count of clusters already resolved (for the page header).
export async function getResolvedCount() {
  const { count, error } = await supabase
    .from('face_clusters')
    .select('cluster_key', { count: 'exact', head: true })
    .eq('status', 'resolved')
  if (error) throw error
  return count || 0
}
