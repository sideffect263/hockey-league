import { supabase } from "@/lib/supabase"

/**
 * A player's own photo for his card (/cards). Ariel 2026-11-11: video cutouts weren't good
 * enough — "if players want their own they will need to send". See
 * supabase/player-photo-submissions.sql for the flow: upload original (private bucket) →
 * worker removes the background → admin approves → the card shows it.
 */

const MAX_SIDE = 2000

/** Re-encode to a JPEG ≤ 2000 px: shrinks phone photos, normalises formats, drops EXIF. */
async function normalise(file) {
  let bmp
  try {
    bmp = await createImageBitmap(file) // browsers apply the EXIF rotation by default
  } catch {
    // older Safari: decode through an <img> (also applies EXIF rotation)
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); res(img) }
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("unreadable-image")) }
      img.src = url
    })
  }
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s)
  const canvas = document.createElement("canvas")
  canvas.width = w; canvas.height = h
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  if (Math.min(w, h) < 400) throw new Error("too-small")
  return await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error("unreadable-image"))), "image/jpeg", 0.9))
}

/** Every submission of this player, newest first (RLS: himself and admins). */
export async function getMyPlayerPhotos(playerId) {
  const { data, error } = await supabase
    .from("player_photo_submissions")
    .select("id,status,cutout_url,note,created_at,reviewed_at")
    .eq("player_id", playerId)
    .order("created_at", { ascending: false })
    .limit(10)
  if (error) throw error
  return data || []
}

/** Upload a new photo. An open (processing / waiting) one is withdrawn first. */
export async function submitPlayerPhoto(playerId, file) {
  const blob = await normalise(file)
  await supabase.rpc("withdraw_my_player_photo")
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${playerId}/${Date.now()}.jpg`
  const { error: upErr } = await supabase.storage
    .from("player-photos").upload(path, blob, { upsert: false, contentType: "image/jpeg" })
  if (upErr) throw upErr
  const { error } = await supabase
    .from("player_photo_submissions")
    .insert({ player_id: playerId, original_path: path, uploaded_by: user.id })
  if (error) throw error
}

export async function withdrawMyPlayerPhoto() {
  const { error } = await supabase.rpc("withdraw_my_player_photo")
  if (error) throw error
}

/** Admin: submissions with a finished cutout, waiting for a decision. */
export async function getReadyPlayerPhotos() {
  const { data, error } = await supabase
    .from("player_photo_submissions")
    .select("id,player_id,original_path,cutout_url,status,note,created_at,players(first_name,last_name,team_id)")
    .in("status", ["ready", "processing"])
    .order("created_at", { ascending: true })
  if (error) throw error
  return data || []
}

export async function signPlayerPhoto(path) {
  const { data, error } = await supabase.storage.from("player-photos").createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}

export async function reviewPlayerPhoto(id, approve, note = null) {
  const { error } = await supabase.rpc("review_player_photo", { p_id: id, p_approve: approve, p_note: note })
  if (error) throw error
}

/** player_id → approved cutout URL (public; the card prefers it over album/video cutouts). */
export async function getApprovedPlayerPhotos() {
  const { data, error } = await supabase.rpc("approved_player_photos")
  if (error) return {}
  return Object.fromEntries((data || []).map(r => [r.player_id, r.cutout_url]))
}
