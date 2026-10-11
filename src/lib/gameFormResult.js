import { supabase } from './supabase'
import { PLAYER_PUBLIC_COLUMNS } from './api'

/**
 * Entering a result after the game from the handwritten referee form (טופס שיפוט).
 * See supabase/game-form-results.sql for the whole flow. Allowed: admin, league manager,
 * judge — never a coach. The server enforces that; `canEnterResults` only hides the UI.
 */

const BUCKET = 'game-forms'
const MAX_EDGE = 2200        // px — plenty for handwriting, ~0.5–1MB as JPEG
const JPEG_QUALITY = 0.85

export const canEnterResults = ({ isAdmin, isLeagueManager, isJudgeRole }) =>
  !!(isAdmin || isLeagueManager || isJudgeRole)

/** A game is enterable once it has (about) started and isn't finished/cancelled. */
export const isAwaitingResult = (game, now = Date.now()) =>
  !!game && ['scheduled', 'waiting_result', 'in_progress'].includes(game.status) &&
  new Date(game.game_date).getTime() <= now + 3 * 3600e3

/**
 * Phone photos → a bounded JPEG. Re-encoding also turns an iPhone HEIC (which Safari can
 * decode but the bucket refuses) into JPEG, and drops EXIF location data.
 */
export async function compressPhoto(file) {
  let source
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('לא ניתן לפתוח את התמונה'))
      img.src = URL.createObjectURL(file)
    })
  }
  const w = source.width, h = source.height
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('לא ניתן לעבד את התמונה')
  return blob
}

/**
 * Upload the photo(s), open a submission, and ring the routine's doorbell.
 * Returns the submission id. A failed doorbell is not an error: the photo is saved and the
 * form can still be filled in by hand.
 */
export async function submitGameForm(gameId, files) {
  const paths = []
  for (const file of files) {
    const blob = await compressPhoto(file)
    const path = `${gameId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
    if (error) throw error
    paths.push(path)
  }
  const { data: id, error } = await supabase.rpc('create_game_form_submission', { p_game: gameId, p_paths: paths })
  if (error) throw error
  let notified = false
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/game-form-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ submission_id: id }),
    })
    notified = res.ok
  } catch { /* manual entry still works */ }
  return { id, notified }
}

/** The newest submission for a game that is still in play (not applied/discarded), or null. */
export async function getOpenSubmission(gameId) {
  const { data, error } = await supabase
    .from('game_form_submissions')
    .select('id,status,photo_paths,extracted,extract_error,created_at,analyzed_at')
    .eq('game_id', gameId)
    .in('status', ['uploaded', 'analyzing', 'analyzed', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

/** Open submissions for many games → gameId → status. */
export async function getOpenSubmissionStatuses(gameIds) {
  if (!gameIds.length) return {}
  const { data } = await supabase
    .from('game_form_submissions')
    .select('game_id,status,created_at')
    .in('game_id', gameIds)
    .in('status', ['uploaded', 'analyzing', 'analyzed', 'failed'])
    .order('created_at', { ascending: false })
  const out = {}
  for (const r of data || []) if (!out[r.game_id]) out[r.game_id] = r.status
  return out
}

/**
 * Keep photos of an already-played game's paper form on the game itself (no submission,
 * nothing re-applied): upload, then record the paths on game_reports.form_photos.
 */
export async function uploadGameFormPhotos(gameId, files) {
  const paths = []
  for (const file of files) {
    const blob = await compressPhoto(file)
    const path = `${gameId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
    if (error) throw error
    paths.push(path)
  }
  const { error } = await supabase.rpc('add_game_form_photos', { p_game_id: gameId, p_paths: paths })
  if (error) throw error
  return paths
}

export async function signFormPhotos(paths) {
  if (!paths?.length) return []
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  if (error) throw error
  return (data || []).map(d => d.signedUrl).filter(Boolean)
}

/** Both rosters: players.team_id OR player_teams, as {home:[], away:[]}. */
export async function getGameRosters(game) {
  const teamIds = [game.home_team_id, game.away_team_id]
  const [{ data: primary, error }, { data: links }] = await Promise.all([
    supabase.from('players').select(PLAYER_PUBLIC_COLUMNS).in('team_id', teamIds),
    supabase.from('player_teams').select('player_id,team_id').in('team_id', teamIds),
  ])
  if (error) throw error
  const byId = Object.fromEntries((primary || []).map(p => [p.id, p]))
  const missing = [...new Set((links || []).map(l => l.player_id).filter(id => !byId[id]))]
  if (missing.length) {
    const { data } = await supabase.from('players').select(PLAYER_PUBLIC_COLUMNS).in('id', missing)
    for (const p of data || []) byId[p.id] = p
  }
  const on = (tid) => {
    const ids = new Set([
      ...(primary || []).filter(p => p.team_id === tid).map(p => p.id),
      ...(links || []).filter(l => l.team_id === tid).map(l => l.player_id),
    ])
    return [...ids].map(id => byId[id]).filter(Boolean)
      .sort((a, b) => (a.position === 'Goalkeeper' ? -1 : 0) - (b.position === 'Goalkeeper' ? -1 : 0)
        || (a.jersey_number ?? 999) - (b.jersey_number ?? 999))
  }
  const home = on(game.home_team_id)
  const homeIds = new Set(home.map(p => p.id))
  // A player on both rosters counts for the home side — the server resolves it the same way.
  return { home, away: on(game.away_team_id).filter(p => !homeIds.has(p.id)) }
}

/**
 * Approve: writes the result exactly like the live game clock would (standings, market
 * settlement, suspensions served) plus own goals, clean sheets and red-card suspensions.
 */
export async function applyGameFormResult({ gameId, homeScore, awayScore, homeOwnGoals, awayOwnGoals, stats, submissionId, suspendRed }) {
  const { error } = await supabase.rpc('apply_game_form_result', {
    p_game: gameId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_home_own_goals: homeOwnGoals || 0,
    p_away_own_goals: awayOwnGoals || 0,
    p_stats: stats,
    p_submission: submissionId || null,
    p_suspend_red: suspendRed !== false,
  })
  if (error) throw error
}

/** Server messages → Hebrew. */
export function resultErrorText(e) {
  const m = e?.message || ''
  if (m.includes('already completed')) return 'התוצאה של המשחק הזה כבר הוזנה.'
  if (m.includes('not been played')) return 'המשחק עוד לא התקיים.'
  if (m.includes('exceed')) return 'מספר השערים של השחקנים (כולל שערים עצמיים) גדול מהתוצאה.'
  if (m.includes('appears twice')) return 'אותו שחקן מופיע פעמיים.'
  if (m.includes('not authorized')) return 'אין לך הרשאה להזין תוצאות. רק שופט או מנהל ליגה.'
  if (m.includes('invalid score')) return 'התוצאה חייבת להיות בין 0 ל-50.'
  if (m.includes('cancelled')) return 'המשחק בוטל.'
  return m || 'שגיאה בשמירת התוצאה'
}
