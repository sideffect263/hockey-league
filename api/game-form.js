// /api/game-form — the filled refereeing form (טופס שיפוט, .xlsx) for the native apps.
//
// The web builds the form in the browser (src/components/GameFormExport.jsx). The iOS and
// Android apps ask here instead, so they run the SAME code — src/lib/gameForm/* — and a fix
// to the form reaches all three without a mobile release.
//
//   GET  /api/game-form?game=<uuid>               → JSON: the dialog's defaults
//   POST /api/game-form  { game, fields }          → the .xlsx (fields override the defaults)
//
// Both need `Authorization: Bearer <the user's Supabase access token>`. Every read is made
// with a Supabase client carrying that token, so RLS and the definer RPCs decide exactly as
// they do for the web page. The gate is game_report_officials, which raises 'not authorized'
// for anyone but admin / league manager / judge / coach of either team — the same set the web
// shows the export button to. No service key is involved.

import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { fetchGamePage, fetchGameFormSources } from '../src/lib/gameForm/sources.js'
import { defaultFormFields, guestEntries, buildReport, gameFormFilename } from '../src/lib/gameForm/report.js'
import { buildGameForm } from '../src/lib/gameForm/buildGameForm.js'

// The form prints the game's date, weekday and start time, and the filename carries the date.
// Those are formatted in local time — the browser's on the web; here it has to be the league's.
process.env.TZ = 'Asia/Jerusalem'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SITE = process.env.PUBLIC_SITE_URL || 'https://rinkhockeyil.com'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The dialog's free-text fields a caller may override. Anything else (timeouts, coach
// options, the fouls' provenance) stays what the server derived.
const TEXT_FIELDS = ['medic', 'extraReferee', 'observer', 'halftimeHome', 'halftimeAway', 'homeFouls', 'awayFouls',
  'homeCoach', 'awayCoach', 'homeCaptain', 'awayCaptain', 'refereeNotes']
const MAX_FIELD = 500

const json = (res, status, body) => res.status(status).json(body)

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    if (!chunks.length) return null
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch { return null }
}

/** The league logo for the title band — from the bundle, else the site; none rather than no form. */
async function leagueLogo() {
  try {
    return new Uint8Array(await readFile(new URL('../public/logos/main-logo.png', import.meta.url)))
  } catch { /* not bundled — fall through */ }
  try {
    const r = await fetch(`${SITE}/logos/main-logo.png`, { signal: AbortSignal.timeout(4000) })
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null
  } catch { return null }
}

/** Overlay the caller's edits on the defaults: known keys only, as trimmed strings. */
export function mergeFields(defaults, overrides, guests) {
  const out = { ...defaults }
  if (!overrides || typeof overrides !== 'object') return out
  for (const k of TEXT_FIELDS) {
    const v = overrides[k]
    if (v == null) continue
    if (typeof v !== 'string' && typeof v !== 'number') continue
    out[k] = String(v).slice(0, MAX_FIELD)
  }
  const ids = new Set(guests.map(g => String(g.id)))
  const sides = overrides.guestTeams && typeof overrides.guestTeams === 'object' ? overrides.guestTeams : {}
  out.guestTeams = { ...defaults.guestTeams }
  for (const [id, side] of Object.entries(sides)) {
    if (ids.has(id) && (side === 'home' || side === 'away')) out.guestTeams[id] = side
  }
  return out
}

/** RFC 6266: an ASCII fallback plus the real (Hebrew) name. */
const contentDisposition = (name) =>
  `attachment; filename="game-form.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return json(res, 405, { ok: false, reason: 'method-not-allowed' })
    }
    if (!SUPABASE_ANON) return json(res, 501, { ok: false, reason: 'not-configured' })
    res.setHeader('Cache-Control', 'no-store')

    const auth = req.headers?.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json(res, 401, { ok: false, reason: 'unauthorized' })

    const body = req.method === 'POST' ? await readBody(req) : null
    const gameId = String((req.method === 'POST' ? body?.game : req.query?.game) || '')
    if (!UUID.test(gameId)) return json(res, 400, { ok: false, reason: 'invalid' })

    const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    // The gate (see header). A bad/expired token is a 401 from PostgREST before any of that.
    const gate = await client.rpc('game_report_officials', { p_game_id: gameId })
    if (gate.status === 401) return json(res, 401, { ok: false, reason: 'unauthorized' })
    if (gate.error) return json(res, 403, { ok: false, reason: 'forbidden' })

    const page = await fetchGamePage(client, gameId)
    if (!page) return json(res, 404, { ok: false, reason: 'not-found' })
    const { game, home, away, players, stats, refereeName } = page
    if (game.status !== 'completed') return json(res, 409, { ok: false, reason: 'not-completed' })

    const sources = await fetchGameFormSources(client, gameId)
    const defaults = defaultFormFields({
      game, stats, officials: sources.officials, refereeName, reportRow: sources.reportRow, home, away, players,
    })
    const guests = guestEntries(stats)
    const filename = gameFormFilename({ game, home, away })

    if (req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        game: {
          id: game.id,
          game_date: game.game_date,
          home: { id: home?.id || null, name: home?.name || '' },
          away: { id: away?.id || null, name: away?.name || '' },
        },
        fields: defaults,
        guests: guests.map(g => ({ id: g.id, name: g.name, from: g.from })),
        signatures: Object.keys(sources.signatures || {}).length,
        filename,
      })
    }

    const fields = mergeFields(defaults, body?.fields, guests)
    const report = buildReport({
      game, home, away, players, stats,
      squad: sources.squad || [],
      memberships: sources.memberships || [],
      officials: sources.officials || [],
      refereeName,
      fields,
      signatures: sources.signatures || {},
    })
    const bytes = buildGameForm({ ...report, logo: await leagueLogo() })

    res.setHeader('Content-Type', XLSX_MIME)
    res.setHeader('Content-Disposition', contentDisposition(filename))
    res.setHeader('Content-Length', String(bytes.length))
    return res.status(200).send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  } catch (err) {
    console.error('game-form: unhandled error', err?.message || err)
    return json(res, 500, { ok: false, reason: 'error' })
  }
}
