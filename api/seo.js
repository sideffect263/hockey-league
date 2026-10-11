// Server-rendered pages for SEARCH crawlers (Googlebot, Bing, …).
//
// Why this exists: every route of the SPA returns the same ~4KB shell — one
// title, one description, no text. Search Console showed 113 of ~120 sitemap
// URLs "discovered, not crawled": from the raw HTML they are all the same empty
// page. seo.js fixes the head only after JS runs, and Google does not spend a
// render on a small new site's URLs that look like duplicates.
//
// So search bots (routed here by user-agent in vercel.json) get real HTML: the
// page's own title/description/canonical, and the same facts a visitor sees —
// names, stats, scores — plus plain links, which is how Google finds the rest
// of the site. Content must stay equivalent to the SPA page (anything else is
// cloaking); this is a text rendering of it, not a different page.
//
// Social unfurlers keep going to og.js — that one ends in a meta refresh, which
// to a search engine reads as a redirect loop onto itself.
//
// Failure modes: an unknown slug is a 404 (+ noindex) so dead URLs drop out; a
// Supabase error is a 503, which Google retries, rather than a 404, which it
// would believe.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SITE_NAME = 'ליגת הוקי הגלגיליות הישראלית'
const DEFAULT_DESC = 'ליגת הוקי הגלגיליות הישראלית — טבלת הליגה המעודכנת, תוצאות ולוח משחקים, סטטיסטיקות שחקנים וקבוצות, שידורים חיים, גלריית תמונות וטורנירים. כל מה שקורה במגרש, במקום אחד.'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

import { postOg, POST_SELECT } from './og.js'

class UpstreamError extends Error {}

async function sb(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!r.ok) throw new UpstreamError(`${r.status} ${pathAndQuery}`)
  return r.json()
}

// Percent-encoded, matching the sitemap and the SPA's canonical — two spellings
// of one Hebrew URL read as two pages.
const path = (type, slug) => `/${type}/${encodeURIComponent(slug)}`
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`
const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim()
const posHe = (pos) => (pos === 'Goalkeeper' ? 'שוער' : 'שחקן שדה')

const fmtDate = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' })
  } catch { return '' }
}

const GAME_SELECT = 'slug,id,game_date,venue,status,game_type,home_score,away_score,' +
  'home:teams!games_home_team_id_fkey(name,slug),away:teams!games_away_team_id_fkey(name,slug)'

function gameLine(g) {
  const h = g.home?.name || 'בית', a = g.away?.name || 'חוץ'
  const played = g.status === 'completed' && g.home_score != null
  const text = played ? `${h} ${g.home_score} - ${g.away_score} ${a}` : `${h} נגד ${a}`
  const meta = [fmtDate(g.game_date), g.venue, g.game_type].filter(Boolean).join(' · ')
  return `<li>${link(path('games', g.slug || g.id), text)}${meta ? ` — ${esc(meta)}` : ''}</li>`
}

function standingsTable(teams) {
  const rows = teams.map((t, i) => `<tr><td>${i + 1}</td><td>${link(path('teams', t.slug || t.id), t.name)}</td>` +
    `<td>${t.wins + t.ties + t.losses}</td><td>${t.wins}</td><td>${t.ties}</td><td>${t.losses}</td>` +
    `<td>${t.goals_for}:${t.goals_against}</td><td>${t.points}</td></tr>`).join('')
  return `<table><thead><tr><th>#</th><th>קבוצה</th><th>מש׳</th><th>נ</th><th>ת</th><th>ה</th><th>שערים</th><th>נק׳</th></tr></thead><tbody>${rows}</tbody></table>`
}

const TEAMS_Q = 'teams?status=eq.active&select=id,slug,name,city,wins,ties,losses,points,goals_for,goals_against&order=points.desc,goals_for.desc'

async function activeSeasonId() {
  const [s] = await sb('seasons?status=eq.active&select=id&limit=1')
  return s?.id
}

// Each builder returns { title, desc, body, canonicalPath } or null for "no such page".
const BUILDERS = {
  async home() {
    const [teams, sid] = await Promise.all([sb(TEAMS_Q), activeSeasonId()])
    const upcoming = sid ? await sb(`games?season_id=eq.${sid}&status=eq.scheduled&select=${GAME_SELECT}&order=game_date.asc&limit=8`) : []
    const recent = sid ? await sb(`games?season_id=eq.${sid}&status=eq.completed&select=${GAME_SELECT}&order=game_date.desc&limit=8`) : []
    return {
      title: SITE_NAME, desc: DEFAULT_DESC, canonicalPath: '/',
      body: `<h1>${esc(SITE_NAME)}</h1><p>${esc(DEFAULT_DESC)}</p>` +
        `<h2>טבלת הליגה</h2>${standingsTable(teams)}` +
        (recent.length ? `<h2>תוצאות אחרונות</h2><ul>${recent.map(gameLine).join('')}</ul>` : '') +
        (upcoming.length ? `<h2>המשחקים הבאים</h2><ul>${upcoming.map(gameLine).join('')}</ul>` : ''),
    }
  },

  async standings() {
    const teams = await sb(TEAMS_Q)
    return {
      title: `טבלת הליגה | ${SITE_NAME}`, canonicalPath: '/standings',
      desc: `טבלת ליגת הוקי הגלגיליות הישראלית: ${teams.slice(0, 3).map(t => `${t.name} ${t.points} נק׳`).join(', ')}.`,
      body: `<h1>טבלת הליגה</h1>${standingsTable(teams)}`,
    }
  },

  async teams() {
    const teams = await sb(TEAMS_Q)
    return {
      title: `הקבוצות | ${SITE_NAME}`, canonicalPath: '/teams',
      desc: `${teams.length} הקבוצות בליגת הוקי הגלגיליות הישראלית: ${teams.map(t => t.name).join(', ')}.`,
      body: `<h1>הקבוצות</h1><ul>${teams.map(t => `<li>${link(path('teams', t.slug || t.id), t.name)}${t.city ? ` — ${esc(t.city)}` : ''}</li>`).join('')}</ul>`,
    }
  },

  async players() {
    const players = await sb('players?select=id,slug,first_name,last_name,goals,games_played,team:teams(name)&order=goals.desc,last_name.asc')
    return {
      title: `השחקנים | ${SITE_NAME}`, canonicalPath: '/players',
      desc: `כל ${players.length} השחקנים בליגת הוקי הגלגיליות הישראלית — שערים, משחקים וקבוצה.`,
      body: `<h1>השחקנים</h1><ul>${players.map(p => `<li>${link(path('players', p.slug || p.id), fullName(p))}` +
        ` — ${esc([p.team?.name, `${p.goals || 0} שערים`, `${p.games_played || 0} משחקים`].filter(Boolean).join(' · '))}</li>`).join('')}</ul>`,
    }
  },

  async gamesList() {
    const sid = await activeSeasonId()
    const games = sid ? await sb(`games?season_id=eq.${sid}&select=${GAME_SELECT}&order=game_date.asc`) : []
    return {
      title: `משחקים ותוצאות | ${SITE_NAME}`, canonicalPath: '/games',
      desc: 'לוח המשחקים והתוצאות של ליגת הוקי הגלגיליות הישראלית בעונה הנוכחית.',
      body: `<h1>משחקים ותוצאות</h1><ul>${games.map(gameLine).join('')}</ul>`,
    }
  },

  async statistics() {
    const players = await sb('players?select=id,slug,first_name,last_name,goals,games_played,blue_cards,red_cards,team:teams(name)&order=goals.desc,last_name.asc')
    const row = (p, stat) => `<li>${link(path('players', p.slug || p.id), fullName(p))}${p.team?.name ? ` (${esc(p.team.name)})` : ''} — ${esc(stat)}</li>`
    const scorers = players.filter(p => p.goals > 0).slice(0, 20)
    const cards = players.filter(p => (p.blue_cards || 0) + (p.red_cards || 0) > 0)
      .sort((a, b) => (b.red_cards - a.red_cards) || (b.blue_cards - a.blue_cards)).slice(0, 10)
    return {
      title: `סטטיסטיקות | ${SITE_NAME}`, canonicalPath: '/statistics',
      desc: `מלכי השערים והכרטיסים בליגת הוקי הגלגיליות הישראלית${scorers[0] ? ` — מוביל: ${fullName(scorers[0])}, ${scorers[0].goals} שערים` : ''}.`,
      body: `<h1>סטטיסטיקות</h1>` +
        `<h2>מלכי השערים</h2><ol>${scorers.map(p => row(p, `${p.goals} שערים ב-${p.games_played || 0} משחקים`)).join('')}</ol>` +
        (cards.length ? `<h2>כרטיסים</h2><ol>${cards.map(p => row(p, `${p.blue_cards || 0} כחולים, ${p.red_cards || 0} אדומים`)).join('')}</ol>` : ''),
    }
  },

  async tournamentsList() {
    const ts = await sb('tournaments?select=id,slug,name,start_date,end_date&order=start_date.desc.nullslast')
    return {
      title: `טורנירים | ${SITE_NAME}`, canonicalPath: '/tournaments',
      desc: 'טורנירים לקבוצות הנוער בליגת הוקי הגלגיליות הישראלית.',
      body: `<h1>טורנירים</h1>` + (ts.length
        ? `<ul>${ts.map(t => `<li>${link(path('tournaments', t.slug || t.id), t.name)}` +
            `${t.start_date ? ` — ${esc([fmtDate(t.start_date), fmtDate(t.end_date)].filter(Boolean).join(' – '))}` : ''}</li>`).join('')}</ul>`
        : '<p>אין טורנירים כרגע.</p>'),
    }
  },

  async archive() {
    const seasons = await sb('seasons?status=eq.archived&select=id,slug,name&order=ends_on.desc.nullslast')
    const sections = await Promise.all(seasons.map(async (s) => {
      const [standings, scorers] = await Promise.all([
        sb(`team_season_stats?season_id=eq.${s.id}&select=team_name,final_rank,points,wins,ties,losses&order=final_rank.asc`),
        sb(`player_season_stats?season_id=eq.${s.id}&goals=gt.0&select=first_name,last_name,team_name,goals&order=goals.desc&limit=10`),
      ])
      return `<section><h2>${link(`/archive/${encodeURIComponent(s.slug || s.id)}`, `עונת ${s.name}`)}</h2>` +
        (standings.length ? `<h3>טבלה סופית</h3><ol>${standings.map(t => `<li>${esc(t.team_name)} — ${t.points} נק׳ (${t.wins}-${t.ties}-${t.losses})</li>`).join('')}</ol>` : '') +
        (scorers.length ? `<h3>מלכי השערים</h3><ol>${scorers.map(p => `<li>${esc(fullName(p))} (${esc(p.team_name)}) — ${p.goals} שערים</li>`).join('')}</ol>` : '') +
        `</section>`
    }))
    return {
      title: `ארכיון | ${SITE_NAME}`, canonicalPath: '/archive',
      desc: `עונות קודמות של ליגת הוקי הגלגיליות הישראלית${seasons.length ? `: ${seasons.map(s => s.name).join(', ')}` : ''} — טבלאות סופיות ומלכי שערים.`,
      body: `<h1>ארכיון העונות</h1>${sections.join('') || '<p>אין עונות בארכיון.</p>'}`,
    }
  },

  // Static pages: the SPA's own title + description (RouteSeo.jsx), so the bot
  // copy and the rendered page agree.
  async guide() {
    const desc = 'כל התכונות של ליגת הוקי הגלגיליות — מסודרות לפי תפקיד ולפי פלטפורמה (אתר / אפליקציה)'
    return { title: `מדריך התכונות | ${SITE_NAME}`, canonicalPath: '/guide', desc, body: `<h1>מדריך התכונות</h1><p>${esc(desc)}</p>` }
  },
  async app() {
    const desc = 'אפליקציית הקהילה של הוקי הגלגיליות הישראלי — טבלה, משחקים וסטטיסטיקות ל-iOS ו-Android'
    return { title: `הורדת האפליקציה | ${SITE_NAME}`, canonicalPath: '/app', desc, body: `<h1>הורדת האפליקציה</h1><p>${esc(desc)}</p>` }
  },
  async privacy() {
    return { title: `מדיניות פרטיות | ${SITE_NAME}`, canonicalPath: '/privacy', desc: `מדיניות הפרטיות של ${SITE_NAME}.`, body: '<h1>מדיניות פרטיות</h1>' }
  },

  async player(key, match) {
    const [p] = await sb(`players?${match}&select=id,slug,first_name,last_name,jersey_number,position,goals,games_played,blue_cards,red_cards,photo_url,team:teams(name,slug,id)`)
    if (!p) return null
    const name = fullName(p)
    const facts = [p.team?.name, posHe(p.position), p.jersey_number != null ? `מספר ${p.jersey_number}` : null,
      `${p.goals || 0} שערים`, `${p.games_played || 0} משחקים`].filter(Boolean)
    return {
      title: `${name} | ${SITE_NAME}`, canonicalPath: path('players', p.slug || p.id), image: p.photo_url,
      desc: `${name} — ${facts.join(' · ')}. פרופיל שחקן בליגת הוקי הגלגיליות הישראלית.`,
      body: `<h1>${esc(name)}</h1>` +
        (p.team ? `<p>קבוצה: ${link(path('teams', p.team.slug || p.team.id), p.team.name)}</p>` : '') +
        `<ul><li>עמדה: ${esc(posHe(p.position))}</li>` +
        (p.jersey_number != null ? `<li>מספר: ${esc(p.jersey_number)}</li>` : '') +
        `<li>שערים: ${p.goals || 0}</li><li>משחקים: ${p.games_played || 0}</li>` +
        `<li>כרטיסים כחולים: ${p.blue_cards || 0}</li><li>כרטיסים אדומים: ${p.red_cards || 0}</li></ul>`,
    }
  },

  async team(key, match) {
    const [t] = await sb(`teams?${match}&status=eq.active&select=id,slug,name,city,home_venue,founded_year,logo_url,wins,ties,losses,points,goals_for,goals_against`)
    if (!t) return null
    const [roster, games] = await Promise.all([
      sb(`players?team_id=eq.${t.id}&select=id,slug,first_name,last_name,jersey_number,position,goals&order=goals.desc,last_name.asc`),
      sb(`games?or=(home_team_id.eq.${t.id},away_team_id.eq.${t.id})&select=${GAME_SELECT}&order=game_date.desc&limit=30`),
    ])
    return {
      title: `${t.name} | ${SITE_NAME}`, canonicalPath: path('teams', t.slug || t.id), image: t.logo_url,
      desc: `${t.name}${t.city ? ` (${t.city})` : ''} — ${t.points} נק׳, ${t.wins} ניצחונות, ${t.ties} תיקו, ${t.losses} הפסדים. סגל, משחקים ותוצאות.`,
      body: `<h1>${esc(t.name)}</h1>` +
        `<ul>${[t.city && `עיר: ${t.city}`, t.home_venue && `אולם בית: ${t.home_venue}`, t.founded_year && `נוסדה: ${t.founded_year}`,
          `נקודות: ${t.points}`, `מאזן: ${t.wins}-${t.ties}-${t.losses}`, `שערים: ${t.goals_for}:${t.goals_against}`]
          .filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` +
        (roster.length ? `<h2>סגל</h2><ul>${roster.map(p => `<li>${link(path('players', p.slug || p.id), fullName(p))}` +
          ` — ${esc([p.jersey_number != null ? `#${p.jersey_number}` : null, posHe(p.position), `${p.goals || 0} שערים`].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : '') +
        (games.length ? `<h2>משחקים</h2><ul>${games.map(gameLine).join('')}</ul>` : ''),
    }
  },

  async game(key, match) {
    const [g] = await sb(`games?${match}&select=${GAME_SELECT}`)
    if (!g) return null
    const h = g.home?.name || 'בית', a = g.away?.name || 'חוץ'
    const played = g.status === 'completed' && g.home_score != null
    const headline = played ? `${h} ${g.home_score} - ${g.away_score} ${a}` : `${h} נגד ${a}`
    const when = [fmtDate(g.game_date), g.venue].filter(Boolean).join(', ')
    return {
      title: `${headline} | ${SITE_NAME}`, canonicalPath: path('games', g.slug || g.id),
      desc: `${played ? 'תוצאת המשחק' : 'משחק'} ${h} נגד ${a}${when ? ` — ${when}` : ''}${g.game_type ? ` (${g.game_type})` : ''}.`,
      body: `<h1>${esc(headline)}</h1><ul>` +
        (g.home ? `<li>בית: ${link(path('teams', g.home.slug), h)}</li>` : '') +
        (g.away ? `<li>חוץ: ${link(path('teams', g.away.slug), a)}</li>` : '') +
        (when ? `<li>${esc(when)}</li>` : '') + (g.game_type ? `<li>סוג: ${esc(g.game_type)}</li>` : '') + `</ul>`,
    }
  },

  // A post permalink (/posts/<uuid>). UUID-only, never a deleted post; same words as
  // the SPA card and the og.js unfurl.
  async post(key) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return null
    const [p] = await sb(`posts?id=eq.${key}&deleted_at=is.null&select=${POST_SELECT}`)
    if (!p) return null
    const og = postOg(p)
    const paras = String(p.body || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    return {
      title: og.title, desc: og.desc, image: og.image, canonicalPath: `/posts/${p.id}`,
      body: `<article><h1>${esc(og.title)}</h1>${paras.map(t => `<p>${esc(t)}</p>`).join('')}</article>`,
    }
  },

  async tournament(key, match) {
    const [t] = await sb(`tournaments?${match}&select=id,slug,name,age_group,start_date,end_date,status`)
    if (!t) return null
    const dates = [fmtDate(t.start_date), fmtDate(t.end_date)].filter(Boolean).join(' – ')
    return {
      title: `${t.name} | ${SITE_NAME}`, canonicalPath: path('tournaments', t.slug || t.id),
      desc: `${t.name} — טורניר בליגת הוקי הגלגיליות הישראלית${dates ? `, ${dates}` : ''}.`,
      body: `<h1>${esc(t.name)}</h1>${dates ? `<p>${esc(dates)}</p>` : ''}`,
    }
  },
}

const PAGE_BUILDERS = {
  home: 'home', standings: 'standings', teams: 'teams', players: 'players', games: 'gamesList',
  statistics: 'statistics', tournaments: 'tournamentsList', archive: 'archive', guide: 'guide', app: 'app', privacy: 'privacy',
}
const DETAIL_BUILDERS = { players: 'player', teams: 'team', games: 'game', tournaments: 'tournament', posts: 'post' }

const NAV = `<nav>${[['/', 'ראשי'], ['/standings', 'טבלה'], ['/games', 'משחקים'], ['/teams', 'קבוצות'],
  ['/players', 'שחקנים'], ['/statistics', 'סטטיסטיקות'], ['/tournaments', 'טורנירים']]
  .map(([h, t]) => link(h, t)).join(' | ')}</nav>`

function render(site, { title, desc, body, canonicalPath, image }, { noindex = false } = {}) {
  const url = `${site}${canonicalPath || '/'}`
  const img = image && /^https?:\/\//.test(image) ? image : `${site}/logos/main-logo.png`
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
${noindex ? '<meta name="robots" content="noindex"/>' : `<link rel="canonical" href="${esc(url)}"/>`}
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="${esc(SITE_NAME)}"/>
<meta property="og:locale" content="he_IL"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${esc(img)}"/>
</head><body>
<header>${link('/', SITE_NAME)}</header>
${NAV}
<main>${body}</main>
</body></html>`
}

export default async function handler(req, res) {
  const site = `https://${req.headers.host || 'rinkhockeyil.com'}`
  const page = String(req.query.page || '')
  const type = String(req.query.type || '')
  // A post link can arrive with share text glued on (/posts/<uuid>%20⚪%20גול…) — keep the UUID.
  const rawId = String(req.query.id || '').trim()
  const lead = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/i.exec(rawId)
  const id = type === 'posts' && lead ? lead[1].toLowerCase() : rawId

  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  try {
    let data
    if (PAGE_BUILDERS[page]) {
      data = await BUILDERS[PAGE_BUILDERS[page]]()
    } else if (DETAIL_BUILDERS[type] && id) {
      // Slug for every link since slugs shipped; UUIDs are 308'd by resolve.js
      // before reaching here, but match either so a miss can't come from that.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      const match = isUuid ? `id=eq.${id}` : `slug=eq.${encodeURIComponent(id)}`
      data = await BUILDERS[DETAIL_BUILDERS[type]](id, match)
    }
    if (!data) {
      res.setHeader('Cache-Control', 's-maxage=300')
      return res.status(404).send(render(site, { title: `הדף לא נמצא | ${SITE_NAME}`, desc: DEFAULT_DESC, body: '<h1>הדף לא נמצא</h1>' }, { noindex: true }))
    }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).send(render(site, data))
  } catch (e) {
    console.error('seo render failed', e)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '600')
    return res.status(503).send(render(site, { title: SITE_NAME, desc: DEFAULT_DESC, body: '' }, { noindex: true }))
  }
}
