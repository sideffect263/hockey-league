import { supabase } from './supabase'

/**
 * Medical certificates (#2). A linked player uploads a photo/PDF of their yearly
 * physical to the PRIVATE 'medical' Storage bucket (path "<player_id>/<file>"); a
 * pending medical_certificates row is created; the team's coach (or an admin) views
 * it via a short-lived signed URL and approves/rejects. Files are never public —
 * only the player, their coach, and admins can read them (storage RLS).
 *
 * Approval is TWO stages (Uri, 2026-09-22):
 *   pending -> [coach checks the physical] -> pending_manager
 *           -> [league manager verifies the player is registered in פודיום] -> approved
 * Only 'approved' lets a player register for a game or be squadded, so a certificate
 * sitting in pending_manager deliberately keeps him off the sheet.
 */

/** Upload the player's physical to the private bucket + create a pending cert row. */
export async function uploadMedical(playerId, file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('not-authenticated')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
  const path = `${playerId}/${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('medical')
    .upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (upErr) throw upErr
  const { error: insErr } = await supabase
    .from('medical_certificates')
    .insert({ player_id: playerId, file_path: path, uploaded_by: user.id })
  if (insErr) {
    // roll back the orphaned upload; surface the "already pending" unique clash cleanly
    await supabase.storage.from('medical').remove([path]).catch(() => {})
    if (insErr.code === '23505') throw new Error('medical-already-pending')
    throw insErr
  }
}

/** The player's latest certificate (any status), or null. */
export async function getMyMedical(playerId) {
  if (!playerId) return null
  const { data, error } = await supabase
    .from('medical_certificates')
    .select('id,status,file_path,created_at,exam_date,expires_at')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data
}

/**
 * Which of these players currently hold an APPROVED certificate → a Set of player_ids.
 * RLS only returns rows the caller may see (their own team's players, or everything for
 * admins), so callers must still gate the *display* on being that team's coach/admin —
 * medical status is private and must not surface on the public team page.
 */
export async function getApprovedMedicalPlayerIds(playerIds) {
  const ids = (playerIds || []).filter(Boolean)
  if (!ids.length) return new Set()
  // Local calendar date, not UTC: the league runs at UTC+2/+3, so between midnight and
  // 02:00/03:00 Israel time the UTC date is still *yesterday* and an expired certificate
  // would slip through the expires_at >= today check below.
  const today = new Date().toLocaleDateString('en-CA')
  const { data, error } = await supabase
    .from('medical_certificates')
    .select('player_id')
    .in('player_id', ids)
    .eq('status', 'approved')
    // Valid = approved and not expired. Legacy rows approved before exam-date tracking
    // have a null expires_at — grandfather those as valid rather than block the player.
    .or(`expires_at.is.null,expires_at.gte.${today}`)
  if (error) return new Set()
  return new Set((data || []).map(r => r.player_id))
}

/**
 * League-manager/admin: per-player medical status summary via the medical_roster RPC
 * (privacy-safe — status/expiry only, never the file). Ordered problems-first.
 */
export async function getMedicalRoster() {
  const { data, error } = await supabase.rpc('medical_roster')
  if (error) throw error
  return data || []
}

/** Coach/admin: pending certificates joined to player + team (RLS scopes to their team). */
export async function getPendingMedical() {
  const { data, error } = await supabase
    .from('medical_certificates')
    .select('id,file_path,created_at,player_id,players(first_name,last_name,team_id,teams(name))')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Stage 1. Approve/reject via the self-gated RPC (coach-of-team, league manager or
 * admin). On approval the reviewer must pass the exam date (yyyy-mm-dd); the server
 * derives expires_at = +1 year and moves the row to 'pending_manager' — NOT to
 * 'approved'. That holds for a manager reviewing a fresh upload too, so that
 * "approved" always means somebody checked פודיום.
 */
export async function reviewMedical(id, status, examDate = null) {
  const { error } = await supabase.rpc('review_medical_certificate', {
    p_id: id, p_status: status, p_exam_date: examDate,
  })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    if (/exam date/i.test(error.message || '')) throw new Error('exam-date-required')
    throw error
  }
}

/** A short-lived signed URL to view a private medical file (120s). */
export async function signMedical(filePath) {
  const { data, error } = await supabase.storage.from('medical').createSignedUrl(filePath, 120)
  if (error) return null
  return data?.signedUrl ?? null
}

/**
 * League-manager / admin review of a specific player's certificates.
 * The roster RPC deliberately returns status only; this returns the individual files so
 * a manager can act on one — revoke it, or correct its exam date.
 */
export async function getPlayerMedicalCerts(playerId) {
  if (!playerId) return []
  const { data, error } = await supabase.rpc('player_medical_certs', { p_player: playerId })
  if (error) return []
  return data || []
}

/**
 * Revoke an approved certificate. A reason is required — the player is about to lose the
 * ability to register for games and has to know what to fix. He and his coach are both
 * notified.
 */
export async function revokeMedical(certId, reason) {
  const { error } = await supabase.rpc('revoke_medical_certificate', {
    p_id: certId, p_reason: reason || null,
  })
  if (error) {
    const m = error.message || ''
    if (/reason is required/i.test(m)) throw new Error('יש להזין סיבה לביטול')
    if (/not authorized/i.test(m)) throw new Error('אין לך הרשאה לבטל אישור רפואי')
    throw new Error('ביטול האישור נכשל')
  }
}

/** Correct the exam date; the expiry date follows it automatically (+1 year). */
export async function setMedicalExamDate(certId, examDate) {
  const { error } = await supabase.rpc('set_medical_exam_date', {
    p_id: certId, p_exam_date: examDate,
  })
  if (error) {
    const m = error.message || ''
    if (/in future/i.test(m)) throw new Error('תאריך הבדיקה לא יכול להיות עתידי')
    if (/required/i.test(m)) throw new Error('יש לבחור תאריך בדיקה')
    if (/not authorized/i.test(m)) throw new Error('אין לך הרשאה לשנות תאריך בדיקה')
    throw new Error('עדכון התאריך נכשל')
  }
}

/**
 * Stage 2 queue — certificates a coach has approved that are waiting on a league
 * manager to confirm the player is registered in פודיום. LM/admin only; a dedicated
 * RPC rather than a table read because the join to player+team is server-side.
 */
export async function getPendingManagerMedical() {
  const { data, error } = await supabase.rpc('pending_manager_medical')
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
  return data || []
}

/**
 * Stage 2 decision: finalise the certificate. The player can be registered for games
 * from here.
 *
 * There is deliberately no "not in פודיום yet" action any more — the sync answers
 * that for the whole roster continuously, so asking a manager to re-state it by hand
 * was asking her to do the mirror's job. Rejecting outright is revokeMedical(),
 * which carries a reason to the player and his coach.
 */
export async function approveMedicalPodium(certId) {
  const { error } = await supabase.rpc('approve_medical_podium', { p_id: certId })
  if (error) {
    const m = error.message || ''
    if (/not authorized/i.test(m)) throw new Error('אין לך הרשאה לאשר רישום בפודיום')
    if (/not awaiting manager/i.test(m)) throw new Error('האישור כבר טופל — רענן את הרשימה')
    throw new Error('הפעולה נכשלה')
  }
}
