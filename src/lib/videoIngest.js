import { supabase } from '@/lib/supabase'
import { parseYouTubeId } from '@/lib/video'
import { uploadGameVideo } from '@/lib/gameStories'

// Video ingest (supabase/video-ingest.sql): /creators → "העלאת וידאו". An editor submits a game's footage + the
// pipelines to run; the Mac worker (video-analysis/ingest_worker.py, service role) downloads it and runs them,
// writing per-pipeline progress into `steps`. Admin / content editor only (RLS).

/** The pipelines, in the order the worker runs them. `needs` = what it depends on (shown to the editor). */
export const INGEST_PIPELINES = [
  { id: 'full_video', label: 'וידאו מלא בעמוד המשחק', what: 'מצרף את הסרטון לעמוד המשחק (נגן מלא לצופים).', out: 'שורת וידאו בעמוד המשחק' },
  { id: 'goals', label: 'הדגשי גולים', what: 'מוצא את רגעי הגולים (אירועי השיפוט + רעש הקהל), חותך כל גול ומעבד בטיפול התקני (מעקב כדור + הילוך חוזר).', out: 'קליפים במעבדת הווידאו לבדיקה + טיוטה לפיד לכל גול' },
  { id: 'reel', label: 'תקציר גולים', what: 'סרטון ספירה לאחור של כל קליפי הגולים של המשחק (רץ אחרי הדגשי הגולים).', out: 'טיוטה לפיד' },
  { id: 'story', label: 'סיפור המשחק', what: 'מפעיל את כותב סיפור המשחק (לאחר סיום המשחק בלבד).', out: 'טיוטת סיפור בלשונית סיפורי משחקים' },
  { id: 'stats', label: 'סטטיסטיקת משחק', what: 'מנוע הסטטיסטיקה: זיהוי שחקנים וכדור, מצלמה ואירועים (מסירות, בעיטות, חטיפות).', out: 'ריצה בסקירת אירועים → דוח סטטיסטיקה', note: 'דורש את מחשב ה-GPU וכיול מגרש לאולם/מצלמה חדשים — המק רק מכין ומסמן.' },
]
export const PIPELINE_LABEL = Object.fromEntries(INGEST_PIPELINES.map(p => [p.id, p.label]))

export const STEP_STATUS = {
  queued:       { label: 'בתור', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  processing:   { label: 'בעיבוד', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  done:         { label: 'הושלם', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  error:        { label: 'שגיאה', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  needs_gpu:    { label: 'ממתין למחשב GPU', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  needs_review: { label: 'דרוש קלט', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  skipped:      { label: 'דולג', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export const JOB_STATUS = {
  queued: 'בתור', downloading: 'מוריד', processing: 'בעיבוד', done: 'הושלם', needs_attention: 'דרושה פעולה', error: 'שגיאה',
}

const COLS = 'id,created_at,updated_at,created_by,source_kind,source_url,storage_path,media_id,game_id,title,pipelines,status,steps,local_path,error'

export async function getIngestJobs({ limit = 30 } = {}) {
  const { data, error } = await supabase.from('video_ingest_jobs').select(COLS)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data || []
}

const initialSteps = (pipelines) => Object.fromEntries(pipelines.map(p => [p, { status: 'queued' }]))

/**
 * Submit a job. source = { kind: 'youtube', url } | { kind: 'upload', file }.
 * Uploads go through the existing game-media-upload path (Cloudflare Stream, <= 200 MB) first.
 */
export async function submitIngestJob({ gameId, source, pipelines, title, onProgress = () => {} }) {
  if (!gameId) throw new Error('בחרו משחק')
  if (!pipelines?.length) throw new Error('בחרו לפחות תהליך אחד')
  const row = { game_id: gameId, pipelines, steps: initialSteps(pipelines), title: title?.trim() || null, status: 'queued' }
  if (source.kind === 'youtube') {
    const id = parseYouTubeId(source.url || '')
    if (!id) throw new Error('קישור YouTube לא תקין')
    Object.assign(row, { source_kind: 'youtube', source_url: `https://www.youtube.com/watch?v=${id}` })
  } else {
    if (!source.file) throw new Error('בחרו קובץ וידאו')
    let media
    try { media = await uploadGameVideo(gameId, source.file, { note: 'העלאת וידאו (יוצרי תוכן)', onProgress }) }
    catch (e) {
      const msg = { too_big: 'הקובץ גדול מ-200MB — העלו ל-YouTube (לא רשום) והדביקו קישור', not_video: 'זה לא קובץ וידאו',
                    forbidden: 'אין הרשאה להעלות למשחק הזה', not_played: 'המשחק עוד לא שוחק', rate_limited: 'יותר מדי העלאות — נסו בעוד כמה דקות' }[e.message]
      throw new Error(msg || 'ההעלאה נכשלה')
    }
    Object.assign(row, { source_kind: 'upload', storage_path: `game_media:${media.media_id}`, media_id: media.media_id })
  }
  const { data, error } = await supabase.from('video_ingest_jobs').insert(row).select(COLS).single()
  if (error) throw error
  return data
}

/** Re-queue one step (optionally with editor input, e.g. goal times) — the worker runs only queued steps. */
export async function requeueStep(job, pipeline, input) {
  const steps = { ...(job.steps || {}) }
  steps[pipeline] = { ...(steps[pipeline] || {}), status: 'queued', note: null, ...(input ? { input } : {}) }
  const { data, error } = await supabase.from('video_ingest_jobs')
    .update({ steps, status: 'queued', error: null }).eq('id', job.id).select(COLS).single()
  if (error) throw error
  return data
}

export async function deleteIngestJob(id) {
  const { error } = await supabase.from('video_ingest_jobs').delete().eq('id', id)
  if (error) throw error
}

/** "1:23, 12:05, 1:02:30" -> [83, 725, 3750]; null on any bad entry. */
export function parseTimes(text) {
  const parts = String(text || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const out = []
  for (const p of parts) {
    if (!/^\d+(:\d{1,2}){0,2}$/.test(p)) return null
    const secs = p.split(':').map(Number).reduce((a, n) => a * 60 + n, 0)
    out.push(secs)
  }
  return out.sort((a, b) => a - b)
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

/** Links for a step's `output` (whatever the worker filled). */
export function outputLinks(pipeline, output, gameId) {
  if (!output) return []
  const links = []
  for (const c of output.clips || []) links.push({ to: `/devs?tab=lab&clip=${c.id}`, label: c.title || 'קליפ במעבדה' })
  for (const d of output.drafts || []) links.push({ to: `/creators?tab=drafts#${d}`, label: 'טיוטה לפיד' })
  if (output.draft_id) links.push({ to: `/creators?tab=drafts#${output.draft_id}`, label: 'טיוטה לפיד' })
  if (output.game_video_id) links.push({ to: `/games/${gameId}`, label: 'עמוד המשחק' })
  if (output.run_id) links.push({ to: `/devs?tab=lab&match=${output.run_id}`, label: 'סקירת אירועים' })
  if (pipeline === 'story' && output.ran) links.push({ to: '/creators?tab=stories', label: 'סיפורי משחקים' })
  if (output.download_url) links.push({ href: output.download_url, label: 'הורדה' })
  return links
}
