// Permanent redirects from the old UUID URLs (and from superseded slugs) to the
// Hebrew slug that addresses the page today.
//
//   /players/d95bd629-92bb-46d1-b92c-60aafeebfa6c  -> 308 -> /players/יואב-תורגמן
//   /games/2026-07-11-קריית-מוצקין-נגד-בלג-נוער    -> 308 -> /games/2026-07-18-…
//
// Why this exists: every link the league has ever shared into a WhatsApp group,
// every notifications.entity_id, and everything Google has indexed is a UUID.
// Those must keep landing on the right page forever, and must consolidate onto
// one canonical URL rather than indexing twice.
//
// Only UUID-shaped paths are routed here (see vercel.json `rewrites`); a slug
// URL never touches this function and is served by the SPA directly. A game
// that gets rescheduled re-slugs and its previous slug lands in
// entity_slug_history, which is the second lookup below.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

// markets are absent on purpose: they are RLS-gated to signed-in 18+ league
// players, so the anon key here cannot read them and /market is noindex anyway.
// MarketDetail resolves its own slug client-side, with the viewer's session.
const TYPES = new Set(['players', 'teams', 'games', 'tournaments'])

async function sbOne(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!r.ok) return null
  const rows = await r.json()
  return Array.isArray(rows) ? rows[0] : rows
}

export default async function handler(req, res) {
  const type = String(req.query.type || '')
  const key = String(req.query.id || '')
  // /games/:id/tv is the same row behind a different view; carry the tail over.
  const suffix = req.query.suffix ? `/${String(req.query.suffix)}` : ''

  // Anything the caller added to the original URL (?utm_source=…) rides along.
  const passthrough = new URLSearchParams()
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k !== 'type' && k !== 'id' && k !== 'suffix') passthrough.append(k, v)
  }
  const qs = passthrough.toString()

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)

  if (TYPES.has(type) && key && SUPABASE_ANON) {
    try {
      let row = isUuid
        ? await sbOne(`${type}?id=eq.${key}&select=slug`)
        : await sbOne(`${type}?slug=eq.${encodeURIComponent(key)}&select=slug`)

      // Not a live row under that key — is it a slug this row used to have?
      if (!row?.slug && !isUuid) {
        const h = await sbOne(
          `entity_slug_history?entity_type=eq.${type}&slug=eq.${encodeURIComponent(key)}&select=entity_id`)
        if (h?.entity_id) row = await sbOne(`${type}?id=eq.${h.entity_id}&select=slug`)
      }

      // A game from an archived season is hidden from table reads by RLS; its slug
      // comes from game_any_season, so old UUID links still consolidate onto it.
      if (!row?.slug && type === 'games' && isUuid) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/game_any_season`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_game_id: key }),
        })
        if (r.ok) row = { slug: (await r.json())?.game?.slug || null }
      }

      if (row?.slug && row.slug !== key) {
        const target = `/${type}/${encodeURIComponent(row.slug)}${suffix}${qs ? `?${qs}` : ''}`
        // 308, not 302: the move is permanent, and unlike 301 it is guaranteed
        // not to rewrite a POST into a GET on the way through.
        res.setHeader('Location', target)
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
        res.status(308).end()
        return
      }
    } catch {
      /* fall through and serve the app — a Supabase blip must not 500 a link */
    }
  }

  // No slug for this row (or the lookup failed): serve the SPA at the URL the
  // visitor asked for. The UUID route still renders the page perfectly well —
  // useSlugId passes a UUID straight through — so this is a working page, not
  // an error, and must not be a redirect loop back into this function.
  await serveApp(req, res, 200)
}

// The SPA shell, fetched from this same deployment. `/` is served by the
// catch-all rewrite and cannot match the UUID rules above, so there is no loop.
async function serveApp(req, res, status) {
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const r = await fetch(`${proto}://${host}/`, { headers: { 'user-agent': 'rinkhockeyil-resolver' } })
    const html = await r.text()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.status(status).send(html)
  } catch {
    res.status(status).send('')
  }
}
