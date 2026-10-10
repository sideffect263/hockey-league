import { supabase } from '@/lib/supabase'

// Feed video posts (feed-video-posts.sql). The file goes browser -> Cloudflare Stream
// directly: `feed-video-upload` (admin / content editor only) mints a one-time upload
// URL, so neither the file nor the Stream token passes through our servers.

export const MAX_FEED_VIDEO_MB = 200 // Cloudflare's limit for a basic (non-tus) upload

// width / height of a local video file, read from its metadata (no upload needed).
export function readVideoRatio(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = (r) => { URL.revokeObjectURL(url); resolve(r) }
    v.onloadedmetadata = () => done(v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : null)
    v.onerror = () => done(null)
    v.src = url
  })
}

// Upload one file; onProgress(0..1). Resolves { uid, cfCode, ratio }.
export async function uploadFeedVideo(file, onProgress = () => {}) {
  if (!file?.type?.startsWith('video/')) throw new Error('not_video')
  if (file.size > MAX_FEED_VIDEO_MB * 1024 * 1024) throw new Error('too_big')
  const ratio = await readVideoRatio(file)

  const { data, error } = await supabase.functions.invoke('feed-video-upload', { body: { name: file.name } })
  if (error || !data?.uploadURL) throw new Error(error?.context?.status === 403 ? 'forbidden' : 'upload_url_failed')

  await new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', data.uploadURL)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('upload_failed')))
    xhr.onerror = () => reject(new Error('upload_failed'))
    xhr.send(form)
  })
  onProgress(1)
  return { uid: data.uid, cfCode: data.cfCode, ratio }
}
