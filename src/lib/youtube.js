// Pure YouTube helpers (no Supabase import, so unit tests and pure libs can use them).
// Re-exported from lib/video.js, where they used to live.

// Parse a YouTube id from any common URL shape (watch?v=, youtu.be/, embed/,
// shorts/, live/) or accept a bare id. Returns null if it can't find one.
export function parseYouTubeId(input) {
  const s = (input || '').trim()
  if (!s) return null
  if (/^[\w-]{6,32}$/.test(s) && !s.includes('/')) return s
  const m = s.match(/(?:[?&]v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([\w-]{6,32})/)
  return m ? m[1] : null
}

// The first YouTube link inside free text (a post or draft body) → { id, url }, else null.
// Host-anchored on purpose: parseYouTubeId's bare `v=` match also fires on `?rev=` etc.
export function youTubeInText(text) {
  const m = (text || '').match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?\S*?\bv=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{6,32})\S*/)
  return m ? { id: m[1], url: m[0] } : null
}

// Body text with that link removed (the card shows the video instead).
export function withoutUrl(text, url) {
  if (!url) return text
  return (text || '').replace(url, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
