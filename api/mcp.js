// MCP server for the league — lets Claude, ChatGPT, Cursor etc. answer questions like
// "מתי יש משחק קרוב לבית לחם הגלילית?" from live league data.
//
//   https://rinkhockeyil.com/api/mcp     (add as a custom connector / remote MCP server)
//
// Streamable-HTTP transport in STATELESS mode: every POST is one JSON-RPC message (or a
// batch) answered with plain JSON. No sessions, no SSE, no SDK — the handful of methods
// a read-only server needs is smaller than the dependency would be.
//
// Public data only, read with the anon key — the same rows a logged-out visitor sees on
// the site, so RLS is the privacy boundary. Never put the service key here, and never
// select players(*) (birth_date is revoked from anon; a wildcard 403s the whole request).

import { mcpLandingHtml } from './_mcp-landing.js'

const SUPABASE_URL =process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SITE = 'https://rinkhockeyil.com'
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

// The rinks. venues has no coordinates, and there are four of them, so they live here.
// Keys are games.venue / venues.name exactly. A venue missing from this map still shows
// up in results, just without a distance.
const VENUE_COORDS = {
  'קריית ביאליק': { lat: 32.8275, lng: 35.0858 },
  'קריית מוצקין': { lat: 32.8375, lng: 35.0775 },
  'גבעת עדה': { lat: 32.5215, lng: 35.0010 },
  'בית לחם': { lat: 32.7354, lng: 35.1905 },
}

async function sb(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!r.ok) throw new Error(`supabase ${r.status}`)
  return r.json()
}

const teamsCache = { at: 0, rows: null }
async function getTeams() {
  if (teamsCache.rows && Date.now() - teamsCache.at < 60_000) return teamsCache.rows
  const rows = await sb('teams?select=id,name,city,home_venue,slug,wins,losses,ties,points,goals_for,goals_against,status,is_test&status=eq.active')
  teamsCache.rows = rows.filter(t => !t.is_test)
  teamsCache.at = Date.now()
  return teamsCache.rows
}

// Loose Hebrew/English match: "בלג" finds both בלג teams, "רמת ישי" finds רמת ישי.
const norm = s => String(s || '').toLowerCase().replace(/["'״׳\-\s]+/g, '')
function matchTeams(teams, q) {
  if (!q) return null
  const n = norm(q)
  return teams.filter(t => norm(t.name).includes(n) || norm(t.slug).includes(n) || n.includes(norm(t.name)))
}

function km(a, b) {
  const R = 6371, rad = d => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const fmtDate = iso => new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

const GAME_COLS = 'id,slug,game_date,venue,status,game_type,home_team_id,away_team_id,home_score,away_score,is_test'

function shapeGame(g, byId, origin) {
  const home = byId[g.home_team_id], away = byId[g.away_team_id]
  const out = {
    when: fmtDate(g.game_date),
    starts_at: g.game_date,
    home: home?.name || null,
    away: away?.name || null,
    venue: g.venue || null,
    type: g.game_type,
    url: `${SITE}/games/${g.slug || g.id}`,
  }
  if (g.status === 'completed') out.score = `${home?.name} ${g.home_score} – ${g.away_score} ${away?.name}`
  const c = VENUE_COORDS[g.venue]
  if (origin && c) out.distance_km = Math.round(km(origin, c))
  return out
}

// ── tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'upcoming_games',
    description:
      'Upcoming games of the Israeli rink-hockey league (ליגת הוקי גלגיליות, rinkhockeyil.com): date and time (Israel time), teams, rink and a link. ' +
      'To find games NEAR A PLACE ("קרוב לבית לחם הגלילית", "near Haifa"), pass that place\'s latitude/longitude as near_lat/near_lng — ' +
      'each game then has a straight-line distance_km and rinks_by_distance lists the rinks nearest first. Games are always in date order. ' +
      'Optionally filter by team name (Hebrew, partial is fine).',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team name or part of it, e.g. "רמת ישי", "בלג"' },
        near_lat: { type: 'number', description: 'Latitude of the place the user asks about' },
        near_lng: { type: 'number', description: 'Longitude of the place the user asks about' },
        max_km: { type: 'number', description: 'Only rinks within this many km of near_lat/near_lng' },
        days: { type: 'integer', description: 'How many days ahead to look (default 60)', minimum: 1, maximum: 365 },
        limit: { type: 'integer', description: 'Max games to return (default 10)', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'recent_results',
    description: 'Latest final scores of the Israeli rink-hockey league, newest first. Optionally for one team.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team name or part of it' },
        limit: { type: 'integer', description: 'Max games (default 10)', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'standings',
    description: 'Current league table of the Israeli rink-hockey league: points, wins, ties, losses, goals for/against.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'top_scorers',
    description: 'Leading goal scorers of the Israeli rink-hockey league, with team and games played.',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Only this team' },
        limit: { type: 'integer', description: 'How many (default 10)', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'rinks',
    description: 'The rinks (מגרשים) where league games are played, which teams are based at each, and their location.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const clampInt = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? Math.floor(+v) : d))

async function teamFilter(args) {
  const teams = await getTeams()
  const byId = Object.fromEntries(teams.map(t => [t.id, t]))
  const picked = matchTeams(teams, args.team)
  if (picked && !picked.length) {
    return { error: `לא נמצאה קבוצה בשם "${args.team}". הקבוצות: ${teams.map(t => t.name).join(', ')}` }
  }
  return { teams, byId, picked }
}

const handlers = {
  async upcoming_games(args) {
    const { error, byId, picked } = await teamFilter(args)
    if (error) return { error }
    const days = clampInt(args.days, 60, 1, 365)
    const limit = clampInt(args.limit, 10, 1, 50)
    const now = new Date(), until = new Date(now.getTime() + days * 864e5)
    let q = `games?select=${GAME_COLS}&status=eq.scheduled&is_test=is.false&tournament_id=is.null` +
      `&game_date=gte.${now.toISOString()}&game_date=lte.${until.toISOString()}&order=game_date.asc&limit=200`
    if (picked) {
      const ids = picked.map(t => t.id).join(',')
      q += `&or=(home_team_id.in.(${ids}),away_team_id.in.(${ids}))`
    }
    const rows = await sb(q)
    const origin = Number.isFinite(args.near_lat) && Number.isFinite(args.near_lng)
      ? { lat: args.near_lat, lng: args.near_lng } : null
    let games = rows.map(g => shapeGame(g, byId, origin))
    // Stays in date order even with a location: "when is a game near me" wants the
    // soonest one, and every rink is within an hour of every other — sorting by
    // distance buried this Saturday's game under November's.
    if (origin && Number.isFinite(args.max_km)) games = games.filter(g => g.distance_km == null || g.distance_km <= args.max_km)
    const rinksByDistance = origin
      ? Object.entries(VENUE_COORDS).map(([name, c]) => ({ name, distance_km: Math.round(km(origin, c)) }))
        .filter(r => rows.some(g => g.venue === r.name))
        .sort((a, b) => a.distance_km - b.distance_km)
      : undefined
    return {
      games: games.slice(0, limit),
      rinks_by_distance: rinksByDistance,
      note: origin ? 'distance_km is straight-line, not driving distance.' : undefined,
      calendar: `${SITE}/api/calendar${picked?.length === 1 ? `?team=${encodeURIComponent(picked[0].slug)}` : ''}`,
    }
  },

  async recent_results(args) {
    const { error, byId, picked } = await teamFilter(args)
    if (error) return { error }
    const limit = clampInt(args.limit, 10, 1, 50)
    let q = `games?select=${GAME_COLS}&status=eq.completed&is_test=is.false&order=game_date.desc&limit=${limit}`
    if (picked) {
      const ids = picked.map(t => t.id).join(',')
      q += `&or=(home_team_id.in.(${ids}),away_team_id.in.(${ids}))`
    }
    const rows = await sb(q)
    return { games: rows.map(g => shapeGame(g, byId, null)) }
  },

  async standings() {
    const teams = await getTeams()
    const table = [...teams]
      .sort((a, b) => b.points - a.points || (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against) || b.goals_for - a.goals_for)
      .map((t, i) => ({
        rank: i + 1, team: t.name, points: t.points, played: t.wins + t.ties + t.losses,
        wins: t.wins, ties: t.ties, losses: t.losses,
        goals_for: t.goals_for, goals_against: t.goals_against, url: `${SITE}/teams/${t.slug}`,
      }))
    return { table, url: `${SITE}/standings` }
  },

  async top_scorers(args) {
    const { error, byId, picked } = await teamFilter(args)
    if (error) return { error }
    const limit = clampInt(args.limit, 10, 1, 50)
    let q = 'players?select=first_name,last_name,jersey_number,team_id,goals,games_played,slug' +
      `&goals=gt.0&is_referee=is.false&order=goals.desc,games_played.asc&limit=${limit}`
    if (picked) q += `&team_id=in.(${picked.map(t => t.id).join(',')})`
    const rows = await sb(q)
    return {
      scorers: rows.map((p, i) => ({
        rank: i + 1, player: `${p.first_name} ${p.last_name}`.trim(), number: p.jersey_number,
        team: byId[p.team_id]?.name || null, goals: p.goals, games: p.games_played,
        url: `${SITE}/players/${p.slug}`,
      })),
    }
  },

  async rinks() {
    const teams = await getTeams()
    const venues = await sb('venues?select=name,is_active&is_active=eq.true')
    return {
      rinks: venues.map(v => ({
        name: v.name,
        ...(VENUE_COORDS[v.name] || {}),
        home_teams: teams.filter(t => t.home_venue === v.name).map(t => t.name),
      })),
    }
  },
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid Request')
  const isNotification = msg.id === undefined
  const { method, params = {} } = msg

  if (method.startsWith('notifications/')) return null
  if (isNotification) return null

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rinkhockeyil', title: 'ליגת הוקי גלגיליות', version: '1.0.0' },
        instructions:
          'Live data for the Israeli rink-hockey league (rinkhockeyil.com). Answer in the user\'s language. ' +
          'For "games near <place>", look up that place\'s coordinates yourself and pass them to upcoming_games. ' +
          'Always include the game link so the user can open it.',
      })
    }
    case 'ping':
      return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS })
    case 'tools/call': {
      const fn = handlers[params.name]
      if (!fn) return fail(msg.id, -32602, `Unknown tool: ${params.name}`)
      try {
        const data = await fn(params.arguments || {})
        const isError = Boolean(data?.error)
        return ok(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          structuredContent: data,
          isError,
        })
      } catch (e) {
        console.error('[mcp]', params.name, e)
        return ok(msg.id, { content: [{ type: 'text', text: 'שגיאה בקריאת נתוני הליגה, נסו שוב.' }], isError: true })
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${method}`)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()

  // Stateless: no server-initiated stream to open.
  if (req.method === 'GET') {
    const accept = String(req.headers.accept || '')
    // Same URL answers HTML or JSON by Accept — never let the CDN hand one to the other.
    res.setHeader('Vary', 'Accept')
    res.setHeader('Cache-Control', 'no-store')
    if (accept.includes('text/event-stream')) return res.status(405).end()
    // Anyone not explicitly asking for JSON gets the how-to-connect page — browsers,
    // and link-preview bots (WhatsApp sends Accept: */*, and got the JSON before).
    if (!accept.includes('application/json') || accept.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(mcpLandingHtml({ endpoint: `${SITE}/api/mcp`, site: SITE, tools: TOOLS.map(t => t.name) }))
    }
    return res.status(200).json({
      name: 'rinkhockeyil MCP', endpoint: `${SITE}/api/mcp`,
      tools: TOOLS.map(t => t.name),
      howto: 'Add this URL as a custom connector (remote MCP server) in Claude, ChatGPT or Cursor.',
    })
  }
  if (req.method !== 'POST') return res.status(405).end()

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return res.status(400).json(fail(null, -32700, 'Parse error')) }
  }

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handleMessage))).filter(Boolean)
    return out.length ? res.status(200).json(out) : res.status(202).end()
  }
  const out = await handleMessage(body)
  return out ? res.status(200).json(out) : res.status(202).end()
}
