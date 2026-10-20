// Server-side Open Graph tags for detail pages, so link unfurlers (WhatsApp,
// Facebook, Twitter, Slack, …) preview the specific player / team / game instead
// of the generic league card. Only social-bot user-agents are routed here (see
// vercel.json `rewrites`); real users and JS-rendering search engines keep
// getting the normal SPA. On any miss it falls back to the league card — never
// worse than the static index.html preview.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEAGUE = 'ליגת הוקי הגלגיליות'
const YT_ID = /(?:youtube\.com\/(?:watch\?\S*?\bv=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{6,32})/
const YT_URL = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/\S*/g

/** Columns a post preview needs. Deleted posts are filtered in the query, never shown. */
export const POST_SELECT = 'id,body,image_url,link_url,source_name,external_guid,video_uid,video_cf_code,' +
  'author:profiles!posts_author_id_fkey(display_name)'

/**
 * A post's own headline: its first non-empty line, YouTube links dropped — the same
 * rule as src/lib/shareLinks.js firstLine(), which titles the SPA's /posts page, so the
 * crawler page and the rendered page carry one title. Mirrored by postTitle() in
 * src/lib/shareLinks.js — keep the two in step.
 */
export function postHeadline(body, max = 90) {
  const lines = String(body || '').split('\n').map(l => l.replace(YT_URL, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  // A first line that is only a score ("🔵 1–3") says nothing on its own — join the next one.
  let line = lines[0] || ''
  if (line.length < 24 && lines[1]) line = `${line} · ${lines[1]}`
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** The whole body as one text run (YouTube links dropped) — a video's description. */
export function postText(body) {
  return String(body || '').replace(YT_URL, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

/**
 * Preview for /posts/<id> from a posts row (POST_SELECT). Pure, so it is unit-tested.
 * title: "<author> · ליגת הוקי הגלגיליות"; description: the body's first ~160 chars;
 * image: the post's photo, else its video's thumbnail, else the league card (null here).
 */
export function postOg(p) {
  const birthday = /^birthday:/.test(p?.external_guid || '')
  const author = birthday ? 'יום הולדת שמח 🎂' : (p?.source_name || p?.author?.display_name || 'חבר/ת הליגה')
  const text = String(p?.body || '').replace(YT_URL, ' ').replace(/\s+/g, ' ').trim()
  const desc = text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : text
  const yt = YT_ID.exec(p?.link_url || '') || YT_ID.exec(p?.body || '')
  const image = p?.image_url
    || (p?.video_uid && p?.video_cf_code ? `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}/thumbnails/thumbnail.jpg?time=2s&height=720` : null)
    || (yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : null)
  return { title: `${author} · ${LEAGUE}`, desc: desc || LEAGUE, image }
}

async function sbOne(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!r.ok) return null
  const rows = await r.json()
  return Array.isArray(rows) ? rows[0] : rows
}

/** An archived-season game for the unfurl (same shape as the games select above), or null. */
async function archivedGameOg(key, isUuid) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/game_any_season`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(isUuid ? { p_game_id: key } : { p_slug: key }),
    })
    if (!r.ok) return null
    const g = (await r.json())?.game
    if (!g) return null
    const teams = await fetch(`${SUPABASE_URL}/rest/v1/teams?id=in.(${g.home_team_id},${g.away_team_id})&select=id,name,logo_url`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    }).then(x => (x.ok ? x.json() : []))
    const t = (id) => teams.find(x => x.id === id) || null
    return { ...g, home: t(g.home_team_id), away: t(g.away_team_id) }
  } catch { return null }
}

export default async function handler(req, res) {
  const type = String(req.query.type || '')
  // A post link can arrive with share text glued on (/posts/<uuid>%20⚪%20גול…) — keep the UUID.
  const rawId = String(req.query.id || '').trim()
  const lead = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i.exec(rawId)
  const id = type === 'posts' && lead ? lead[1].toLowerCase() : rawId
  // A game's sub-page (/games/<slug>/stats, /tv): same game, its own title and URL — without this the
  // shared link fell through to the SPA shell and unfurled as the home page.
  const suffix = type === 'games' && ['stats', 'tv'].includes(String(req.query.suffix || '')) ? String(req.query.suffix) : ''
  const site = `https://${req.headers.host || 'rinkhockeyil.com'}`
  const absImg = (u) => (!u ? `${site}/logos/main-logo.png` : /^https?:\/\//.test(u) ? u : `${site}${u.startsWith('/') ? '' : '/'}${u}`)

  // The key is a Hebrew slug (/players/יואב-תורגמן) for every link made since
  // slugs shipped, and a UUID for every one made before. Match on whichever
  // column it is for -- filtering the wrong one returns nothing, and a miss
  // here is silent: the unfurl just degrades to the generic league card.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const match = isUuid ? `id=eq.${id}` : `slug=eq.${encodeURIComponent(id)}`

  // Canonical is rebuilt from the row's CURRENT slug, so a bot that arrives on
  // a UUID or on a superseded slug still reports the one indexable URL.
  let pageUrl = `${site}/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
  const canonicalise = (slug) => { if (slug) pageUrl = `${site}/${encodeURIComponent(type)}/${encodeURIComponent(slug)}` }
  const withSuffix = () => { if (suffix) pageUrl += `/${suffix}` }

  // Fallback = the league card (same content as the static index.html tags).
  let title = 'ליגת הוקי הגלגיליות הישראלית'
  let desc = 'ליגת הוקי גלגיליות - טבלה, משחקים, סטטיסטיקות ועוד'
  let image = `${site}/logos/main-logo.png`

  try {
    if (SUPABASE_ANON && id) {
      if (type === 'players') {
        const p = await sbOne(`players?${match}&select=slug,first_name,last_name,goals,games_played,photo_url,team:teams!players_team_id_fkey(name,logo_url)`)
        if (p) {
          canonicalise(p.slug)
          title = `${p.first_name} ${p.last_name}`.trim()
          desc = [p.team?.name, `${p.goals || 0} שערים`, `${p.games_played || 0} משחקים`].filter(Boolean).join(' · ')
          image = absImg(p.photo_url || p.team?.logo_url)
        }
      } else if (type === 'teams') {
        const t = await sbOne(`teams?${match}&select=slug,name,city,logo_url,points,wins,losses,ties`)
        if (t) {
          canonicalise(t.slug)
          title = t.name
          desc = [t.city, `${t.points || 0} נק׳`, `${t.wins || 0}נ ${t.ties || 0}ת ${t.losses || 0}ה`].filter(Boolean).join(' · ')
          image = absImg(t.logo_url)
        }
      } else if (type === 'games' && id === 'next') {
        // The standing "sign up for your next game" link posted to team groups. Whose
        // next game it is depends on who opens it, so the preview says what it does.
        title = 'אישור הגעה למשחק הבא'
        desc = 'לחצו כדי לאשר אם אתם מגיעים למשחק הבא של הקבוצה שלכם'
      } else if (type === 'games') {
        let g = await sbOne(`games?${match}&select=slug,game_date,home_score,away_score,status,home:teams!games_home_team_id_fkey(name,logo_url),away:teams!games_away_team_id_fkey(name,logo_url)`)
        // A game from an archived season is hidden from anon table reads (RLS) — game_any_season still answers,
        // so an old game's link unfurls as that game, not as the generic league card.
        if (!g) g = await archivedGameOg(id, isUuid)
        if (g) {
          canonicalise(g.slug)
          const h = g.home?.name || 'בית', a = g.away?.name || 'חוץ'
          title = `${suffix === 'stats' ? 'סטטיסטיקות המשחק · ' : suffix === 'tv' ? 'שידור · ' : ''}${h} נגד ${a}`
          desc = g.status === 'completed' && g.home_score != null
            ? `${h} ${g.home_score} - ${g.away_score} ${a}`
            : 'משחק בליגת הוקי הגלגיליות הישראלית'
          image = absImg(g.home?.logo_url || g.away?.logo_url)
          withSuffix()
        }
      } else if (type === 'posts') {
        // Permalinks are UUID-only (no slugs). A deleted post falls back to the league card.
        if (UUID_RE.test(id)) {
          const p = await sbOne(`posts?id=eq.${id}&deleted_at=is.null&select=${POST_SELECT}`)
          if (p) {
            const og = postOg(p)
            title = og.title
            desc = og.desc
            image = absImg(og.image)
          }
        }
      } else if (type === 'tournaments') {
        const t = await sbOne(`tournaments?${match}&select=slug,name,age_group,start_date,end_date,status`)
        if (t) {
          canonicalise(t.slug)
          title = t.name
          desc = 'טורניר בליגת הוקי הגלגיליות הישראלית'
        }
      }
    }
  } catch { /* fall back to the league card */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  res.status(200).send(`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${esc(pageUrl)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="ליגת הוקי הגלגיליות הישראלית"/>
<meta property="og:locale" content="he_IL"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(pageUrl)}"/>
<meta property="og:image" content="${esc(image)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(image)}"/>
<meta http-equiv="refresh" content="0;url=${esc(pageUrl)}"/>
</head><body><a href="${esc(pageUrl)}">${esc(title)}</a></body></html>`)
}
