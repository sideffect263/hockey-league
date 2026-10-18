// Checks that rinkhockeyil.com still serves search engines real pages.
//
// 2026-09: 113 of ~120 sitemap URLs sat "discovered, not crawled" because every
// route served the SPA shell with a canonical pointing at the homepage. The fix
// (api/seo.js + UA rewrites in vercel.json) is easy to undo silently — a
// reordered rewrite or a canonical re-added to index.html breaks nothing a
// visitor would see. This script is what notices. Run daily by
// .github/workflows/seo-check.yml; exits 1 with a list of failures.
//
//   node scripts/check-seo.mjs [https://rinkhockeyil.com]

const SITE = (process.argv[2] || 'https://rinkhockeyil.com').replace(/\/$/, '')
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const GENERIC_TITLE = 'ליגת הוקי הגלגיליות הישראלית'

const failures = []
const fail = (msg) => { failures.push(msg); console.log(`✗ ${msg}`) }
const ok = (msg) => console.log(`✓ ${msg}`)

async function get(path, ua) {
  const r = await fetch(`${SITE}${path}`, { headers: { 'user-agent': ua }, redirect: 'manual' })
  return { status: r.status, headers: r.headers, html: await r.text() }
}
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
const canonicalOf = (html) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]

// A search bot must get: 200, its own title, a canonical naming THIS url, real text.
async function checkBotPage(path, minBytes = 1000) {
  const { status, html } = await get(path, GOOGLEBOT)
  const title = titleOf(html), canonical = canonicalOf(html)
  const problems = []
  if (status !== 200) problems.push(`status ${status}`)
  if (!title || title === GENERIC_TITLE) problems.push(`generic title "${title}"`)
  if (canonical !== `${SITE}${path}`) problems.push(`canonical ${canonical ? decodeURIComponent(canonical) : 'missing'}`)
  if (html.length < minBytes) problems.push(`only ${html.length} bytes`)
  if (/http-equiv="refresh"/i.test(html)) problems.push('meta refresh (the social-bot page leaked to search bots)')
  problems.length ? fail(`Googlebot ${decodeURIComponent(path)}: ${problems.join(', ')}`) : ok(`Googlebot ${decodeURIComponent(path)} — "${title}"`)
  return html
}

async function main() {
  // Hubs. /players also supplies a real player and team link to check, so this
  // never goes stale when someone is renamed or a team folds.
  for (const p of ['/standings', '/games', '/teams', '/statistics', '/tournaments', '/archive']) await checkBotPage(p)
  const playersHtml = await checkBotPage('/players', 3000)
  const teamsHtml = (await get('/teams', GOOGLEBOT)).html

  const firstLink = (html, type) => html.match(new RegExp(`href="(/${type}/[^"]+)"`))?.[1]
  const player = firstLink(playersHtml, 'players'), team = firstLink(teamsHtml, 'teams')
  const playerHtml = player ? await checkBotPage(player) : (fail('no player link on /players for Googlebot'), '')
  const teamHtml = team ? await checkBotPage(team, 2000) : (fail('no team link on /teams for Googlebot'), '')

  // Structured data rides on the bot pages (the SPA's own copy never reaches a bot).
  const ldTypes = (html) => {
    try { return JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1])['@graph'].map(n => n['@type']) } catch { return [] }
  }
  const expectLd = (label, html, type) => ldTypes(html).includes(type) ? ok(`${label} has ${type} JSON-LD`) : fail(`${label}: no ${type} JSON-LD`)
  if (playerHtml) expectLd(decodeURIComponent(player), playerHtml, 'Person')
  if (playerHtml) expectLd(decodeURIComponent(player), playerHtml, 'ProfilePage')
  if (teamHtml) expectLd(decodeURIComponent(team), teamHtml, 'SportsTeam')

  // Unknown slug → 404, so dead URLs leave the index instead of piling up as soft 404s.
  const missing = await get('/players/__seo-check-missing__', GOOGLEBOT)
  missing.status === 404 ? ok('unknown player → 404') : fail(`unknown player → ${missing.status}, expected 404`)

  // Visitors still get the app — and the shell must never carry a site-wide canonical again.
  const shell = await get(player || '/players', BROWSER)
  if (shell.status !== 200 || !/<div id="root">/.test(shell.html)) fail(`browser ${player}: not the SPA shell (status ${shell.status})`)
  else if (canonicalOf(shell.html)) fail(`index.html has a static canonical again (${canonicalOf(shell.html)}) — it applies to EVERY route`)
  else ok('browser gets the SPA shell, no static canonical')

  const media = await get('/media', BROWSER)
  ;/noindex/i.test(media.headers.get('x-robots-tag') || '') ? ok('/media is noindex') : fail('/media lost its X-Robots-Tag: noindex header')

  const sitemap = await get('/sitemap.xml', BROWSER)
  const locs = (sitemap.html.match(/<loc>/g) || []).length
  sitemap.status === 200 && locs > 20 ? ok(`sitemap.xml — ${locs} URLs`) : fail(`sitemap.xml: status ${sitemap.status}, ${locs} URLs`)
  // Live from the DB (api/sitemap.js): it must list the archived season and its games,
  // which a static / RLS-filtered sitemap silently dropped.
  const archiveLoc = sitemap.html.match(/<loc>[^<]*(\/archive\/[^<]+)<\/loc>/)?.[1]
  if (!archiveLoc) fail('sitemap.xml lists no /archive/<season> page')
  else {
    ok(`sitemap.xml lists ${decodeURIComponent(archiveLoc)}`)
    const season = await checkBotPage(archiveLoc, 3000)
    expectLd(decodeURIComponent(archiveLoc), season, 'SportsEvent')
    const oldGame = season.match(/href="(\/games\/[^"]+)"/)?.[1]
    if (!oldGame) fail(`${decodeURIComponent(archiveLoc)}: no game links`)
    else sitemap.html.includes(oldGame) ? ok('sitemap.xml includes archived-season games') : fail(`sitemap.xml misses archived game ${decodeURIComponent(oldGame)}`)
  }

  // Video watch pages (2026-10-18): Search Console had 0/7 videos indexed — "not on a watch
  // page". A video post must give Google a file it may fetch (the Stream iframe is
  // robots-blocked by Cloudflare) and show a real <video>.
  const videoPost = sitemap.html.match(/<loc>[^<]*(\/posts\/[0-9a-f-]{36})<\/loc>[^\n]*<video:video>/)?.[1]
  if (!videoPost) fail('sitemap.xml lists no video post')
  else {
    const vp = await checkBotPage(videoPost)
    expectLd(videoPost, vp, 'VideoObject')
    const vo = (() => { try { return JSON.parse(vp.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1])['@graph'].find(n => n['@type'] === 'VideoObject') } catch { return null } })()
    vo?.contentUrl && !/\/iframe$/.test(vo.contentUrl) ? ok(`${videoPost} VideoObject.contentUrl is a file`) : fail(`${videoPost}: VideoObject has no fetchable contentUrl`)
    ;/<video[\s>]/.test(vp) ? ok(`${videoPost} shows a <video>`) : fail(`${videoPost}: no <video> element — not a watch page`)
    ;/<video:content_loc>/.test(sitemap.html) ? ok('sitemap.xml has video:content_loc') : fail('sitemap.xml lost video:content_loc')
  }

  // "/" is the static index.html even for bots: the league's logo + name must be in it.
  const home = await get('/', GOOGLEBOT)
  ;/"@type":"SportsOrganization"[\s\S]*"logo"/.test(home.html) ? ok('/ carries Organization logo JSON-LD') : fail('/: index.html lost its Organization (logo / sameAs) JSON-LD')

  const robots = await get('/robots.txt', BROWSER)
  ;/Disallow:\s*\/\s*$/m.test(robots.html) ? fail('robots.txt disallows the whole site') : ok('robots.txt allows crawling')

  console.log(failures.length ? `\n${failures.length} problem(s).` : '\nAll SEO checks passed.')
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
