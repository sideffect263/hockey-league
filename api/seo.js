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
import { streamPlayer } from './sitemap.js'

class UpstreamError extends Error {}

// Types whose old slugs live in entity_slug_history (same set as resolve.js).
const SLUG_HISTORY_TYPES = new Set(['players', 'teams', 'games', 'tournaments'])

async function sb(pathAndQuery, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) throw new UpstreamError(`${r.status} ${pathAndQuery}`)
  return r.json()
}

// A game from an archived season: the games RLS hides it from table reads (so old seasons
// stay out of standings and statistics), but its page — and this crawler copy — must still
// answer. game_any_season returns the row + box score; names come from the public tables.
async function archivedGame(key) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/game_any_season`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(isUuid ? { p_game_id: key } : { p_slug: key }),
  })
  if (!r.ok) throw new UpstreamError(`${r.status} rpc/game_any_season`)
  const data = await r.json()
  if (!data?.game) return null
  const g = data.game
  const scorers = (data.stats || []).filter(st => st.goals > 0)
  const ids = [...new Set(scorers.map(st => st.player_id).filter(Boolean))]
  const [teams, players] = await Promise.all([
    sb(`teams?id=in.(${g.home_team_id},${g.away_team_id})&select=id,name,slug,logo_url`),
    ids.length ? sb(`players?id=in.(${ids.join(',')})&select=slug,id,first_name,last_name,team_id`) : [],
  ])
  const team = (id) => teams.find(t => t.id === id) || null
  const player = (id) => players.find(p => p.id === id) || null
  return {
    g: { ...g, home: team(g.home_team_id), away: team(g.away_team_id) },
    stats: scorers.map(st => ({ goals: st.goals, played_for_team_id: st.played_for_team_id, player: player(st.player_id) })),
  }
}

// Percent-encoded, matching the sitemap and the SPA's canonical — two spellings
// of one Hebrew URL read as two pages.
const path = (type, slug) => `/${type}/${encodeURIComponent(slug)}`
const link = (href, text) => `<a href="${esc(href)}">${esc(text)}</a>`
const fullName = (p) => `${p.first_name || ''} ${p.last_name || ''}`.trim()
const posHe = (pos) => (pos === 'Goalkeeper' ? 'שוער' : 'שחקן שדה')
const absImg = (u) => (u && /^https?:\/\//.test(u) ? u : null)
// A crest / photo as a real <img> with Hebrew alt text: without one on the page,
// Google Images has nothing to index and the sitemap's image entries point at
// media the page itself never shows.
const img = (src, alt, size = 96) => absImg(src) ? `<img src="${esc(src)}" alt="${esc(alt)}" width="${size}" height="${size}" loading="lazy"/>` : ''

// ─── schema.org (JSON-LD) ────────────────────────────────────────────────────
// The SPA injects the same graph client-side (src/lib/seo.js), but search bots get
// this page instead of running the SPA — so the structured data has to be here.
const ORG_REF = (site) => ({ '@type': 'SportsOrganization', '@id': `${site}/#league`, name: SITE_NAME, url: `${site}/` })
const breadcrumbs = (site, trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${p}` })),
})
/** VideoObject for a post's Cloudflare Stream video (Google video results). */
function videoLd(site, p) {
  const og = postOg(p)
  return {
    '@type': 'VideoObject', '@id': `${site}/posts/${p.id}#video`, name: (og.desc || og.title).slice(0, 100),
    description: og.desc || og.title, ...(og.image ? { thumbnailUrl: og.image } : {}),
    ...(p.created_at ? { uploadDate: p.created_at } : {}), embedUrl: streamPlayer(p), url: `${site}/posts/${p.id}`,
    publisher: ORG_REF(site),
  }
}
const teamRef = (site, t) => t ? { '@type': 'SportsTeam', name: t.name, ...(t.slug ? { url: `${site}${path('teams', t.slug)}` } : {}) } : undefined

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

function scorersHtml(g, stats, h, a) {
  const side = (st) => {
    const t = st.played_for_team_id || st.player?.team_id
    return t === g.home_team_id ? 'home' : t === g.away_team_id ? 'away' : null
  }
  const line = (st) => `<li>${st.player ? link(path('players', st.player.slug || st.player.id), fullName(st.player)) : 'שחקן'} — ${st.goals} ${st.goals === 1 ? 'שער' : 'שערים'}</li>`
  const list = (k) => stats.filter(st => side(st) === k).sort((x, y) => y.goals - x.goals).map(line).join('')
  const home = list('home'), away = list('away')
  if (!home && !away) return ''
  return `<h2>מבקיעים</h2>` + (home ? `<h3>${esc(h)}</h3><ul>${home}</ul>` : '') + (away ? `<h3>${esc(a)}</h3><ul>${away}</ul>` : '')
}

const PERIOD_HE = { '1': 'מחצית 1', '2': 'מחצית 2', 'הארכה 1': 'הארכה 1', 'הארכה 2': 'הארכה 2' }
const frameOf = (m, sec) => m?.cf_uid && m?.cf_code
  ? `https://customer-${m.cf_code}.cloudflarestream.com/${m.cf_uid}/thumbnails/thumbnail.jpg?time=${Math.max(1, Math.round(sec || 1))}s&height=720`
  : (m?.public_url || null)

// Same content as GameStory.jsx: the timeline beats, each with the frame of the clip it cites.
function storyHtml(story, media = []) {
  if (!story) return ''
  const beats = Array.isArray(story.timeline) ? story.timeline : []
  const head = `<article><h2>סיפור המשחק: ${esc(story.title)}</h2>` +
    (absImg(story.hero_image_url) ? `<figure>${img(story.hero_image_url, story.title, 1280).replace(/ height="1280"/, '')}</figure>` : '') +
    `<p><strong>${esc(story.summary)}</strong></p>`
  if (!beats.length) {
    const paras = String(story.body || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    return head + paras.map(t => `<p>${esc(t)}</p>`).join('') + `</article>`
  }
  const byId = Object.fromEntries(media.map(m => [m.id, m]))
  return head + `<ol>` + beats.map(b => {
    const when = [PERIOD_HE[b.period] || '', b.game_time || ''].filter(Boolean).join(' · ')
    const ev = (b.media || []).map(m => ({ ...m, row: byId[m.media_id] })).find(m => m.row)
    const src = ev ? frameOf(ev.row, ev.at_s ?? ev.start_s) : null
    return `<li><h3>${when ? `${esc(when)} — ` : ''}${esc(b.title || '')}</h3>` +
      (src ? `<figure>${img(src, b.title || story.title, 720).replace(/ height="720"/, '')}${ev.row.post_id ? `<figcaption>${link(`/posts/${ev.row.post_id}`, 'לצפייה בקטע')}</figcaption>` : ''}</figure>` : '') +
      `<p>${esc(b.text)}</p></li>`
  }).join('') + `</ol></article>`
}

function highlightsHtml(posts) {
  if (!posts.length) return ''
  // Video posts first, like the game page section.
  const sorted = [...posts].sort((x, y) => (y.video_uid ? 1 : 0) - (x.video_uid ? 1 : 0))
  return `<h2>היילייטס ופוסטים מהמשחק</h2><ul>${sorted.map(p => {
    const og = postOg(p)
    return `<li>${og.image ? `${img(og.image, og.desc || og.title, 160).replace(/ height="160"/, '')} ` : ''}${link(`/posts/${p.id}`, og.desc || og.title)}</li>`
  }).join('')}</ul>`
}

const TEAMS_Q = 'teams?status=eq.active&select=id,slug,name,city,wins,ties,losses,points,goals_for,goals_against&order=points.desc,goals_for.desc'

async function activeSeasonId() {
  const [s] = await sb('seasons?status=eq.active&select=id&limit=1')
  return s?.id
}

// Each builder returns { title, desc, body, canonicalPath } or null for "no such page".
const BUILDERS = {
  async home({ site }) {
    const [teams, sid] = await Promise.all([sb(TEAMS_Q), activeSeasonId()])
    const upcoming = sid ? await sb(`games?season_id=eq.${sid}&status=eq.scheduled&select=${GAME_SELECT}&order=game_date.asc&limit=8`) : []
    const recent = sid ? await sb(`games?season_id=eq.${sid}&status=eq.completed&select=${GAME_SELECT}&order=game_date.desc&limit=8`) : []
    return {
      title: SITE_NAME, desc: DEFAULT_DESC, canonicalPath: '/',
      jsonLd: [
        { ...ORG_REF(site), logo: `${site}/logos/main-logo.png`, sport: 'Roller hockey', location: { '@type': 'Country', name: 'Israel' },
          member: teams.map(t => teamRef(site, t)) },
        { '@type': 'WebSite', '@id': `${site}/#site`, name: SITE_NAME, url: `${site}/`, inLanguage: 'he-IL', publisher: { '@id': `${site}/#league` } },
      ],
      body: `<h1>${esc(SITE_NAME)}</h1>${img(`${site}/logos/main-logo.png`, SITE_NAME, 120)}<p>${esc(DEFAULT_DESC)}</p>` +
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
    const players = await sb('players?select=id,slug,first_name,last_name,goals,games_played,team:teams!players_team_id_fkey(name)&order=goals.desc,last_name.asc')
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
    const players = await sb('players?select=id,slug,first_name,last_name,goals,games_played,blue_cards,red_cards,team:teams!players_team_id_fkey(name)&order=goals.desc,last_name.asc')
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

  async player(key, match, { site }) {
    const [p] = await sb(`players?${match}&select=id,slug,first_name,last_name,jersey_number,position,goals,games_played,blue_cards,red_cards,photo_url,team:teams!players_team_id_fkey(name,slug,id,logo_url)`)
    if (!p) return null
    const name = fullName(p)
    // Past seasons (the archive's frozen per-season rows) + this season's game log —
    // the same history the player page shows, and the links that tie a player page
    // to the games it was earned in.
    const [history, log] = await Promise.all([
      sb(`player_season_stats?player_id=eq.${p.id}&select=goals,games_played,blue_cards,red_cards,team_name,season:seasons(name,slug)`),
      sb(`game_stats?player_id=eq.${p.id}&select=goals,blue_cards,red_cards,game:games(${GAME_SELECT})&limit=40`),
    ])
    const games = log.filter(r => r.game).sort((a, b) => String(b.game.game_date).localeCompare(String(a.game.game_date)))
    const facts = [p.team?.name, posHe(p.position), p.jersey_number != null ? `מספר ${p.jersey_number}` : null,
      `${p.goals || 0} שערים`, `${p.games_played || 0} משחקים`].filter(Boolean)
    const past = history.filter(h => h.season).sort((a, b) => b.season.name.localeCompare(a.season.name))
    const pastLine = past.length ? ` בעונות קודמות: ${past.map(h => `${h.season.name} — ${h.goals} שערים ב-${h.games_played} משחקים`).join('; ')}.` : ''
    const url = `${site}${path('players', p.slug || p.id)}`
    return {
      title: `${name} | ${SITE_NAME}`, canonicalPath: path('players', p.slug || p.id), image: p.photo_url, ogType: 'profile',
      desc: `${name} — ${facts.join(' · ')}.${pastLine} פרופיל שחקן בליגת הוקי הגלגיליות הישראלית.`.slice(0, 300),
      jsonLd: [
        { '@type': 'Person', '@id': `${url}#person`, name, url, ...(absImg(p.photo_url) ? { image: p.photo_url } : {}),
          jobTitle: posHe(p.position), ...(p.team ? { memberOf: teamRef(site, p.team), affiliation: ORG_REF(site) } : { affiliation: ORG_REF(site) }) },
        breadcrumbs(site, [['ראשי', '/'], ['שחקנים', '/players'], [name, path('players', p.slug || p.id)]]),
      ],
      body: `<h1>${esc(name)}</h1>` + img(p.photo_url, name, 160) +
        (p.team ? `<p>קבוצה: ${img(p.team.logo_url, `סמל ${p.team.name}`, 32)} ${link(path('teams', p.team.slug || p.team.id), p.team.name)}</p>` : '') +
        `<h2>העונה הנוכחית</h2><ul><li>עמדה: ${esc(posHe(p.position))}</li>` +
        (p.jersey_number != null ? `<li>מספר: ${esc(p.jersey_number)}</li>` : '') +
        `<li>שערים: ${p.goals || 0}</li><li>משחקים: ${p.games_played || 0}</li>` +
        `<li>כרטיסים כחולים: ${p.blue_cards || 0}</li><li>כרטיסים אדומים: ${p.red_cards || 0}</li></ul>` +
        (games.length ? `<h2>משחקים העונה</h2><ul>${games.map(r => gameLine(r.game).replace('</li>', ` — ${r.goals || 0} שערים</li>`)).join('')}</ul>` : '') +
        (past.length ? `<h2>עונות קודמות</h2><ul>${past.map(h => `<li>${link(`/archive/${encodeURIComponent(h.season.slug || '')}`, `עונת ${h.season.name}`)} — ${esc(h.team_name || '')}: ${h.goals} שערים, ${h.games_played} משחקים, ${h.blue_cards || 0} כחולים, ${h.red_cards || 0} אדומים</li>`).join('')}</ul>` : ''),
    }
  },

  async team(key, match, { site }) {
    const [t] = await sb(`teams?${match}&status=eq.active&select=id,slug,name,city,home_venue,founded_year,logo_url,wins,ties,losses,points,goals_for,goals_against`)
    if (!t) return null
    const [roster, games, history] = await Promise.all([
      sb(`players?team_id=eq.${t.id}&select=id,slug,first_name,last_name,jersey_number,position,goals&order=goals.desc,last_name.asc`),
      sb(`games?or=(home_team_id.eq.${t.id},away_team_id.eq.${t.id})&select=${GAME_SELECT}&order=game_date.desc&limit=30`),
      sb(`team_season_stats?team_id=eq.${t.id}&select=final_rank,points,wins,ties,losses,goals_for,goals_against,season:seasons(name,slug)`),
    ])
    const url = `${site}${path('teams', t.slug || t.id)}`
    const past = history.filter(h => h.season).sort((a, b) => b.season.name.localeCompare(a.season.name))
    return {
      title: `${t.name} | ${SITE_NAME}`, canonicalPath: path('teams', t.slug || t.id), image: t.logo_url,
      desc: `${t.name}${t.city ? ` (${t.city})` : ''} — ${t.points} נק׳, ${t.wins} ניצחונות, ${t.ties} תיקו, ${t.losses} הפסדים. סגל, משחקים ותוצאות.`,
      jsonLd: [
        { '@type': 'SportsTeam', '@id': `${url}#team`, name: t.name, url, sport: 'Roller hockey',
          ...(absImg(t.logo_url) ? { logo: t.logo_url, image: t.logo_url } : {}),
          ...(t.city ? { location: { '@type': 'Place', name: t.home_venue || t.city, address: { '@type': 'PostalAddress', addressLocality: t.city, addressCountry: 'IL' } } } : {}),
          ...(t.founded_year ? { foundingDate: String(t.founded_year) } : {}),
          memberOf: ORG_REF(site),
          athlete: roster.map(p => ({ '@type': 'Person', name: fullName(p), url: `${site}${path('players', p.slug || p.id)}` })) },
        breadcrumbs(site, [['ראשי', '/'], ['קבוצות', '/teams'], [t.name, path('teams', t.slug || t.id)]]),
      ],
      body: `<h1>${esc(t.name)}</h1>` + img(t.logo_url, `סמל ${t.name}`, 128) +
        `<ul>${[t.city && `עיר: ${t.city}`, t.home_venue && `אולם בית: ${t.home_venue}`, t.founded_year && `נוסדה: ${t.founded_year}`,
          `נקודות: ${t.points}`, `מאזן: ${t.wins}-${t.ties}-${t.losses}`, `שערים: ${t.goals_for}:${t.goals_against}`]
          .filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` +
        (roster.length ? `<h2>סגל</h2><ul>${roster.map(p => `<li>${link(path('players', p.slug || p.id), fullName(p))}` +
          ` — ${esc([p.jersey_number != null ? `#${p.jersey_number}` : null, posHe(p.position), `${p.goals || 0} שערים`].filter(Boolean).join(' · '))}</li>`).join('')}</ul>` : '') +
        (games.length ? `<h2>משחקים</h2><ul>${games.map(gameLine).join('')}</ul>` : '') +
        (past.length ? `<h2>עונות קודמות</h2><ul>${past.map(h => `<li>${link(`/archive/${encodeURIComponent(h.season.slug || '')}`, `עונת ${h.season.name}`)} — מקום ${h.final_rank}, ${h.points} נק׳ (${h.wins}-${h.ties}-${h.losses}), שערים ${h.goals_for}:${h.goals_against}</li>`).join('')}</ul>` : ''),
    }
  },

  async game(key, match, { site }) {
    let [g] = await sb(`games?${match}&select=${GAME_SELECT},home_team_id,away_team_id,home_logo:teams!games_home_team_id_fkey(logo_url),away_logo:teams!games_away_team_id_fkey(logo_url)`)
    let stats
    if (!g) {
      const old = await archivedGame(key)
      if (!old) return null
      ;({ g, stats } = old)
    }
    // Same facts as the game page: the box score (a loaned player counts for the side he
    // played for) and "היילייטס ופוסטים מהמשחק" — which is also how Google finds /posts/<id>.
    const [liveStats, posts, [story]] = await Promise.all([
      stats ? null : sb(`game_stats?game_id=eq.${g.id}&goals=gt.0&select=goals,played_for_team_id,player:players(slug,id,first_name,last_name,team_id)`),
      sb(`posts?game_id=eq.${g.id}&deleted_at=is.null&select=${POST_SELECT},created_at&order=created_at.desc&limit=20`),
      // סיפור המשחק — published only (anon RLS), the same text GameStory.jsx shows.
      sb(`game_stories?game_id=eq.${g.id}&status=eq.published&select=title,summary,body,moments,timeline,hero_image_url,published_at,updated_at`),
    ])
    stats = stats || liveStats
    // The timeline's evidence: the public media its beats cite (frames shown beside each beat).
    const citedIds = [...new Set((story?.timeline || []).flatMap(b => (b.media || []).map(m => m.media_id)).filter(id => /^[0-9a-f-]{36}$/i.test(id)))]
    const citedMedia = citedIds.length ? await sb(`game_media?id=in.(${citedIds.join(',')})&is_public=eq.true&select=id,kind,cf_uid,cf_code,public_url,post_id`) : []
    const h = g.home?.name || 'בית', a = g.away?.name || 'חוץ'
    const hLogo = g.home_logo?.logo_url || g.home?.logo_url, aLogo = g.away_logo?.logo_url || g.away?.logo_url
    const played = g.status === 'completed' && g.home_score != null
    const headline = played ? `${h} ${g.home_score} - ${g.away_score} ${a}` : `${h} נגד ${a}`
    const when = [fmtDate(g.game_date), g.venue].filter(Boolean).join(', ')
    const url = `${site}${path('games', g.slug || g.id)}`
    const videos = posts.filter(p => streamPlayer(p))
    return {
      title: `${headline} | ${SITE_NAME}`, canonicalPath: path('games', g.slug || g.id),
      image: absImg(story?.hero_image_url) || postOg(videos[0] || {}).image || absImg(hLogo),
      desc: story?.summary || `${played ? 'תוצאת המשחק' : 'משחק'} ${h} נגד ${a}${when ? ` — ${when}` : ''}${g.game_type ? ` (${g.game_type})` : ''}.`,
      ogType: story ? 'article' : 'website',
      jsonLd: [
        { '@type': 'SportsEvent', '@id': `${url}#event`, name: `${h} נגד ${a}`, url, sport: 'Roller hockey',
          ...(g.game_date ? { startDate: g.game_date } : {}),
          eventStatus: g.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: { '@type': 'Place', name: g.venue || h, address: { '@type': 'PostalAddress', addressCountry: 'IL', ...(g.venue ? { addressLocality: g.venue } : {}) } },
          homeTeam: teamRef(site, g.home), awayTeam: teamRef(site, g.away),
          competitor: [teamRef(site, g.home), teamRef(site, g.away)].filter(Boolean),
          organizer: ORG_REF(site),
          ...(absImg(hLogo) ? { image: [hLogo, absImg(aLogo)].filter(Boolean) } : {}),
          description: played ? `תוצאה סופית: ${h} ${g.home_score}, ${a} ${g.away_score}` : `${h} נגד ${a}${when ? `, ${when}` : ''}` },
        ...videos.map(p => videoLd(site, p)),
        ...(story ? [{
          '@type': 'NewsArticle', '@id': `${url}#story`, headline: story.title.slice(0, 110), description: story.summary,
          articleBody: story.body, inLanguage: 'he-IL', url, mainEntityOfPage: url,
          datePublished: story.published_at || story.updated_at, dateModified: story.updated_at,
          ...(absImg(story.hero_image_url) ? { image: [story.hero_image_url] } : {}),
          about: { '@id': `${url}#event` }, author: ORG_REF(site), publisher: { ...ORG_REF(site), logo: { '@type': 'ImageObject', url: `${site}/logos/main-logo.png` } },
        }] : []),
        breadcrumbs(site, [['ראשי', '/'], ['משחקים', '/games'], [`${h} נגד ${a}`, path('games', g.slug || g.id)]]),
      ],
      body: `<h1>${esc(headline)}</h1><p>${img(hLogo, `סמל ${h}`, 64)} ${img(aLogo, `סמל ${a}`, 64)}</p><ul>` +
        (g.home ? `<li>בית: ${link(path('teams', g.home.slug), h)}</li>` : '') +
        (g.away ? `<li>חוץ: ${link(path('teams', g.away.slug), a)}</li>` : '') +
        (when ? `<li>${esc(when)}</li>` : '') + (g.game_type ? `<li>סוג: ${esc(g.game_type)}</li>` : '') + `</ul>` +
        storyHtml(story, citedMedia) + scorersHtml(g, stats, h, a) + highlightsHtml(posts),
    }
  },

  // A post permalink (/posts/<uuid>). UUID-only, never a deleted post; same words as
  // the SPA card and the og.js unfurl — plus its photo or video, which is what makes
  // it eligible for Images / video results.
  async post(key, _match, { site }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return null
    const [p] = await sb(`posts?id=eq.${key}&deleted_at=is.null&select=${POST_SELECT},created_at,updated_at,external_guid,game:games(slug,id)`)
    if (!p) return null
    const og = postOg(p)
    const paras = String(p.body || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    const player = streamPlayer(p)
    const url = `${site}/posts/${p.id}`
    const media = player
      ? `<figure><iframe src="${esc(player)}" title="${esc(og.desc || og.title)}" width="640" height="360" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>` +
        (og.image ? `<noscript>${img(og.image, og.desc || og.title, 640)}</noscript>` : '') + `</figure>`
      : (absImg(p.image_url) ? `<figure>${img(p.image_url, og.desc || og.title, 640).replace(/ height="640"/, '')}</figure>` : '')
    return {
      title: og.title, desc: og.desc, image: og.image, canonicalPath: `/posts/${p.id}`, ogType: player ? 'video.other' : 'article',
      jsonLd: [
        player ? videoLd(site, p) : {
          '@type': 'SocialMediaPosting', '@id': `${url}#post`, url, headline: (og.desc || og.title).slice(0, 110),
          ...(p.body ? { articleBody: p.body } : {}), datePublished: p.created_at, dateModified: p.updated_at || p.created_at,
          ...(absImg(og.image) ? { image: og.image } : {}), author: { '@type': 'Organization', name: og.title.split(' · ')[0] }, publisher: ORG_REF(site),
        },
        breadcrumbs(site, [['ראשי', '/'], ['המגרש', '/'], [og.title.split(' · ')[0], `/posts/${p.id}`]]),
      ],
      body: `<article><h1>${esc(og.title)}</h1>${media}${paras.map(t => `<p>${esc(t)}</p>`).join('')}` +
        (p.game ? `<p>${link(path('games', p.game.slug || p.game.id), 'לעמוד המשחק')}</p>` : '') + `</article>`,
    }
  },

  // /archive/<slug> — one finished season: final table, scorers, every game.
  async archiveSeason(key, match, { site }) {
    const [s] = await sb(`seasons?${match}&status=eq.archived&select=id,slug,name,starts_on,ends_on`)
    if (!s) return null
    const [standings, scorers, games, carded] = await Promise.all([
      sb(`team_season_stats?season_id=eq.${s.id}&select=team_name,team_id,final_rank,points,wins,ties,losses,goals_for,goals_against&order=final_rank.asc`),
      sb(`player_season_stats?season_id=eq.${s.id}&goals=gt.0&select=player_id,first_name,last_name,team_name,goals,games_played&order=goals.desc&limit=30`),
      sb('rpc/season_games_detail', { method: 'POST', body: JSON.stringify({ p_season_id: s.id }) }),
      sb(`player_season_stats?season_id=eq.${s.id}&or=(blue_cards.gt.0,red_cards.gt.0)&select=player_id,first_name,last_name,team_name,blue_cards,red_cards&order=red_cards.desc,blue_cards.desc&limit=10`),
    ])
    const ids = [...new Set([...scorers, ...carded].map(p => p.player_id).filter(Boolean))]
    const slugs = ids.length ? Object.fromEntries((await sb(`players?id=in.(${ids.join(',')})&select=id,slug`)).map(p => [p.id, p.slug])) : {}
    const teamSlug = {}
    for (const g of games) { teamSlug[g.home_team_id] = g.home_team_slug; teamSlug[g.away_team_id] = g.away_team_slug }
    const champ = standings[0]
    const played = games.filter(g => g.status === 'completed' && g.home_score != null)
    const canonicalPath = `/archive/${encodeURIComponent(s.slug || s.id)}`
    const line = (g) => {
      const t = g.status === 'completed' && g.home_score != null ? `${g.home_team_name} ${g.home_score} - ${g.away_score} ${g.away_team_name}` : `${g.home_team_name} נגד ${g.away_team_name}`
      const meta = [fmtDate(g.game_date), g.venue, g.playoff_round || g.game_type].filter(Boolean).join(' · ')
      return `<li>${g.slug ? link(path('games', g.slug), t) : esc(t)}${meta ? ` — ${esc(meta)}` : ''}</li>`
    }
    return {
      title: `עונת ${s.name} — טבלה סופית ותוצאות | ${SITE_NAME}`, canonicalPath,
      desc: `עונת ${s.name} בליגת הוקי הגלגיליות הישראלית${champ ? `: האלופה ${champ.team_name} (${champ.points} נק׳)` : ''}${scorers[0] ? `, מלך השערים ${fullName(scorers[0])} (${scorers[0].goals})` : ''}. טבלה סופית, ${played.length} משחקים ותוצאות.`,
      jsonLd: [
        { '@type': 'SportsEvent', '@id': `${site}${canonicalPath}#season`, name: `${SITE_NAME} — עונת ${s.name}`, url: `${site}${canonicalPath}`, sport: 'Roller hockey',
          ...(s.starts_on ? { startDate: s.starts_on } : {}), ...(s.ends_on ? { endDate: s.ends_on } : {}),
          eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: { '@type': 'Country', name: 'Israel' }, organizer: ORG_REF(site),
          subEvent: played.filter(g => g.slug).map(g => ({ '@type': 'SportsEvent', name: `${g.home_team_name} נגד ${g.away_team_name}`, url: `${site}${path('games', g.slug)}`, startDate: g.game_date })) },
        breadcrumbs(site, [['ראשי', '/'], ['ארכיון', '/archive'], [`עונת ${s.name}`, canonicalPath]]),
      ],
      body: `<h1>עונת ${esc(s.name)}</h1>` +
        (champ ? `<p>האלופה: ${teamSlug[champ.team_id] ? link(path('teams', teamSlug[champ.team_id]), champ.team_name) : esc(champ.team_name)}</p>` : '') +
        `<h2>טבלה סופית</h2><table><thead><tr><th>#</th><th>קבוצה</th><th>נק׳</th><th>נ</th><th>ת</th><th>ה</th><th>שערים</th></tr></thead><tbody>` +
        standings.map(t => `<tr><td>${t.final_rank}</td><td>${teamSlug[t.team_id] ? link(path('teams', teamSlug[t.team_id]), t.team_name) : esc(t.team_name)}</td><td>${t.points}</td><td>${t.wins}</td><td>${t.ties}</td><td>${t.losses}</td><td>${t.goals_for}:${t.goals_against}</td></tr>`).join('') +
        `</tbody></table>` +
        (scorers.length ? `<h2>מלכי השערים</h2><ol>${scorers.map(p => `<li>${slugs[p.player_id] ? link(path('players', slugs[p.player_id]), fullName(p)) : esc(fullName(p))} (${esc(p.team_name)}) — ${p.goals} שערים ב-${p.games_played} משחקים</li>`).join('')}</ol>` : '') +
        (carded.length ? `<h2>כרטיסים</h2><ol>${carded.map(p => `<li>${slugs[p.player_id] ? link(path('players', slugs[p.player_id]), fullName(p)) : esc(fullName(p))} (${esc(p.team_name)}) — ${p.blue_cards || 0} כחולים, ${p.red_cards || 0} אדומים</li>`).join('')}</ol>` : '') +
        (played.length ? `<h2>סטטיסטיקות העונה</h2><ul><li>משחקים: ${played.length}</li><li>שערים: ${played.reduce((n, g) => n + g.home_score + g.away_score, 0)}</li>` +
          `<li>ממוצע שערים למשחק: ${(played.reduce((n, g) => n + g.home_score + g.away_score, 0) / played.length).toFixed(1)}</li></ul>` : '') +
        (games.length ? `<h2>כל המשחקים</h2><ul>${games.map(line).join('')}</ul>` : ''),
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
const DETAIL_BUILDERS = { players: 'player', teams: 'team', games: 'game', tournaments: 'tournament', posts: 'post', archive: 'archiveSeason' }

const NAV = `<nav>${[['/', 'ראשי'], ['/standings', 'טבלה'], ['/games', 'משחקים'], ['/teams', 'קבוצות'],
  ['/players', 'שחקנים'], ['/statistics', 'סטטיסטיקות'], ['/tournaments', 'טורנירים']]
  .map(([h, t]) => link(h, t)).join(' | ')}</nav>`

function render(site, { title, desc, body, canonicalPath, image, jsonLd, ogType = 'website' }, { noindex = false } = {}) {
  const url = `${site}${canonicalPath || '/'}`
  const ogImg = image && /^https?:\/\//.test(image) ? image : `${site}/logos/main-logo.png`
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
${noindex ? '<meta name="robots" content="noindex"/>' : `<link rel="canonical" href="${esc(url)}"/>`}
<meta property="og:type" content="${esc(ogType)}"/>
<meta property="og:site_name" content="${esc(SITE_NAME)}"/>
<meta property="og:locale" content="he_IL"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${esc(ogImg)}"/>
${!noindex && jsonLd ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [].concat(jsonLd) }).replace(/</g, '\\u003c')}</script>` : ''}
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
      data = await BUILDERS[PAGE_BUILDERS[page]]({ site })
    } else if (DETAIL_BUILDERS[type] && id) {
      // Slug for every link since slugs shipped; UUIDs are 308'd by resolve.js
      // before reaching here, but match either so a miss can't come from that.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      const match = isUuid ? `id=eq.${id}` : `slug=eq.${encodeURIComponent(id)}`
      data = await BUILDERS[DETAIL_BUILDERS[type]](id, match, { site })
    }
    // A superseded slug (renamed player/team, rescheduled game) — resolve.js redirects these
    // for people, but bots are rewritten straight here, so without this an old link Google
    // already knows would 404 and drop out instead of moving to the new URL.
    if (!data && DETAIL_BUILDERS[type] && id && SLUG_HISTORY_TYPES.has(type)) {
      const h = await sb(`entity_slug_history?entity_type=eq.${type}&slug=eq.${encodeURIComponent(id)}&select=entity_id`)
      const row = h[0]?.entity_id
        ? (await sb(`${type}?id=eq.${h[0].entity_id}&select=slug`))[0]
        : null
      if (row?.slug && row.slug !== id) {
        res.setHeader('Location', `/${type}/${encodeURIComponent(row.slug)}`)
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
        return res.status(308).end()
      }
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
