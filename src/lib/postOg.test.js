import { describe, it, expect, vi, afterEach } from 'vitest'
// api/og.js (the bot-only link-preview function) — tested from here because every file
// under api/ is deployed as a Vercel function.
vi.hoisted(() => { process.env.SUPABASE_ANON_KEY = 'anon' })
import handler, { postOg } from '../../api/og.js'

const ID = '0b6f2f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

describe('postOg', () => {
  it('author · league, first ~160 chars, post photo', () => {
    const og = postOg({ body: 'שורה\n'.repeat(60), image_url: 'https://x/img.jpg', author: { display_name: 'רון לוי' } })
    expect(og.title).toBe('רון לוי · ליגת הוקי הגלגיליות')
    expect(og.desc.length).toBeLessThanOrEqual(160)
    expect(og.desc.endsWith('…')).toBe(true)
    expect(og.image).toBe('https://x/img.jpg')
  })
  it('video thumbnails: uploaded clip, then YouTube', () => {
    expect(postOg({ body: 'x', video_uid: 'vid', video_cf_code: 'cc' }).image)
      .toBe('https://customer-cc.cloudflarestream.com/vid/thumbnails/thumbnail.jpg?time=2s&height=720')
    const yt = postOg({ body: 'גול! https://youtu.be/dQw4w9WgXcQ' })
    expect(yt.image).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(yt.desc).toBe('גול!')
  })
  it('news uses the source; birthdays and missing authors have a name; no image → null', () => {
    expect(postOg({ body: 'h', source_name: 'World Skate' }).title).toBe('World Skate · ליגת הוקי הגלגיליות')
    expect(postOg({ body: 'h', external_guid: 'birthday:x:2026' }).title).toMatch(/^יום הולדת שמח/)
    const bare = postOg({})
    expect(bare.title).toBe('חבר/ת הליגה · ליגת הוקי הגלגיליות')
    expect(bare.desc).toBe('ליגת הוקי הגלגיליות')
    expect(bare.image).toBeNull()
  })
})

function run(query, rows) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(url); return { ok: true, json: async () => rows } }))
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.code = c; return this }, send(b) { this.body = b } }
  return { calls, res, done: handler({ query, headers: { host: 'rinkhockeyil.com' } }, res) }
}

describe('og handler for /posts/<id>', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders the post preview and asks only for non-deleted posts', async () => {
    const { calls, res, done } = run({ type: 'posts', id: ID }, [{ id: ID, body: 'השער של השבוע', author: { display_name: 'דני' } }])
    await done
    expect(calls[0]).toContain(`posts?id=eq.${ID}&deleted_at=is.null`)
    expect(res.body).toContain('<meta property="og:title" content="דני · ליגת הוקי הגלגיליות"/>')
    expect(res.body).toContain('<meta property="og:description" content="השער של השבוע"/>')
    expect(res.body).toContain(`<meta property="og:url" content="https://rinkhockeyil.com/posts/${ID}"/>`)
    expect(res.body).toContain('og:image" content="https://rinkhockeyil.com/logos/main-logo.png"')
  })

  it('a deleted / missing post falls back to the league card', async () => {
    const { res, done } = run({ type: 'posts', id: ID }, [])
    await done
    expect(res.body).toContain('<meta property="og:title" content="ליגת הוקי הגלגיליות הישראלית"/>')
  })

  it('a non-uuid id never queries', async () => {
    const { calls, done } = run({ type: 'posts', id: 'not-a-uuid' }, [])
    await done
    expect(calls).toHaveLength(0)
  })
})
