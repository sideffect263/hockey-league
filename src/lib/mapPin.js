/**
 * Venue map pins (venues.lat/lng): parse a pasted Google Maps / Waze link or
 * "lat, lng" and build map/navigation links. Pure — no Supabase import, so tests
 * and the API can use it.
 */

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'
const okPair = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
const pair = (a, b) => { const lat = parseFloat(a), lng = parseFloat(b); return okPair(lat, lng) ? { lat, lng } : null }

// Waze share links (waze.com/ul/hsv8tx…) carry a geohash after the "h".
const GEO32 = '0123456789bcdefghjkmnpqrstuvwxyz'
function decodeGeohash(hash) {
  let even = true, lat = [-90, 90], lng = [-180, 180]
  for (const ch of hash.toLowerCase()) {
    const v = GEO32.indexOf(ch)
    if (v < 0) return null
    for (let bit = 4; bit >= 0; bit--) {
      const r = even ? lng : lat, mid = (r[0] + r[1]) / 2
      if ((v >> bit) & 1) r[0] = mid; else r[1] = mid
      even = !even
    }
  }
  return pair(((lat[0] + lat[1]) / 2).toFixed(6), ((lng[0] + lng[1]) / 2).toFixed(6))
}

/**
 * Pasted pin → { lat, lng } | { error }. Accepts a Google Maps link (place pin
 * !3d…!4d…, @lat,lng,zoom, ?q= / query= / ll= / destination= / daddr=), a Waze link
 * (ll=lat,lng or the waze.com/ul/h<geohash> share form) or plain "lat, lng".
 * Short links (goo.gl, maps.app.goo.gl) are redirects the browser can't follow
 * cross-origin, so they return error 'short-link'.
 */
export function parseMapPin(input) {
  let s = String(input || '').trim()
  if (!s) return { error: 'empty' }
  try { s = decodeURIComponent(s) } catch { /* keep raw */ }
  s = s.replace(/\+/g, ' ')

  // Plain "lat, lng" / "lat lng".
  let m = s.match(new RegExp(`^${NUM}\\s*[,\\s]\\s*${NUM}$`))
  if (m) return pair(m[1], m[2]) || { error: 'range' }

  if (/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i.test(s)) return { error: 'short-link' }

  // Google place pin — the marker itself, so it beats the @viewport centre.
  m = s.match(new RegExp(`!3d${NUM}!4d${NUM}`))
  if (m) return pair(m[1], m[2]) || { error: 'range' }

  // Query params: Google q/query/ll/destination/daddr/center, Waze ll.
  m = s.match(new RegExp(`[?&](?:q|query|ll|destination|daddr|center|sll)=(?:loc:)?${NUM}\\s*,\\s*${NUM}`, 'i'))
  if (m) return pair(m[1], m[2]) || { error: 'range' }

  // Google @lat,lng,zoom.
  m = s.match(new RegExp(`@${NUM},${NUM}`))
  if (m) return pair(m[1], m[2]) || { error: 'range' }

  // Waze share link: waze.com/ul/h<geohash>.
  m = s.match(/waze\.com\/ul\/h([0-9a-z]{5,12})(?:[/?#]|$)/i)
  if (m) return decodeGeohash(m[1]) || { error: 'unparsed' }

  return { error: 'unparsed' }
}

export const hasPin = v => Number.isFinite(v?.lat) && Number.isFinite(v?.lng)
export const googleMapsPinUrl = v => `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`
export const googleMapsDirectionsUrl = v => `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}`
export const wazeNavigateUrl = v => `https://waze.com/ul?ll=${v.lat},${v.lng}&navigate=yes`
/** OpenStreetMap embed (no key) centred on the pin with a marker. */
export function osmEmbedUrl(v, d = 0.004) {
  const bbox = [v.lng - d, v.lat - d * 0.7, v.lng + d, v.lat + d * 0.7].map(n => n.toFixed(5)).join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${v.lat},${v.lng}`
}
