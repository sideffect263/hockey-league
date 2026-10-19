// Resized copies of Supabase Storage images (Image Transformations, Pro plan): avatars average
// ~0.5 MB (one is 2.8 MB) and crests up to 1.2 MB, but are drawn at 20–96 px. The render
// endpoint serves a resized WebP/AVIF instead, cached on the CDN.
//
// Only our own public Storage URLs are rewritten; Google/Apple profile photos, blob: previews
// and anything else pass through untouched. Sizes snap to a few buckets so every list shares
// the same cached copy. Billing counts distinct ORIGINAL images per month (100 included).

const OBJECT = '/storage/v1/object/public/'
const RENDER = '/storage/v1/render/image/public/'
const BUCKETS = [96, 192, 512]
// Stored URLs name the project host; new uploads name the custom domain.
const OUR_HOSTS = ['.supabase.co', 'api.rinkhockeyil.com']

// css px → a resized URL drawn crisply at 2x. fit: 'cover' (square crop, avatars) or
// 'contain' (whole image kept, transparent crests).
export function sizedImage(url, cssPx, fit = 'cover') {
  if (!url || typeof url !== 'string' || !OUR_HOSTS.some((h) => url.includes(h + OBJECT))) return url
  const want = Math.ceil(cssPx * 2)
  const px = BUCKETS.find((b) => b >= want) ?? BUCKETS[BUCKETS.length - 1]
  const [base, query] = url.split('?')
  const params = new URLSearchParams(query || '') // keep a cache-buster (?v=…) if the URL has one
  params.set('width', px)
  params.set('height', px)
  params.set('resize', fit)
  params.set('quality', '80')
  return base.replace(OBJECT, RENDER) + '?' + params.toString()
}
