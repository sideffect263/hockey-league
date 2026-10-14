import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { supabase } from './supabase'

// /devs (supabase/developer-role.sql): who joined which topic + each topic's thread.
// The topic catalog itself is code (src/lib/devTopics.js). RLS: developers (and admins) read
// everything, insert as themselves; a note is deleted by its author or an admin.
//
// Structured notes: widgets on a topic page post into the same thread with a leading tag,
// e.g. "[claim:fit-rink] …", "[rate:story:<game_id>] 4/5 …", "[bug] …". parseNote() reads it back.

async function myId() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id || null
}

// Names come from a separate profiles lookup, never a PostgREST embed (embed ambiguity gotcha).
export async function getProfilesByIds(ids) {
  const list = [...new Set(ids.filter(Boolean))]
  if (!list.length) return {}
  const { data, error } = await supabase.from('profiles').select('id, display_name, avatar_url').in('id', list)
  if (error) throw error
  return Object.fromEntries((data || []).map(p => [p.id, p]))
}

/** Every membership row (small: topics × devs). */
export async function getAllMembers() {
  const { data, error } = await supabase.from('dev_topic_members')
    .select('topic_id, user_id, created_at').order('created_at')
  if (error) throw error
  return data || []
}

export async function joinTopic(topicId) {
  const { error } = await supabase.from('dev_topic_members').insert({ topic_id: topicId })
  if (error && error.code !== '23505') throw error              // already joined = fine
}

export async function leaveTopic(topicId) {
  const me = await myId()
  if (!me) return
  const { error } = await supabase.from('dev_topic_members').delete().eq('topic_id', topicId).eq('user_id', me)
  if (error) throw error
}

/** Note counts per topic + my own note count (for the cards and the header). */
export async function getNoteStats() {
  const { data, error } = await supabase.from('dev_topic_notes').select('topic_id, author_id').limit(5000)
  if (error) throw error
  const me = await myId()
  const perTopic = {}
  let mine = 0
  for (const n of data || []) {
    perTopic[n.topic_id] = (perTopic[n.topic_id] || 0) + 1
    if (n.author_id === me) mine += 1
  }
  return { perTopic, mine }
}

export async function getNotes(topicId) {
  const { data, error } = await supabase.from('dev_topic_notes')
    .select('id, topic_id, author_id, body, created_at')
    .eq('topic_id', topicId).order('created_at', { ascending: true }).limit(500)
  if (error) throw error
  return data || []
}

export async function addNote(topicId, body) {
  const text = String(body || '').trim().slice(0, 4000)
  if (!text) throw new Error('הודעה ריקה')
  const { data, error } = await supabase.from('dev_topic_notes')
    .insert({ topic_id: topicId, body: text })
    .select('id, topic_id, author_id, body, created_at').single()
  if (error) throw error
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('dev_topic_notes').delete().eq('id', id)
  if (error) throw error
}

// ── structured notes ──────────────────────────────────────────────────────────────────────────
export const NOTE_KINDS = {
  idea:     { label: 'רעיון',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  bug:      { label: 'באג',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  proposal: { label: 'הצעה',   cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  question: { label: 'שאלה',   cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  field:    { label: 'דו״ח שטח', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  claim:    { label: 'לקח/ה משימה', cls: 'bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light' },
  done:     { label: 'סיים/ה משימה', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  rate:     { label: 'דירוג',  cls: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300' },
}

/** "[kind:arg:arg2] rest" → { kind, args, text }. Plain notes → { kind: null, text }. */
export function parseNote(body) {
  const m = /^\[([a-z]+)((?::[^\]\s]+)*)\]\s*([\s\S]*)$/.exec(String(body || ''))
  if (!m || !NOTE_KINDS[m[1]]) return { kind: null, args: [], text: String(body || '') }
  return { kind: m[1], args: m[2] ? m[2].slice(1).split(':') : [], text: m[3] }
}

export const tagNote = (kind, args, text) =>
  `[${[kind, ...(args || [])].join(':')}] ${String(text || '').trim()}`.trim()

export function relTime(iso) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: he }) } catch { return '' }
}

// ── real data for the "rate the output" widgets ───────────────────────────────────────────────

/** Published AI game stories (public read), newest first. */
export async function getRecentStories(limit = 12) {
  const { data, error } = await supabase.from('game_stories')
    .select('game_id, title, summary, published_at, auto_published')
    .eq('status', 'published').order('published_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

/** Feed videos (goal highlights, clips), newest first. */
export async function getRecentVideoPosts(limit = 12) {
  const { data, error } = await supabase.from('posts')
    .select('id, body, created_at, video_uid, video_cf_code, game_id')
    .is('deleted_at', null).not('video_uid', 'is', null)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data || []).filter(p => p.video_cf_code)
}

export const videoThumb = (p) =>
  `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}/thumbnails/thumbnail.jpg?time=2s&height=360`

/** Roster rows for the data-gaps widget. players has column grants — name the columns. */
export async function getRosterForGaps() {
  const [{ data: players, error }, { data: teams, error: tErr }] = await Promise.all([
    supabase.from('players').select('id, slug, first_name, last_name, jersey_number, position, team_id, photo_url'),
    supabase.from('teams').select('id, name'),
  ])
  if (error) throw error
  if (tErr) throw tErr
  const teamName = Object.fromEntries((teams || []).map(t => [t.id, t.name]))
  return (players || []).map(p => ({ ...p, team_name: teamName[p.team_id] || '' }))
}
