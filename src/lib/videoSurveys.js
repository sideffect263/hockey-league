import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

/**
 * Video surveys (supabase/video-surveys.sql). A survey runs on a set of feed posts; a
 * signed-in viewer who watches one of them for `trigger_seconds` is asked its questions.
 * Admin-managed from /admin → סקרים.
 *
 * questions: [{ id, type: 'rating' | 'text', label, required }]
 */

// ── viewer side ────────────────────────────────────────────────────────────
// One fetch per page load for the whole feed: post_id → survey, plus which of them this
// user already answered / dismissed. Cached per user so 30 feed cards = 1 round trip.
let cache = null   // { userId, promise }

export function invalidateSurveyCache() { cache = null }

async function loadActive() {
  const user = await sessionUser()
  if (!user) return { byPost: new Map(), done: new Set() }
  const [{ data: posts, error }, { data: mine }] = await Promise.all([
    supabase.from('video_survey_posts')
      .select('post_id, video_surveys!inner(id, title, badge_label, prompt, trigger_seconds, questions, status)')
      .eq('video_surveys.status', 'active'),
    supabase.from('video_survey_responses').select('survey_id, post_id').eq('user_id', user.id),
  ])
  if (error) return { byPost: new Map(), done: new Set() }
  const byPost = new Map()
  for (const row of posts || []) if (row.video_surveys) byPost.set(row.post_id, row.video_surveys)
  const done = new Set((mine || []).map(r => `${r.survey_id}:${r.post_id}`))
  return { byPost, done }
}

/** { survey, answered } for a post, or null when no active survey runs on it. */
export async function surveyForPost(postId) {
  const user = await sessionUser()
  const uid = user?.id ?? null
  if (!cache || cache.userId !== uid) cache = { userId: uid, promise: loadActive() }
  const { byPost, done } = await cache.promise
  const survey = byPost.get(postId)
  if (!survey) return null
  return { survey, answered: done.has(`${survey.id}:${postId}`) }
}

async function upsertResponse(surveyId, postId, fields) {
  const user = await sessionUser()
  if (!user) throw new Error('not-signed-in')
  const { error } = await supabase.from('video_survey_responses').upsert(
    { survey_id: surveyId, post_id: postId, user_id: user.id, ...fields },
    { onConflict: 'survey_id,post_id,user_id' },
  )
  if (error) throw error
  if (cache) cache.promise.then(c => c.done.add(`${surveyId}:${postId}`)).catch(() => {})
}

export const submitSurveyAnswers = (surveyId, postId, answers, watchedSeconds) =>
  upsertResponse(surveyId, postId, { answers, dismissed: false, watched_seconds: watchedSeconds ?? null })

export const dismissSurvey = (surveyId, postId, watchedSeconds) =>
  upsertResponse(surveyId, postId, { dismissed: true, watched_seconds: watchedSeconds ?? null })

/** Missing required answers → list of question ids. */
export function missingRequired(questions, answers) {
  return (questions || []).filter(q => q.required && (
    q.type === 'rating' ? !(answers[q.id] >= 1) : !String(answers[q.id] ?? '').trim()
  )).map(q => q.id)
}

// ── admin side ─────────────────────────────────────────────────────────────

export async function listSurveys() {
  const { data, error } = await supabase.from('video_surveys')
    .select('*, video_survey_posts(post_id), video_survey_responses(count)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(s => ({
    ...s,
    post_ids: (s.video_survey_posts || []).map(p => p.post_id),
    response_count: s.video_survey_responses?.[0]?.count ?? 0,
  }))
}

const SURVEY_FIELDS = ['title', 'badge_label', 'prompt', 'trigger_seconds', 'questions', 'status']
const pick = (o) => Object.fromEntries(SURVEY_FIELDS.filter(k => k in o).map(k => [k, o[k]]))

export async function createSurvey(fields) {
  const { data, error } = await supabase.from('video_surveys').insert(pick(fields)).select('id').single()
  if (error) throw error
  return data.id
}

export async function updateSurvey(id, fields) {
  const { error } = await supabase.from('video_surveys').update(pick(fields)).eq('id', id)
  if (error) throw error
}

export async function deleteSurvey(id) {
  const { error } = await supabase.from('video_surveys').delete().eq('id', id)
  if (error) throw error
}

/** Replace the survey's post list with exactly `postIds`. */
export async function setSurveyPosts(id, postIds) {
  const { data: cur, error } = await supabase.from('video_survey_posts').select('post_id').eq('survey_id', id)
  if (error) throw error
  const have = new Set((cur || []).map(r => r.post_id))
  const want = new Set(postIds)
  const add = [...want].filter(p => !have.has(p)).map(post_id => ({ survey_id: id, post_id }))
  const drop = [...have].filter(p => !want.has(p))
  if (add.length) {
    const { error: e } = await supabase.from('video_survey_posts').insert(add)
    if (e) throw e
  }
  if (drop.length) {
    const { error: e } = await supabase.from('video_survey_posts').delete().eq('survey_id', id).in('post_id', drop)
    if (e) throw e
  }
}

/** Feed posts that carry a video (our uploads or a YouTube link) — the picker's choices. */
export async function listVideoPosts() {
  const { data, error } = await supabase.from('posts')
    .select('id, body, video_uid, video_cf_code, created_at')
    .is('deleted_at', null).not('video_uid', 'is', null)
    .order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data || []
}

export async function surveyResults(id) {
  const { data, error } = await supabase.rpc('video_survey_results', { p_survey: id })
  if (error) throw error
  return data || []
}

/** Per-rating-question average + distribution over answered (non-dismissed) responses. */
export function summarize(questions, results) {
  const answered = results.filter(r => !r.dismissed)
  return (questions || []).filter(q => q.type === 'rating').map(q => {
    const vals = answered.map(r => Number(r.answers?.[q.id])).filter(v => v >= 1 && v <= 5)
    const dist = [1, 2, 3, 4, 5].map(n => vals.filter(v => v === n).length)
    return { question: q, count: vals.length, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, dist }
  })
}
