#!/usr/bin/env node
// Talks to the game-story edge function. See ROUTINE.md for the whole flow.
//
//   node scripts/game-story/story.mjs queue [limit]              > queue.json   (games with no story, or new evidence)
//   node scripts/game-story/story.mjs bundle <game_id> <dir>     → <dir>/facts.json + <dir>/media/*.jpg
//   node scripts/game-story/story.mjs save <story.json> [--dry-run]
//
// `bundle` downloads every frame / photo the facts list into <dir>/media so they can be
// LOOKED AT (Read the .jpg files) — the frames are the game, the text is only a caption.
// Needs GAME_STORY_TOKEN in the environment (or in hockey-league/.env locally).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '../../.env')
if (!process.env.GAME_STORY_TOKEN && existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').match(/^GAME_STORY_TOKEN=(.+)$/m)
  if (m) process.env.GAME_STORY_TOKEN = m[1].trim()
}
const TOKEN = process.env.GAME_STORY_TOKEN
const URL = process.env.GAME_STORY_URL || 'https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/game-story'
if (!TOKEN) { console.error('GAME_STORY_TOKEN is not set'); process.exit(2) }

async function call(body) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}, non-JSON body` }))
  if (!res.ok || !json.ok) { console.error(JSON.stringify(json)); process.exit(1) }
  return json
}

async function download(url, file) {
  try {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return false
    await writeFile(file, Buffer.from(await r.arrayBuffer()))
    return true
  } catch { return false }
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'queue') {
  const r = await call({ action: 'queue', limit: Number(args[0]) || 5 })
  console.log(JSON.stringify({ total_missing: r.total_missing, games: r.games }, null, 2))
} else if (cmd === 'bundle') {
  const [gameId, dir] = args
  if (!gameId || !dir) { console.error('usage: bundle <game_id> <dir>'); process.exit(2) }
  const r = await call({ action: 'bundle', game_id: gameId })
  await mkdir(path.join(dir, 'media'), { recursive: true })
  // Every image / frame gets a local file next to facts.json, so the writer can Read it.
  let n = 0
  for (const [i, m] of r.facts.media.entries()) {
    const tag = `${String(i + 1).padStart(2, '0')}-${m.origin}`
    if (m.image_url) {
      const f = path.join(dir, 'media', `${tag}-photo.jpg`)
      m.image_file = (await download(m.image_url, f)) ? f : null; n += m.image_file ? 1 : 0
    }
    for (const fr of m.frames ?? []) {
      const f = path.join(dir, 'media', `${tag}-${String(fr.second).padStart(4, '0')}s.jpg`)
      fr.file = (await download(fr.url, f)) ? f : null; n += fr.file ? 1 : 0
    }
  }
  await writeFile(path.join(dir, 'facts.json'), JSON.stringify({ facts_hash: r.facts_hash, publish_mode: r.publish_mode, existing_story_status: r.existing_story_status, existing_story_version: r.existing_story_version, ...r.facts }, null, 2))
  console.log(JSON.stringify({ ok: true, facts: path.join(dir, 'facts.json'), images_downloaded: n, events: r.facts.events.length, media: r.facts.media.length, publish_mode: r.publish_mode, existing_story_status: r.existing_story_status }))
} else if (cmd === 'save') {
  const [file] = args
  if (!file) { console.error('usage: save <story.json> [--dry-run]'); process.exit(2) }
  const story = JSON.parse(await readFile(file, 'utf8'))
  const r = await call({ action: 'save', ...story, dry_run: args.includes('--dry-run') })
  console.log(JSON.stringify(r))
} else {
  console.error('usage: story.mjs queue [limit] | bundle <game_id> <dir> | save <story.json> [--dry-run]'); process.exit(2)
}
