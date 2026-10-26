#!/usr/bin/env node
// Game-day In-App Events on the App Store, kept in step with the league schedule (Ariel 2026-10-26:
// automatic, no per-event approval). One event per game DAY: "יום משחקים בליגה", card art =
// card.html (design approved 26.10) with that day's matchups and crests.
//
//   node scripts/store-events/store-events.mjs            # dry run: prints the plan, changes nothing
//   node scripts/store-events/store-events.mjs --apply    # does it (the launchd agent passes this)
//   … --only 2026-11-07   limit to one game day        … --render-only   just write the PNGs
//   … --lead 14 (override LEAD_DAYS)   … --no-submit (create as a private draft only — for testing)
//
// THE RULES (from Apple: https://developer.apple.com/help/app-store-connect/offer-in-app-events/manage-events)
//  - approved, not yet showing → dates editable, deletable;  showing → only start/end editable,
//    NOT deletable;  in review → nothing editable.  So: submit LEAD_DAYS ahead (review ≈ 1 day),
//    but only SHOW it from the Tuesday before — most changes land while it can still be fixed.
//  - The art and texts carry no date/time/score (Apple shows the date; art can't change once live).
//  - Our events are found by referenceName "game-day YYYY-MM-DD #<fingerprint>". The fingerprint
//    is the day's matchups: if they change before the event shows, it is deleted and remade.
//  - NEVER submit a review submission that holds anything but our own events (an app version
//    may be waiting in one — submitting it would send the app to review).
//  - Ariel hears about it only when it needs him (alert() → 📣 notification to his account).
//
// Needs: ~/.appstoreconnect/private_keys/AuthKey_23CGB7K85Q.p8 (App Store Connect API key),
// .env with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (schedule is public data) and
// SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (management API, only to insert the alert row),
// Google Chrome (renders the art). Installed as a launchd agent by install-store-events-agent.sh.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createSign, createHash, createPrivateKey } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const APPLY = args.includes('--apply'), RENDER_ONLY = args.includes('--render-only')
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null)
const ONLY = arg('--only')
const NO_SUBMIT = args.includes('--no-submit') // testing: create as a draft, don't send to review

const APP_ID = '6789331513'
const KEY_ID = '23CGB7K85Q', ISSUER = '4b121613-df31-439b-a6b9-e6fc6b164732'
const KEY_PATH = path.join(os.homedir(), '.appstoreconnect/private_keys/AuthKey_23CGB7K85Q.p8')
const ARIEL = 'a25014f6-a0e6-4b5c-8bc4-b5ee83e108c9' // alerts go to this account only
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TZ = 'Asia/Jerusalem'
const LEAD_DAYS = +(process.argv.includes('--lead') ? process.argv[process.argv.indexOf('--lead') + 1] : 12) // create + submit this many days before the first game
const MIN_LEAD_HOURS = 30     // too close for review: don't start a new one
const GAME_MINUTES = 105      // last kick-off + this = event end
const OUT = path.join(HERE, 'out')
const PREFIX = 'game-day '

const TEXT = {
  he: { name: 'יום משחקים בליגה', shortDescription: 'כל משחקי היום בשידור חי באפליקציה',
        longDescription: 'משחקי ליגת הוקי גלגיליות: תוצאות בזמן אמת, שידור חי ולוח התוצאה מכל משחק.' },
  'en-US': { name: 'League game day', shortDescription: 'Every game of the day, live in the app',
        longDescription: "Israel's rink hockey league: live scores, live streams and the score bar from every game." },
}
for (const t of Object.values(TEXT)) if (t.name.length > 30 || t.shortDescription.length > 50 || t.longDescription.length > 120) throw new Error('event text over Apple limits')

// ---------- env ----------
async function loadEnv() {
  const env = { ...process.env }
  for (const f of [path.join(HERE, '.env'), path.join(HERE, '../../.env')]) {
    if (!existsSync(f)) continue
    for (const line of (await readFile(f, 'utf8')).split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}
const env = await loadEnv()
const log = (...a) => console.log(...a)

// ---------- time helpers (Israel wall clock ↔ UTC) ----------
const ilDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
function ilWallToUtc(dateStr, hh, mm) { // e.g. ('2026-11-03', 9, 0) → Date
  const guess = new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess)
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  const asIl = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}:00Z`)
  return new Date(guess.getTime() - (asIl.getTime() - guess.getTime()))
}
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
function tuesdayBefore(dateStr) { // 09:00 Israel on the Tuesday before the game day
  const d = new Date(`${dateStr}T12:00:00Z`), back = ((d.getUTCDay() - 2) + 7) % 7 || 7
  return ilWallToUtc(ilDate(new Date(d.getTime() - back * 86400e3)), 9, 0)
}

// ---------- schedule (public) ----------
async function gameDays() {
  const now = new Date(), until = new Date(now.getTime() + 30 * 86400e3)
  const sel = 'id,game_date,status,game_type,is_test,venue,home:teams!games_home_team_id_fkey(name,logo_url),away:teams!games_away_team_id_fkey(name,logo_url)'
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/games?select=${encodeURIComponent(sel)}&status=eq.scheduled&game_date=gte.${iso(now)}&game_date=lt.${iso(until)}&order=game_date`
  const r = await fetch(url, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } })
  if (!r.ok) throw new Error(`schedule: HTTP ${r.status} ${await r.text()}`)
  const rows = (await r.json()).filter((g) => !g.is_test && g.game_type !== 'ידידותי' && g.home && g.away)
  const days = new Map()
  for (const g of rows) { const d = ilDate(new Date(g.game_date)); if (!days.has(d)) days.set(d, []); days.get(d).push(g) }
  return [...days].map(([date, games]) => {
    const start = new Date(games[0].game_date), end = new Date(new Date(games.at(-1).game_date).getTime() + GAME_MINUTES * 60e3)
    const fp = createHash('sha1').update(games.map((g) => `${g.id}:${g.home.name}:${g.away.name}`).join('|')).digest('hex').slice(0, 8)
    return { date, games, start, end, fp }
  })
}

// ---------- App Store Connect ----------
let tok = null, tokAt = 0
function token() {
  if (tok && Date.now() - tokAt < 10 * 60e3) return tok
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'), now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }), body = b64({ iss: ISSUER, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' })
  const s = createSign('SHA256'); s.update(`${head}.${body}`)
  const sig = s.sign({ key: createPrivateKey(requireKey()), dsaEncoding: 'ieee-p1363' }).toString('base64url')
  tok = `${head}.${body}.${sig}`; tokAt = Date.now(); return tok
}
let keyPem = null; function requireKey() { return keyPem }
async function asc(method, p, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1${p}`, { method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text(); const json = text ? JSON.parse(text) : {}
  if (!r.ok) { const e = new Error(`${method} ${p}: ${r.status} ${(json.errors || []).map((x) => x.detail || x.title).join('; ')}`); e.status = r.status; throw e }
  return json
}
async function ourEvents() {
  const r = await asc('GET', `/apps/${APP_ID}/appEvents?limit=200&fields[appEvents]=referenceName,eventState,territorySchedules`)
  return r.data.filter((e) => e.attributes.referenceName?.startsWith(PREFIX)).map((e) => {
    const [, date, fp] = /^game-day (\d{4}-\d{2}-\d{2}) #([0-9a-f]{8})/.exec(e.attributes.referenceName) || []
    return { id: e.id, date, fp, state: e.attributes.eventState, sched: e.attributes.territorySchedules?.[0] }
  }).filter((e) => e.date)
}

// ---------- art ----------
async function dataUri(url) { const r = await fetch(url); if (!r.ok) throw new Error(`crest ${url}: ${r.status}`); const b = Buffer.from(await r.arrayBuffer()); return `data:${r.headers.get('content-type') || 'image/png'};base64,${b.toString('base64')}` }
async function render(day) {
  await mkdir(OUT, { recursive: true })
  const games = []
  for (const g of day.games) games.push({ home: [g.home.name, await dataUri(g.home.logo_url)], away: [g.away.name, await dataUri(g.away.logo_url)] })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files'] })
  const files = {}
  try {
    for (const [mode, w, h] of [['card', 1920, 1080], ['detail', 1080, 1920]]) {
      const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
      await page.evaluateOnNewDocument((ev) => { window.EVENT = ev }, { games })
      await page.goto(pathToFileURL(path.join(HERE, 'card.html')).href + `?mode=${mode}`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.fonts.ready)
      const file = path.join(OUT, `${day.date}-${mode}-${w}x${h}.png`)
      await page.screenshot({ path: file, type: 'png' }); files[mode] = file; await page.close()
    }
  } finally { await browser.close() }
  return files
}

// ---------- alerts (📣 to Ariel only) ----------
async function alert(title, body) {
  log('ALERT:', title, '—', body)
  if (!APPLY) return
  const sql = `insert into notifications (user_id, type, data) values ('${ARIEL}', 'announcement', '${JSON.stringify({ title, body, href: '/admin' }).replace(/'/g, "''")}'::jsonb)`
  const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })
  if (!r.ok) log('  (alert insert failed:', r.status, await r.text(), ')')
}

// ---------- create / change / delete ----------
async function uploadShot(locId, file, type) {
  const buf = await readFile(file)
  const res = await asc('POST', '/appEventScreenshots', { data: { type: 'appEventScreenshots', attributes: { fileName: path.basename(file), fileSize: buf.length, appEventAssetType: type }, relationships: { appEventLocalization: { data: { type: 'appEventLocalizations', id: locId } } } } })
  for (const op of res.data.attributes.uploadOperations) {
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]))
    const r = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) })
    if (!r.ok) throw new Error(`upload ${type}: ${r.status}`)
  }
  await asc('PATCH', `/appEventScreenshots/${res.data.id}`, { data: { type: 'appEventScreenshots', id: res.data.id, attributes: { uploaded: true } } })
}
function schedule(day) {
  const publish = new Date(Math.max(tuesdayBefore(day.date).getTime(), Date.now() + 2 * 3600e3))
  return [{ territories: ['ISR'], publishStart: iso(publish), eventStart: iso(day.start), eventEnd: iso(day.end) }]
}
async function create(day) {
  const files = await render(day)
  log(`  art: ${files.card}, ${files.detail}`)
  if (!APPLY) return null
  const ev = await asc('POST', '/appEvents', { data: { type: 'appEvents', attributes: {
    referenceName: `${PREFIX}${day.date} #${day.fp}`, badge: 'LIVE_EVENT', deepLink: 'https://rinkhockeyil.com/games',
    primaryLocale: 'he', priority: 'NORMAL', purpose: 'APPROPRIATE_FOR_ALL_USERS', purchaseRequirement: 'NO_COST_ASSOCIATED', territorySchedules: schedule(day) },
    relationships: { app: { data: { type: 'apps', id: APP_ID } } } } })
  const id = ev.data.id
  for (const [locale, t] of Object.entries(TEXT)) {
    const loc = await asc('POST', '/appEventLocalizations', { data: { type: 'appEventLocalizations', attributes: { locale, ...t }, relationships: { appEvent: { data: { type: 'appEvents', id } } } } })
    await uploadShot(loc.data.id, files.card, 'EVENT_CARD')
    await uploadShot(loc.data.id, files.detail, 'EVENT_DETAILS_PAGE')
  }
  log(`  created ${id}`)
  return id
}
async function submit(eventIds) {
  if (!APPLY || !eventIds.length) return
  // An unsubmitted iOS review submission may already exist (e.g. an app version being prepared).
  // Only ever reuse one that holds nothing but our own events.
  const open = (await asc('GET', `/apps/${APP_ID}/reviewSubmissions?filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=10`)).data
  let sub = null
  for (const s of open) {
    const items = (await asc('GET', `/reviewSubmissions/${s.id}/items?include=appEvent,appStoreVersion&limit=50`)).data
    if (items.every((it) => it.relationships?.appEvent?.data && !it.relationships?.appStoreVersion?.data)) { sub = s; break }
  }
  if (!sub && open.length) { await alert('אירועי App Store לא נשלחו לבדיקה', 'יש הגשה פתוחה ב-App Store Connect עם גרסת אפליקציה, ולכן לא נגעתי בה. אנסה שוב מחר.'); return }
  if (!sub) sub = (await asc('POST', '/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } })).data
  for (const id of eventIds) await asc('POST', '/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appEvent: { data: { type: 'appEvents', id } } } } })
  await asc('PATCH', `/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } })
  log(`  submitted ${eventIds.length} event(s) for review (${sub.id})`)
}
const EDITABLE = new Set(['DRAFT', 'READY_FOR_REVIEW', 'REJECTED', 'ACCEPTED', 'APPROVED', 'PUBLISHED'])
const DELETABLE = new Set(['DRAFT', 'READY_FOR_REVIEW', 'REJECTED', 'ACCEPTED', 'APPROVED', 'ARCHIVED'])
const he = (d) => d.split('-').reverse().slice(0, 2).map(Number).join('.')

// ---------- main ----------
keyPem = await readFile(KEY_PATH, 'utf8')
const days = (await gameDays()).filter((d) => !ONLY || d.date === ONLY)
log(`${new Date().toISOString()}  ${APPLY ? 'APPLY' : 'DRY RUN'}  game days in the next 30 days: ${days.map((d) => `${d.date}(${d.games.length})`).join(', ') || 'none'}`)
if (RENDER_ONLY) { for (const d of days) log(d.date, await render(d)); process.exit(0) }

const events = (await ourEvents()).filter((e) => !ONLY || e.date === ONLY)
const today = ilDate(new Date()), toSubmit = []
for (const e of events) {
  if (e.date < today || ['PAST', 'ARCHIVED'].includes(e.state)) continue
  const day = days.find((d) => d.date === e.date)
  if (!day) { // every game of that day is gone (cancelled or moved away)
    log(`${e.date}: no games any more — event ${e.id} (${e.state})`)
    if (DELETABLE.has(e.state)) { if (APPLY) await asc('DELETE', `/appEvents/${e.id}`); log('  deleted') }
    else if (e.state === 'PUBLISHED') await alert(`יום המשחקים ${he(e.date)} בוטל, אבל האירוע כבר מוצג ב-App Store`, 'Apple לא מאפשרת למחוק אירוע שכבר מוצג. כדאי לעדכן את המשחקים או לקצר את האירוע ב-App Store Connect.')
    else await alert(`יום המשחקים ${he(e.date)} בוטל בזמן שהאירוע בבדיקה של Apple`, 'אחרי הבדיקה אמחק אותו אוטומטית.')
    continue
  }
  if (day.fp !== e.fp) { // the matchups changed → the art is wrong
    log(`${e.date}: matchups changed (${e.fp} → ${day.fp}) — ${e.state}`)
    if (DELETABLE.has(e.state)) { if (APPLY) await asc('DELETE', `/appEvents/${e.id}`); log('  deleted, will recreate'); events.splice(events.indexOf(e), 1, { ...e, gone: true }); continue }
    if (e.state === 'PUBLISHED') await alert(`המשחקים ב-${he(e.date)} השתנו אחרי שהאירוע עלה ל-App Store`, 'התמונה באירוע מראה את המשחקים הקודמים. Apple לא מאפשרת להחליף אותה עכשיו.')
  }
  const want = schedule(day)[0], have = e.sched || {}
  const moved = Math.abs(new Date(have.eventStart) - day.start) > 60e3 || Math.abs(new Date(have.eventEnd) - day.end) > 60e3
  if (moved && EDITABLE.has(e.state)) {
    log(`${e.date}: times changed → ${want.eventStart} – ${want.eventEnd}`)
    const ts = e.state === 'PUBLISHED' ? [{ ...have, eventStart: want.eventStart, eventEnd: want.eventEnd }] : [{ ...have, ...want }]
    if (APPLY) await asc('PATCH', `/appEvents/${e.id}`, { data: { type: 'appEvents', id: e.id, attributes: { territorySchedules: ts } } })
  } else if (moved) log(`${e.date}: times changed but the event is ${e.state} — retry next run`)
  if (e.state === 'REJECTED') await alert(`Apple דחתה את אירוע יום המשחקים ${he(e.date)}`, 'צריך לבדוק את הסיבה ב-App Store Connect. לא אשלח אותו שוב לבד.')
}
for (const day of days) {
  if (events.some((e) => e.date === day.date && !e.gone)) continue
  const hours = (day.start - Date.now()) / 3600e3
  if (hours > LEAD_DAYS * 24) { log(`${day.date}: later (${Math.round(hours / 24)} days out)`); continue }
  if (hours < MIN_LEAD_HOURS) { log(`${day.date}: too close for review — skipped`); continue }
  log(`${day.date}: creating event (${day.games.length} games, ${iso(day.start)} – ${iso(day.end)}, shows from ${schedule(day)[0].publishStart})`)
  try { const id = await create(day); if (id) toSubmit.push(id) } catch (err) { await alert(`לא הצלחתי ליצור את אירוע יום המשחקים ${he(day.date)}`, String(err.message).slice(0, 300)) }
}
// Our drafts from earlier runs (a failed submit, a --no-submit test, or one remade after a matchup
// change) inside the lead window go to review too — waiting longer only eats review time.
for (const e of events) {
  if (e.gone || !['DRAFT', 'READY_FOR_REVIEW'].includes(e.state) || toSubmit.includes(e.id)) continue
  const day = days.find((d) => d.date === e.date)
  if (day && day.fp === e.fp && (day.start - Date.now()) / 3600e3 <= LEAD_DAYS * 24) { log(`${e.date}: draft ${e.id} from an earlier run → review`); toSubmit.push(e.id) }
}
try { if (!NO_SUBMIT) await submit(toSubmit); else if (toSubmit.length) log(`  --no-submit: left ${toSubmit.length} draft(s)`) } catch (err) { await alert('שליחת אירועי App Store לבדיקה נכשלה', String(err.message).slice(0, 300)) }
log('done')
