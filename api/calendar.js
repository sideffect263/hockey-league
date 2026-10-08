// Subscribable calendar feed of the current season's league games.
//
//   /api/calendar                     -> every league/playoff/friendly game
//   /api/calendar?team=בלג-בוגרים     -> one team's games (slug or UUID)
//
// Users SUBSCRIBE to this URL (webcal:// for Apple/Outlook, "From URL" in Google)
// rather than downloading a file, so a rescheduled game moves in their calendar by
// itself. That is the whole point: a one-off .ics goes silently stale the first time
// the league moves a game.
//
// Public data only, read with the anon key — the same rows /games shows a logged-out
// visitor. Tournament games are left out, as they are on /games.

import { buildIcs, CAL_NAME } from '../src/lib/ics.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

async function sb(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  })
  if (!r.ok) throw new Error(`supabase ${r.status}`)
  return r.json()
}

// Count subscribers (supabase/calendar-subscribers.sql). The RPC hashes ip+user-agent
// with a server-side salt, so the raw IP never leaves this function. Best-effort: a
// failed log must never cost anyone their calendar.
function logFetch(req, team) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '')
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/log_calendar_fetch`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_ip: ip, p_ua: String(req.headers['user-agent'] || ''), p_team: team }),
    signal: AbortSignal.timeout(1500),
  }).catch(() => {})
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  const site = `https://${req.headers.host || 'rinkhockeyil.com'}`
  const teamKey = String(req.query.team || '').trim()

  try {
    const [seasons, teams] = await Promise.all([
      sb('seasons?status=eq.active&select=id,name&limit=1'),
      sb('teams?select=id,name,slug'),
    ])
    const season = seasons[0]
    const teamsById = Object.fromEntries(teams.map(t => [t.id, t]))

    let team = null
    if (teamKey) {
      team = UUID_RE.test(teamKey)
        ? teamsById[teamKey]
        : teams.find(t => t.slug === teamKey)
      // A subscription made before a team was renamed carries the OLD slug forever —
      // calendar apps never follow redirects into a new URL. Resolve it through the
      // slug history so a rename can't silently empty someone's calendar.
      if (!team) {
        const hist = await sb(`entity_slug_history?entity_type=eq.teams&slug=eq.${encodeURIComponent(teamKey)}&select=entity_id&limit=1`).catch(() => [])
        team = hist[0] ? teamsById[hist[0].entity_id] : null
      }
      if (!team) {
        res.status(404).setHeader('Content-Type', 'text/plain; charset=utf-8')
        return res.send('team not found')
      }
    }

    let q = 'games?select=id,slug,game_date,home_team_id,away_team_id,venue,status,game_type,home_score,away_score'
      + '&tournament_id=is.null&order=game_date.asc'
    if (season) q += `&season_id=eq.${season.id}`
    if (team) q += `&or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})`
    const [games] = await Promise.all([sb(q), logFetch(req, team?.slug || '')])

    const name = [CAL_NAME, team?.name, season?.name].filter(Boolean).join(' · ')
    const body = buildIcs(games, teamsById, { name, site })

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `inline; filename="rinkhockeyil${team ? '-team' : ''}.ics"`)
    // No edge cache (no s-maxage): every poll has to reach logFetch() or the subscriber
    // count undercounts. Calendar apps poll every few hours, so the load is tiny.
    res.setHeader('Cache-Control', 'private, max-age=900')
    return res.status(200).send(body)
  } catch (e) {
    console.error('calendar feed', e)
    res.status(502).setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.send('calendar temporarily unavailable')
  }
}
