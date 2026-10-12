import { supabase } from './supabase'

// סיפור המשחק — written stories for finished games (table game_stories; drafts come from the
// game-story routine, see scripts/game-story/ROUTINE.md). RLS: everyone reads PUBLISHED; content
// editors + admins read and edit all, and are the only ones who can publish.

const STORY_COLUMNS = 'game_id,status,title,summary,body,moments,hero_image_url,media_post_ids,generated_at,published_at,updated_at'

/** The story for one game, or null. Visitors only ever get a published one (RLS). */
export async function getGameStory(gameId) {
  const { data, error } = await supabase.from('game_stories').select(STORY_COLUMNS).eq('game_id', gameId).maybeSingle()
  if (error) throw error
  return data
}

/** Stories waiting for review (drafts), newest game first, with the game's teams + score. */
export async function getStoryDrafts() {
  const { data, error } = await supabase
    .from('game_stories')
    .select(`${STORY_COLUMNS},game:games(id,slug,game_date,home_score,away_score,home:teams!games_home_team_id_fkey(name),away:teams!games_away_team_id_fkey(name))`)
    .eq('status', 'draft')
    .order('generated_at', { ascending: false })
  if (error) throw error
  return (data || []).sort((a, b) => String(b.game?.game_date || '').localeCompare(String(a.game?.game_date || '')))
}

export async function countStoryDrafts() {
  const { count } = await supabase.from('game_stories').select('game_id', { count: 'exact', head: true }).eq('status', 'draft')
  return count || 0
}

/** Edit + set status in one write ('draft' | 'published' | 'rejected'). Who/when is stamped server-side. */
export async function saveGameStory(gameId, { title, summary, body, status }) {
  const patch = { title, summary, body, ...(status ? { status } : {}) }
  const { error } = await supabase.from('game_stories').update(patch).eq('game_id', gameId)
  if (error) throw error
}

/** Paragraphs of a story body (blank-line separated). */
export const storyParagraphs = (body) => String(body || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
