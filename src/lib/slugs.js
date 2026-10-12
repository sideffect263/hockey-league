/**
 * Hebrew URL slugs: /players/יואב-תורגמן instead of
 * /players/d95bd629-92bb-46d1-b92c-60aafeebfa6c.
 *
 * Slugs are assigned by a DB trigger (supabase/url-slugs.sql), never here —
 * players and games are also written by the native admin screens, the judge
 * flow and by hand over MCP, and app-side generation would miss all of those.
 *
 * The UUID form of every URL keeps working, forever and everywhere: thousands
 * of them are sitting in the league's WhatsApp groups, in notifications.entity_id
 * and in Google's index. On a cold load api/resolve.js 308s them to the slug;
 * in-app they simply resolve, because `useSlugId` passes a UUID straight
 * through.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (s) => UUID_RE.test(String(s ?? ''))

/**
 * The UUID a path segment starts with, or null. Some share targets glue the share
 * text onto the link (/posts/<uuid>%20⚪%20גול…), so a permalink must survive trailing junk.
 */
export const leadingUuid = (s) => (/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i.exec(String(s ?? '').trim()) || [])[1]?.toLowerCase() || null

// ---------------------------------------------------------------------------
// id -> slug, for building links
// ---------------------------------------------------------------------------
// Most link sites in the app have only an id in hand (a game_stats row's
// player_id, a game's home_team_id). Rather than thread the slug through every
// one of them, the list fetches in lib/api.js register what they loaded here,
// and entityPath() looks it up. A miss is not a bug — it falls back to the UUID
// path, which still works.
const slugById = new Map()
const idBySlug = new Map()

export function registerSlugs(type, rows) {
  if (!Array.isArray(rows)) return rows
  for (const r of rows) {
    if (!r?.id || !r.slug) continue
    slugById.set(`${type}:${r.id}`, r.slug)
    // Seeds the reverse cache too, so arriving at /players/:slug from the
    // players list resolves with no request at all.
    idBySlug.set(`${type}:${r.slug}`, r.id)
  }
  return rows
}

/**
 * Path to an entity's page. Accepts either the row (preferred — its own `slug`
 * wins) or a bare id/slug string.
 *
 *   entityPath('players', player)      -> '/players/יואב-תורגמן'
 *   entityPath('teams', game.home_team_id) -> '/teams/רמת-ישי'
 *
 * Returns null for a missing ref so callers can render inert text (see
 * EntityLinks.jsx — guest players have no page at all).
 */
export function entityPath(type, ref) {
  if (!ref) return null
  const key = typeof ref === 'string'
    ? (slugById.get(`${type}:${ref}`) || ref)
    : (ref.slug || slugById.get(`${type}:${ref.id}`) || ref.id)
  if (!key) return null
  // Percent-encoded, deliberately. location.pathname is encoded, so canonical
  // tags, og:url, the sitemap and every <Link to> have to agree on one spelling
  // of the same Hebrew URL or Google sees two pages. React Router decodes it
  // again in useParams(), and browsers show the reader plain Hebrew.
  return `/${type}/${encodeURIComponent(key)}`
}

// ---------------------------------------------------------------------------
// slug -> id, for reading a route param
// ---------------------------------------------------------------------------
/**
 * Resolves a `:id` route param that may be either a slug or a UUID down to the
 * UUID, so the page body below it stays exactly as it was — getGameById(id),
 * getGameStatsByGameId(id), getLiveGame(id) all still receive a UUID. They
 * filter with `.eq('id', …)` and would fail outright on Hebrew.
 *
 * A UUID param costs nothing (no request). A slug costs one indexed lookup,
 * memoised for the session.
 *
 * Historical slugs resolve too. A rescheduled game or a corrected name changes
 * the slug, and api/resolve.js redirects the old one on a cold load — but an
 * in-app navigation never touches the server, so we check the history table
 * here as well and land on the same page rather than a "not found".
 */
export function useSlugId(table, param) {
  const direct = isUuid(param) ? param : null
  const key = `${table}:${param}`

  const [state, setState] = useState(() => {
    if (direct) return { id: direct, loading: false, notFound: false }
    const hit = idBySlug.get(key)
    return hit
      ? { id: hit, loading: false, notFound: false }
      : { id: null, loading: true, notFound: false }
  })

  useEffect(() => {
    if (direct) { setState({ id: direct, loading: false, notFound: false }); return }
    if (!param) { setState({ id: null, loading: false, notFound: true }); return }

    const hit = idBySlug.get(key)
    if (hit) { setState({ id: hit, loading: false, notFound: false }); return }

    let alive = true
    setState({ id: null, loading: true, notFound: false })

    ;(async () => {
      try {
        const { data } = await supabase.from(table).select('id').eq('slug', param).maybeSingle()
        let id = data?.id || null

        // Old slug? markets are deliberately absent from the history table
        // (their titles are RLS-gated), so don't bother asking for those.
        if (!id && table !== 'markets') {
          const { data: h } = await supabase
            .from('entity_slug_history').select('entity_id')
            .eq('entity_type', table).eq('slug', param).maybeSingle()
          id = h?.entity_id || null
        }

        // A game from an archived season: the games RLS hides those from every table
        // read (so they stay out of standings and statistics), but its page must open.
        if (!id && table === 'games') {
          const { data: g } = await supabase.rpc('game_any_season', { p_slug: param })
          id = g?.game?.id || null
        }

        // Only successes are cached. Caching the miss would pin a page as
        // "not found" for the rest of the session even after the row appears.
        if (id) idBySlug.set(key, id)
        if (alive) setState({ id, loading: false, notFound: !id })
      } catch {
        if (alive) setState({ id: null, loading: false, notFound: true })
      }
    })()

    return () => { alive = false }
  }, [table, param, direct, key])

  return state
}
