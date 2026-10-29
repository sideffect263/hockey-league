import { supabase } from '@/lib/supabase'
import { sessionUser } from '@/lib/sessionUser'

// Feed photo posts (creator-posting.sql). The browser shrinks the photo to at most 2048px on
// its long side and re-encodes it as JPEG (a phone photo is 4-12 MB; this lands ~300-600 KB),
// then uploads it straight to the public feed-photos bucket under <uid>/.

export const MAX_FEED_PHOTO_MB = 15
const MAX_SIDE = 2048

async function shrink(file) {
  // HEIC from an iPhone only decodes in Safari; elsewhere upload it as-is.
  let bitmap
  try { bitmap = await createImageBitmap(file) } catch { return file }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.type === 'image/jpeg' && file.size < 1.5 * 1024 * 1024) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  return blob || file
}

// Resolves the photo's public URL.
export async function uploadFeedPhoto(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('not_image')
  if (file.size > MAX_FEED_PHOTO_MB * 1024 * 1024) throw new Error('photo_too_big')
  const user = await sessionUser()
  if (!user) throw new Error('not authenticated')
  const body = await shrink(file)
  const ext = body.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('feed-photos').upload(path, body, {
    contentType: body.type || file.type, cacheControl: '31536000', upsert: false,
  })
  if (error) throw new Error('upload_failed')
  return supabase.storage.from('feed-photos').getPublicUrl(path).data.publicUrl
}
