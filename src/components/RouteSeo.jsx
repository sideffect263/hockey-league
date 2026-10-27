import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  useSeo, isNoindexPath,
  organizationJsonLd, personJsonLd, teamJsonLd, sportsEventJsonLd,
} from '@/lib/seo'
import { upsertJsonLd, removeJsonLd } from '@/components/JsonLd'
import { trackPageview } from '@/lib/analytics'
import { trackPage } from '@/lib/telemetry'
import { supabase } from '@/lib/supabase'
import { isUuid } from '@/lib/slugs'

// Per-route metadata for the static pages. Detail pages (/players/:id, /teams/:id)
// call useSeo() themselves with the entity's name; because this component renders
// before <Routes>, their effect runs after this one and wins.
const ROUTES = {
  '/': { title: 'המגרש', description: 'עדכונים, תוצאות ורגעים מליגת הוקי הגלגיליות הישראלית' },
  '/standings': { title: 'טבלת הליגה', description: 'טבלת הדירוג המלאה של ליגת הוקי הגלגיליות הישראלית' },
  '/games': { title: 'משחקים', description: 'לוח המשחקים והתוצאות של ליגת הוקי הגלגיליות' },
  '/statistics': { title: 'סטטיסטיקות', description: 'מלכי השערים, כרטיסים ושערים נקיים בליגת הוקי הגלגיליות' },
  '/teams': { title: 'קבוצות', description: 'כל הקבוצות בליגת הוקי הגלגיליות הישראלית' },
  '/players': { title: 'שחקנים', description: 'כל השחקנים בליגת הוקי הגלגיליות הישראלית' },
  '/media': { title: 'מדיה', description: 'תמונות ורגעים מהמשחקים' },
  '/tournaments': { title: 'טורנירים', description: 'טורנירים לקבוצות הנוער בליגת הוקי הגלגיליות הישראלית' },
  '/app': { title: 'הורדת האפליקציה', description: 'אפליקציית הקהילה של הוקי הגלגיליות הישראלי — טבלה, משחקים וסטטיסטיקות ל-iOS ו-Android' },
  '/guide': { title: 'מדריך התכונות', description: 'כל התכונות של ליגת הוקי הגלגיליות — מסודרות לפי תפקיד ולפי פלטפורמה (אתר / אפליקציה)' },
  '/creators': { title: 'אזור יוצרי תוכן', description: 'אזור יוצרי התוכן של ליגת הוקי הגלגיליות הישראלית' },
  '/devs': { title: 'מפתחים' },
  '/archive': { title: 'ארכיון', description: 'עונות קודמות של ליגת הוקי הגלגיליות הישראלית' },
  '/privacy': { title: 'מדיניות פרטיות' },
  // Private routes. They stay noindex (isNoindexPath) — these titles are for the
  // browser tab, history and the screen-reader page announcement, which otherwise
  // fell back to the bare site name on every one of them.
  '/judge': { title: 'שולחן השופט' },
  '/me': { title: 'האזור האישי' },
  '/market': { title: 'סטופר מרקט' },
  '/admin': { title: 'ניהול' },
  '/reset-password': { title: 'איפוס סיסמה' },
}

// Single keyed <script type="application/ld+json"> managed per route.
const JSONLD_KEY = 'route'

/**
 * Collapse a detail route to its shape: /players/יואב-תורגמן → /players/:slug.
 *
 * Two reasons. A person's name in a URL is personal data and does not belong in a
 * telemetry row. And the question the dashboard answers is "which SCREENS get used",
 * which a thousand distinct player URLs actively obscures.
 */
// Shared with the iOS/Android apps' screen paths so /admin ניתוח משתמשים can compare
// platforms: ids and slugs collapse to :id, /judge/:id is /judge/game/:id, and an /admin
// tab (?tab=) is its own screen, /admin/<tab>.
function normalisePath(pathname, search = '') {
  if (pathname === '/games/next') return pathname
  if (pathname === '/admin') {
    const tab = new URLSearchParams(search).get('tab')
    return tab && /^[a-z_]{1,40}$/.test(tab) ? `/admin/${tab}` : '/admin'
  }
  return pathname
    .replace(/^\/judge\/[^/]+/, '/judge/game/:id')
    .replace(/^\/(players|teams|games|tournaments|albums|posts|market|archive)\/[^/]+/, '/$1/:id')
    .slice(0, 200)
}

export default function RouteSeo() {
  const { pathname, search } = useLocation()
  // Only the admin tab matters from the query string; other params must not re-log a view.
  const adminTab = pathname === '/admin' ? new URLSearchParams(search).get('tab') : null
  const noindex = isNoindexPath(pathname)
  const meta = ROUTES[pathname] || {}
  useSeo({ ...meta, path: pathname, noindex })

  // GA4 page_view on SPA navigation. rAF defers a frame so a detail page's own
  // useSeo() has set the real document.title before we read it. Dormant (no-op)
  // unless VITE_GA4_ID is set.
  useEffect(() => {
    const raf = requestAnimationFrame(() => trackPageview(pathname))
    // First-party page view, alongside GA4. Recorded from the same effect so the two
    // can never disagree about which routes were actually shown. The path is
    // normalised before it is stored (see normalisePath) — /players/<slug> is a
    // person's name, and the telemetry tab wants the SHAPE, not the individual.
    trackPage(normalisePath(pathname, adminTab ? `?tab=${adminTab}` : ''))
    return () => cancelAnimationFrame(raf)
  }, [pathname, adminTab])

  // Structured data: SportsOrganization on home; Person / SportsTeam /
  // SportsEvent on the detail routes. Detail entities are fetched with a small
  // anon query (a few columns) — best-effort, never blocks or breaks render.
  useEffect(() => {
    let alive = true

    if (pathname === '/') {
      upsertJsonLd(JSONLD_KEY, organizationJsonLd())
      return () => { removeJsonLd(JSONLD_KEY) }
    }

    // The route key is a Hebrew slug now, but every link shared before slugs
    // existed is still a UUID — so filter on whichever column the key is for.
    // Without this the `.eq('id', 'יואב-תורגמן')` below 400s on every slug URL
    // and the page silently loses its structured data.
    const keyed = (key) => (isUuid(key) ? ['id', key] : ['slug', decodeURIComponent(key)])

    const playerId = pathname.match(/^\/players\/([^/]+)$/)?.[1]
    const teamId = pathname.match(/^\/teams\/([^/]+)$/)?.[1]
    const gameId = pathname.match(/^\/games\/([^/]+)$/)?.[1]

    async function run() {
      try {
        if (playerId) {
          const { data: p } = await supabase
            .from('players').select('id, slug, first_name, last_name, team_id, photo_url')
            .eq(...keyed(playerId)).maybeSingle()
          if (!alive || !p) return
          let team = null
          if (p.team_id) {
            const { data } = await supabase.from('teams').select('id, slug, name').eq('id', p.team_id).maybeSingle()
            team = data
          }
          if (alive) upsertJsonLd(JSONLD_KEY, personJsonLd(p, team))
        } else if (teamId) {
          const { data: t } = await supabase
            .from('teams').select('id, slug, name, city, founded_year')
            .eq(...keyed(teamId)).maybeSingle()
          if (alive && t) upsertJsonLd(JSONLD_KEY, teamJsonLd(t))
        } else if (gameId) {
          const { data: g } = await supabase
            .from('games').select('id, slug, home_team_id, away_team_id, game_date, venue, status')
            .eq(...keyed(gameId)).maybeSingle()
          if (!alive || !g) return
          const ids = [g.home_team_id, g.away_team_id].filter(Boolean)
          const { data: ts } = ids.length
            ? await supabase.from('teams').select('id, slug, name').in('id', ids)
            : { data: [] }
          const map = Object.fromEntries((ts || []).map(t => [t.id, t]))
          if (alive) upsertJsonLd(JSONLD_KEY, sportsEventJsonLd(g, map[g.home_team_id], map[g.away_team_id]))
        }
      } catch {
        /* structured data is best-effort — a Supabase blip must never break the page */
      }
    }

    run()
    return () => { alive = false; removeJsonLd(JSONLD_KEY) }
  }, [pathname])

  return null
}
