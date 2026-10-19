import { supabase } from '@/lib/supabase'
import { uploadFeedVideo } from '@/lib/feedVideo'

// /creators → "סטודיו" (supabase/creators-studio.sql). A guided flow for a content creator: WHAT to make →
// media from the pool → the OUTPUTS → a "kit" (feed_drafts row): files per format + a caption per platform.
// The site feed is published here; Instagram / Facebook / TikTok / WhatsApp are posted BY HAND by the
// creator from the kit (Ariel 2026-10-19). Every video gets a 16:9 (site) and a 9:16 (other platforms,
// action-following crop — rendered by the video worker, so it starts as "queued").

const SITE = 'https://rinkhockeyil.com'
export const LEAGUE_CF_CODE = 'dcl73u4kznt1yvoc'   // the league's Cloudflare Stream customer code

/** What a creator can make. `pool` = media sources offered in step 2; `pick` = how many items. */
export const CONTENT_TYPES = [
  { id: 'goal', emoji: '🏒', title: 'גול או מהלך יפה', hint: 'קליפ אחד או כמה — גולים, הצלות, מהלכים', pool: ['lab_clip', 'post'], pick: [1, 10], worker: false },
  { id: 'goals_summary', emoji: '🔥', title: 'תקציר גולים', hint: 'כל הגולים של יום המשחקים האחרון בסרטון אחד', pool: [], pick: [0, 0], worker: true },
  { id: 'game_play', emoji: '🧠', title: 'מהלך משחק', hint: 'ראיתם משהו מעניין? סמנו את הרגע ותארו במילים — נכין סרטון ניתוח', pool: ['lab_clip', 'post', 'game_media'], pick: [1, 1], worker: true, brief: true, range: true },
  { id: 'photo_post', emoji: '📸', title: 'פוסט תמונות', hint: 'תמונה אחת או קרוסלה מאלבומי המשחקים', pool: ['photo', 'game_media_image'], pick: [1, 10], worker: false },
  { id: 'round_results', emoji: '📊', title: 'תוצאות המחזור', hint: 'סיכום כל התוצאות של יום משחקים', pool: ['photo', 'lab_clip'], pick: [0, 4], worker: false, gameDay: 'past' },
  { id: 'round_preview', emoji: '📅', title: 'המחזור הבא', hint: 'המשחקים הקרובים — מתי, איפה ומי נגד מי', pool: ['photo'], pick: [0, 4], worker: false, gameDay: 'future' },
  { id: 'game_story', emoji: '📖', title: 'סיפור משחק', hint: 'הסיפור הכתוב של משחק, מוכן לשיתוף', pool: [], pick: [0, 0], worker: false, story: true },
]
export const TYPE_BY_ID = Object.fromEntries(CONTENT_TYPES.map(t => [t.id, t]))

/** Where a kit goes. `format` = what the creator gets for that platform. */
export const OUTPUTS = [
  { id: 'site', label: 'האתר והאפליקציה', format: '16:9', hint: 'מתפרסם מכאן בלחיצה' },
  { id: 'instagram', label: 'אינסטגרם', format: '9:16', hint: 'ריל / סטורי — מעלים מהטלפון' },
  { id: 'facebook', label: 'פייסבוק', format: '9:16', hint: 'ריל / פוסט — מעלים מהטלפון' },
  { id: 'tiktok', label: 'טיקטוק', format: '9:16', hint: 'מעלים מהטלפון' },
  { id: 'whatsapp', label: 'וואטסאפ', format: '9:16', hint: 'סטטוס או קבוצה' },
]
export const OUTPUT_BY_ID = Object.fromEntries(OUTPUTS.map(o => [o.id, o]))
export const DEFAULT_OUTPUTS = ['site', 'instagram', 'facebook']

export const SOURCE_LABEL = {
  lab_clip: 'קליפים מעובדים', post: 'סרטונים מהפיד', game_media: 'סרטונים שהועלו', game_media_image: 'תמונות שהועלו', photo: 'אלבומי תמונות', upload: 'הועלה עכשיו',
}

// ─── media URLs ────────────────────────────────────────────────────────────────
export const labVideoUrl = (path) => (path ? supabase.storage.from('video-lab').getPublicUrl(path).data.publicUrl : null)
export const streamThumb = (code, uid, t = 2) => `https://customer-${code}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=${t}s&height=360`
export const streamMp4 = (code, uid) => `https://customer-${code}.cloudflarestream.com/${uid}/downloads/default.mp4`

// ─── the pool ──────────────────────────────────────────────────────────────────
// Every item: { key, source, id, label, date, gameId, thumb?, video?, image?, duration?, cf? }
const k = (source, id) => `${source}:${id}`

async function poolLabClips() {
  const { data, error } = await supabase.from('video_lab_clips')
    .select('id,title,game_id,processed_path,fps,n_frames,goal_frame,status,created_at,feed_uid,post:posts(video_uid,video_cf_code)')
    .order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  // A clip with no rendered file is a labelling task, not something to post.
  return (data || []).filter(c => c.processed_path).map(c => {
    const uid = c.post?.video_uid || c.feed_uid
    const code = c.post?.video_cf_code || LEAGUE_CF_CODE
    return {
      key: k('lab_clip', c.id), source: 'lab_clip', id: c.id, label: momentLabel(c.title, !!c.game_id), date: c.created_at, gameId: c.game_id,
      isGoal: c.goal_frame != null, video: labVideoUrl(c.processed_path),
      thumb: uid ? streamThumb(code, uid, Math.max(1, Math.round((c.goal_frame || 30) / (c.fps || 30)))) : null,
      duration: c.n_frames && c.fps ? c.n_frames / c.fps : null, cf: uid ? { uid, code } : null,
    }
  })
}

async function poolPosts() {
  const { data, error } = await supabase.from('posts').select('id,body,video_uid,video_cf_code,video_ratio,game_id,created_at')
    .not('video_uid', 'is', null).is('deleted_at', null).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  const uids = (data || []).map(p => p.video_uid)
  const { data: meta } = uids.length
    ? await supabase.from('video_seo_meta').select('uid,duration_s,mp4_url,mp4_status').in('uid', uids)
    : { data: [] }
  const m = Object.fromEntries((meta || []).map(r => [r.uid, r]))
  return (data || []).map(p => ({
    key: k('post', p.id), source: 'post', id: p.id, label: firstLine(p.body) || 'סרטון', date: p.created_at, gameId: p.game_id,
    thumb: streamThumb(p.video_cf_code, p.video_uid), cf: { uid: p.video_uid, code: p.video_cf_code, ratio: p.video_ratio },
    video: m[p.video_uid]?.mp4_status === 'ready' ? m[p.video_uid].mp4_url : null, duration: m[p.video_uid]?.duration_s ?? null,
  }))
}

async function poolGameMedia(kind) {
  const { data, error } = await supabase.from('game_media')
    .select('id,kind,origin,cf_uid,cf_code,public_url,title,note,game_id,duration_s,created_at,status')
    .eq('kind', kind).order('created_at', { ascending: false }).limit(150)
  if (error) throw error
  return (data || []).filter(g => kind === 'image' ? g.public_url : g.cf_uid).map(g => kind === 'image'
    ? { key: k('game_media_image', g.id), source: 'game_media_image', id: g.id, label: g.title || g.note || 'תמונה', date: g.created_at, gameId: g.game_id, thumb: sizedPhoto(g.public_url, 400), image: g.public_url }
    : { key: k('game_media', g.id), source: 'game_media', id: g.id, label: g.title || (g.origin === 'recording' ? 'שידור המשחק' : 'סרטון'), date: g.created_at, gameId: g.game_id,
        thumb: streamThumb(g.cf_code, g.cf_uid, 30), cf: { uid: g.cf_uid, code: g.cf_code }, duration: g.duration_s })
}

async function poolPhotos() {
  const { data, error } = await supabase.from('photos').select('photo_id,image_url,album_title,album_date,width,height')
    .order('album_date', { ascending: false }).limit(400)
  if (error) throw error
  return (data || []).filter(p => p.image_url).map(p => ({
    key: k('photo', p.photo_id), source: 'photo', id: p.photo_id, label: p.album_title || 'תמונה', date: p.album_date,
    album: p.album_title, thumb: sizedPhoto(p.image_url, 400), image: sizedPhoto(p.image_url, 2048),
  }))
}

/** "קריית מוצקין 10–3 קריית ביאליק · גול של אורי" → "גול של אורי" when the game is shown anyway. */
export function momentLabel(title, hasGame) {
  const t = String(title || '').trim() || 'קליפ'
  if (!hasGame || !t.includes('·')) return t
  return t.split('·').slice(1).join('·').trim() || t
}

/** Google Photos (lh3) URLs take a size suffix; other URLs are left alone. */
export function sizedPhoto(url, w) {
  if (/googleusercontent\.com/.test(url || '')) return url.replace(/=[^/]*$/, '') + `=w${w}`
  // Supabase Storage public object → the image-transform endpoint (Pro plan), so a grid tile isn't a 1280 px still.
  if (/\/storage\/v1\/object\/public\//.test(url || '') && w < 1000) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + `${url.includes('?') ? '&' : '?'}width=${w}&quality=70`
  }
  return url
}

const LOADERS = { lab_clip: poolLabClips, post: poolPosts, game_media: () => poolGameMedia('video'), game_media_image: () => poolGameMedia('image'), photo: poolPhotos }

/** The pool for a content type: its sources, loaded in parallel (a failing source is skipped, not fatal). */
export async function loadPool(sources) {
  const parts = await Promise.all(sources.map(s => LOADERS[s]().catch(e => { console.error('pool', s, e); return [] })))
  // A lab clip that was posted is the same video as its feed post: keep the lab one (it has the file).
  const all = parts.flat()
  const labUids = new Set(all.filter(i => i.source === 'lab_clip' && i.cf).map(i => i.cf.uid))
  return all.filter(i => !(i.source !== 'lab_clip' && i.cf && labUids.has(i.cf.uid)))
}

// ─── captions ──────────────────────────────────────────────────────────────────
export function firstLine(body, max = 90) {
  const line = String(body || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

const tag = (s) => '#' + String(s || '').replace(/[^\p{L}\p{N}]+/gu, '')
const BASE_TAGS = ['#הוקיגלגיליות', '#ליגתהוקיגלגיליות', '#rinkhockey', '#rollerhockey', '#ספורטישראלי']

/**
 * One caption per platform from the main text (what the site post says). Instagram/TikTok get hashtags
 * (team names too) and no clickable link; Facebook/WhatsApp get the page link.
 */
export function buildCaptions({ text, teams = [], link = null, outputs }) {
  const body = String(text || '').trim()
  const tags = [...new Set([...teams.filter(Boolean).map(tag), ...BASE_TAGS])].join(' ')
  const url = link ? (link.startsWith('http') ? link : `${SITE}${link}`) : SITE
  const all = {
    site: body,
    instagram: `${body}\n\n🔗 כל הסרטונים והתוצאות: rinkhockeyil.com (קישור בביו)\n\n${tags}`,
    facebook: `${body}\n\n👉 ${url}`,
    tiktok: `${firstLine(body, 120)}\n\n${tags}`,
    whatsapp: `${body}\n\n${url}`,
  }
  return Object.fromEntries((outputs || Object.keys(all)).map(o => [o, all[o]]))
}

const dmy = (iso) => new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })
const hm = (iso) => new Date(iso).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' })
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })

/** Game days (Asia/Jerusalem dates) with their games, newest first for 'past', soonest first for 'future'. */
export function gameDays(games, which) {
  const now = Date.now()
  const pick = (games || []).filter(g => !g.is_test && g.game_date && (which === 'past'
    ? g.status === 'completed' && g.home_score != null
    : g.status === 'scheduled' && new Date(g.game_date).getTime() > now - 3 * 3600e3))
  const by = {}
  for (const g of pick) (by[dayKey(g.game_date)] ||= []).push(g)
  const days = Object.entries(by).map(([day, gs]) => ({ day, games: gs.sort((a, b) => a.game_date.localeCompare(b.game_date)) }))
  return days.sort((a, b) => which === 'past' ? b.day.localeCompare(a.day) : a.day.localeCompare(b.day))
}

/** The ready-to-edit main text for a content type (the creator can change all of it). */
export function suggestText({ type, items = [], game = null, day = null, story = null, teamName = (id) => '' }) {
  const vs = (g) => `${teamName(g.home_team_id)} נגד ${teamName(g.away_team_id)}`
  if (type === 'goal') {
    if (items.length === 1) return `⚪ ${items[0].label}`
    return `🏒 רגעים מהמגרש\n\n${items.map(i => `▪️ ${i.label}`).join('\n')}`
  }
  if (type === 'photo_post') return `📸 ${items[0]?.album || 'מהמגרש'}`
  if (type === 'round_results' && day) {
    const lines = day.games.map(g => `${teamName(g.home_team_id)} ${g.home_score}–${g.away_score} ${teamName(g.away_team_id)}`)
    return `📊 תוצאות המחזור · ${dmy(day.games[0].game_date)}\n\n${lines.join('\n')}`
  }
  if (type === 'round_preview' && day) {
    const lines = day.games.map(g => `🕒 ${hm(g.game_date)} · ${vs(g)}${g.venue ? ` · ${g.venue}` : ''}`)
    return `📅 המחזור הבא · ${dmy(day.games[0].game_date)}\n\n${lines.join('\n')}\n\nהכניסה חופשית — בואו לעודד!`
  }
  if (type === 'game_story' && story) return `📖 ${story.title}\n\n${story.summary || ''}`.trim()
  if (type === 'game_play') return game ? `🧠 מהלך משחק · ${vs(game)}` : '🧠 מהלך משחק'
  return ''
}

// ─── kits ──────────────────────────────────────────────────────────────────────
export async function getKits() {
  const { data, error } = await supabase.from('feed_drafts').select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Create the kit. Videos for the SITE need a Cloudflare copy: a lab clip that was never posted is
 * uploaded from its rendered MP4 here (the editor's browser), so "פרסום באתר" works right away.
 * The vertical version is always queued for the video worker; game plays wait for the worker entirely.
 */
export async function createKit({ type, items, outputs, text, gameId = null, teamId = null, brief = null, range = null, captions, onProgress = () => {} }) {
  const t = TYPE_BY_ID[type]
  const first = items[0] || null
  const videoItems = items.filter(i => i.video || i.cf)
  const photoItems = items.filter(i => i.image)
  const row = {
    body: (captions?.site || text || '').trim() || (t?.title ?? 'טיוטה'),
    content_type: type, outputs, game_id: gameId || first?.gameId || null, team_id: teamId,
    media: items.map(i => ({ source: i.source, id: i.id, label: i.label, ...(range && i === first ? range : {}) })),
    captions: captions || {}, brief: brief?.trim() || null, sort: 0,
    status: t?.worker ? 'queued' : 'ready',
  }
  const assets = {}
  if (photoItems.length) { assets.images = photoItems.map(p => p.image); row.image_url = photoItems[0].image }
  const wantsVertical = outputs.some(o => o !== 'site')
  if (videoItems.length && !t?.worker) {
    const v = videoItems[0]
    let cf = v.cf
    if (!cf && v.video && outputs.includes('site')) {
      const blob = await fetch(v.video).then(r => { if (!r.ok) throw new Error('fetch_clip'); return r.blob() })
      const up = await uploadFeedVideo(new File([blob], 'clip.mp4', { type: 'video/mp4' }), onProgress)
      cf = { uid: up.uid, code: up.cfCode, ratio: up.ratio }
    }
    if (cf) Object.assign(row, { video_uid: cf.uid, video_cf_code: cf.code, video_ratio: cf.ratio || 16 / 9 })
    assets.horizontal = { url: v.video || (cf ? streamMp4(cf.code, cf.uid) : null), uid: cf?.uid || null }
    if (videoItems.length > 1) assets.more = videoItems.slice(1).map(x => ({ label: x.label, url: x.video || (x.cf ? streamMp4(x.cf.code, x.cf.uid) : null) }))
    if (wantsVertical) assets.vertical = { status: 'queued' }
  }
  row.assets = assets
  const { data, error } = await supabase.from('feed_drafts').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateKit(id, patch) {
  const { error } = await supabase.from('feed_drafts').update(patch).eq('id', id)
  if (error) throw error
}

/** Kit state for the list chip. */
export function kitState(kit) {
  if (kit.status === 'error') return { id: 'error', label: 'שגיאה', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (kit.status === 'queued' || kit.status === 'processing') return { id: 'working', label: kit.status === 'processing' ? 'בעיבוד' : 'ממתין לעיבוד', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' }
  if (kit.assets?.vertical?.status === 'error') return { id: 'partial', label: 'הגרסה האנכית נכשלה', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (kit.assets?.vertical && kit.assets.vertical.status !== 'ready') return { id: 'partial', label: 'גרסה אנכית בהכנה', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' }
  return { id: 'ready', label: 'מוכן', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' }
}

/** Download a file under a friendly name (cross-origin URLs are fetched to a blob first). */
export async function downloadFile(url, name) {
  try {
    const blob = await fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob() })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 30000)
    return true
  } catch {
    window.open(url, '_blank', 'noopener')
    return false
  }
}
