import { supabase } from './supabase'
import { getPlayers, getTeams } from './api'
import { decodeMention, decodePlayerMention, finalMentions, groupMentions } from './mentions'

/**
 * @-tags — the Supabase half. Server: supabase/player-mentions.sql (set_mentions,
 * remove_mention, player_mentions, public-read `mentions`). Pure helpers: lib/mentions.js.
 */

export const MENTION_KIND = { post: 'post', comment: 'comment', itemComment: 'item_comment' }
const COLUMN = { post: 'post_id', comment: 'comment_id', item_comment: 'item_comment_id' }
const MENTION_COLS = 'id, player_id, author_id, post_id, comment_id, item_comment_id, display'

/**
 * Active tags on a set of posts / comments / feed-card comments, grouped by that row's id.
 * Chunked so a 200-post feed never builds an over-long URL. Never throws — a missing tag
 * only means a name renders as plain text.
 * @returns {Promise<Object<string, Array>>}
 */
export async function getMentions(kind, ids) {
  const col = COLUMN[kind]
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!col || !list.length) return {}
  try {
    const chunks = []
    for (let i = 0; i < list.length; i += 80) chunks.push(list.slice(i, i + 80))
    const results = await Promise.all(chunks.map(c =>
      supabase.from('mentions').select(MENTION_COLS).in(col, c).is('removed_at', null)))
    const rows = results.flatMap(r => (r.error ? [] : r.data || []))
    return groupMentions(rows, col)
  } catch {
    return {}
  }
}

/**
 * Call AFTER the post/comment is saved. Sends only picks whose "@display" is in the final
 * text. Returns the active list for that row (decoded). Throws on failure — the caller
 * shows a small error and keeps the (already saved) post/comment.
 * @param {'post'|'comment'|'item_comment'} kind
 */
export async function setMentions(kind, id, text, picks) {
  const { data, error } = await supabase.rpc('set_mentions', {
    p_kind: kind, p_id: id, p_mentions: finalMentions(text, picks),
  })
  if (error) throw error
  const col = COLUMN[kind]
  return (Array.isArray(data) ? data : [])
    .map(r => decodeMention({ ...r, [col]: id }))
    .filter(Boolean)
}

export async function removeMention(mentionId) {
  const { error } = await supabase.rpc('remove_mention', { p_mention: mentionId })
  if (error) throw error
}

/** "תויג/ה ב…" on a player page, newest first. Never throws (the section just hides). */
export async function getPlayerMentions(playerId, limit = 10) {
  if (!playerId) return []
  const { data, error } = await supabase.rpc('player_mentions', { p_player: playerId, p_limit: limit })
  if (error) return []
  return (data || []).map(decodePlayerMention).filter(Boolean)
}

// The @-picker's directory: every player (any player can be tagged) + team crests.
// Loaded once per page session, on the first "@".
let directory = null
export function loadMentionDirectory() {
  if (!directory) {
    directory = Promise.all([getPlayers('last_name', true), getTeams().catch(() => [])])
      .then(([players, teams]) => ({
        players: players || [],
        teamsMap: Object.fromEntries((teams || []).map(t => [t.id, t])),
      }))
      .catch(() => { directory = null; return { players: [], teamsMap: {} } })
  }
  return directory
}
