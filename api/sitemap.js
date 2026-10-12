// /sitemap.xml, built per request from the live database (cached at the edge).
//
// It used to be a static file written at build time (scripts/gen-sitemap.mjs), so a
// player, game or post added after a deploy stayed invisible to Google until the next
// one. And it read `games` through the anon RLS, which hides archived seasons — the
// 51 games of 2025-26, the pages with real scores and scorers, were never listed.
//
// Lists: the hubs, every team / player / tournament, every game of the live AND the
// archived seasons (archived ones via season_games_detail, which RLS does not hide),
// each archived season's /archive page, and the league's OWN posts. Ingested news
// (posts with an external_guid) stays out: it is a copy of someone else's article.
//
// Image + video extensions (Google's image / video sitemap schemas) carry the crests,
// post photos and Cloudflare Stream highlights, so they can reach Images and video
// results — the bot pages (api/seo.js) show the same media on the page itself.
//
// URLs are the percent-encoded slug form, identical to the canonical in seo.js and
// the SPA. Any Supabase failure is a 503 (Google retries), never a short sitemap.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co'
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

import { postOg, POST_SELECT } from './og.js'

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
const enc = encodeURIComponent

async function sb(pathAndQuery, init) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
  })
  if (!r.ok) throw new Error(`${r.status} ${pathAndQuery}`)
  return r.json()
}

const HUBS = [
  ['/', 'daily', '1.0'],
  ['/standings', 'daily', '0.9'],
  ['/games', 'daily', '0.9'],
  ['/statistics', 'daily', '0.8'],
  ['/teams', 'weekly', '0.8'],
  ['/players', 'weekly', '0.8'],
  ['/tournaments', 'weekly', '0.5'],
  ['/archive', 'monthly', '0.5'],
  ['/guide', 'monthly', '0.4'],
  ['/app', 'monthly', '0.4'],
  ['/privacy', 'yearly', '0.2'],
]

const day = (iso) => (iso ? String(iso).slice(0, 10) : null)
const absUrl = (u) => (u && /^https?:\/\//.test(u) ? u : null)

/** Cloudflare Stream player for a post's video (same customer code the feed plays). */
export function streamPlayer(p) {
  return p?.video_uid && p?.video_cf_code ? `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}/iframe` : null
}

function urlTag(site, path, { changefreq, priority, lastmod, images = [], video } = {}) {
  const parts = [`<loc>${xmlEsc(site + path)}</loc>`]
  if (lastmod) parts.push(`<lastmod>${lastmod}</lastmod>`)
  if (changefreq) parts.push(`<changefreq>${changefreq}</changefreq>`)
  if (priority) parts.push(`<priority>${priority}</priority>`)
  for (const img of images.filter(Boolean)) parts.push(`<image:image><image:loc>${xmlEsc(img)}</image:loc></image:image>`)
  if (video) {
    parts.push('<video:video>' +
      `<video:thumbnail_loc>${xmlEsc(video.thumbnail)}</video:thumbnail_loc>` +
      `<video:title>${xmlEsc(video.title)}</video:title>` +
      `<video:description>${xmlEsc(video.description)}</video:description>` +
      `<video:player_loc>${xmlEsc(video.player)}</video:player_loc>` +
      (video.date ? `<video:publication_date>${xmlEsc(video.date)}</video:publication_date>` : '') +
      '<video:family_friendly>yes</video:family_friendly>' +
      '</video:video>')
  }
  return `  <url>${parts.join('')}</url>`
}

export async function buildSitemap(site) {
  const [teams, players, tournaments, seasons, posts] = await Promise.all([
    sb('teams?status=eq.active&select=id,slug,name,logo_url'),
    sb('players?select=id,slug'),
    sb('tournaments?select=id,slug'),
    sb('seasons?status=in.(active,archived)&select=id,slug,status,ends_on'),
    sb(`posts?deleted_at=is.null&external_guid=is.null&select=${POST_SELECT},created_at,updated_at,game_id&order=created_at.desc`),
  ])
  // Every game of every browsable season. The RPC answers for archived seasons too.
  const seasonGames = await Promise.all(seasons.map(s =>
    sb('rpc/season_games_detail', { method: 'POST', body: JSON.stringify({ p_season_id: s.id }) })))
  const games = seasonGames.flat()

  const playedDates = games.filter(g => g.status === 'completed').map(g => day(g.game_date)).filter(Boolean).sort()
  const latestResult = playedDates[playedDates.length - 1] || null

  const urls = HUBS.map(([p, changefreq, priority]) => urlTag(site, p, {
    changefreq, priority,
    lastmod: ['/', '/standings', '/games', '/statistics'].includes(p) ? latestResult : null,
    images: p === '/' ? [`${site}/logos/main-logo.png`] : [],
  }))

  for (const t of teams) urls.push(urlTag(site, `/teams/${enc(t.slug || t.id)}`, { changefreq: 'weekly', priority: '0.7', images: [absUrl(t.logo_url)] }))
  for (const p of players) urls.push(urlTag(site, `/players/${enc(p.slug || p.id)}`, { changefreq: 'weekly', priority: '0.6' }))
  for (const g of games) {
    const played = g.status === 'completed'
    urls.push(urlTag(site, `/games/${enc(g.slug || g.id)}`, {
      changefreq: played ? 'yearly' : 'weekly', priority: played ? '0.6' : '0.5',
      lastmod: played ? day(g.game_date) : null,
    }))
  }
  for (const s of seasons.filter(s => s.status === 'archived')) {
    urls.push(urlTag(site, `/archive/${enc(s.slug || s.id)}`, { changefreq: 'yearly', priority: '0.6', lastmod: day(s.ends_on) }))
  }
  for (const t of tournaments) urls.push(urlTag(site, `/tournaments/${enc(t.slug || t.id)}`, { changefreq: 'monthly', priority: '0.4' }))
  for (const p of posts) {
    const og = postOg(p)
    const player = streamPlayer(p)
    urls.push(urlTag(site, `/posts/${p.id}`, {
      changefreq: 'monthly', priority: '0.5',
      lastmod: day(p.updated_at || p.created_at),
      images: p.image_url ? [absUrl(p.image_url)] : [],
      video: player && og.image ? {
        thumbnail: og.image, player, date: p.created_at,
        title: (og.desc || og.title).slice(0, 100), description: og.desc || og.title,
      } : null,
    }))
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

export default async function handler(req, res) {
  const site = `https://${req.headers.host || 'rinkhockeyil.com'}`
  try {
    const xml = await buildSitemap(site)
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).send(xml)
  } catch (e) {
    console.error('sitemap failed', e)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '600')
    return res.status(503).send('sitemap temporarily unavailable')
  }
}
