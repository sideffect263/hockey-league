/**
 * @-tags of players in posts and comments — the pure half (no Supabase, unit-tested).
 * Server side: supabase/player-mentions.sql. The body stays PLAIN text ("@בארי אוליאל");
 * a row in `mentions` says which player an "@display" points at. Renderers link every
 * "@<display>" occurrence of an ACTIVE mention, and nothing else.
 */

export const MAX_SUGGESTIONS = 8
const MAX_QUERY = 30

/**
 * Is the caret inside an "@query"? The "@" must open a word (start of text or after
 * whitespace) and be followed by at least one letter. The query may contain single
 * spaces so a full name can be typed ("@בארי או"), but no line break and no second "@".
 * @returns {{ start: number, query: string } | null}  start = index of the "@"
 */
export function mentionQuery(text, caret = (text || '').length) {
  const before = String(text || '').slice(0, caret)
  const m = /(^|\s)@([^@\n]{1,40})$/u.exec(before)
  if (!m) return null
  const query = m[2]
  if (!/^\p{L}/u.test(query) || query.length > MAX_QUERY || /\s{2}/.test(query)) return null
  return { start: before.length - query.length - 1, query }
}

const norm = (s) => String(s || '').toLocaleLowerCase('he').normalize('NFC').replace(/\s+/g, ' ').trim()
export const displayName = (p) => [p?.first_name, p?.last_name].map(s => String(s || '').trim()).filter(Boolean).join(' ')

/**
 * Up to `limit` players whose first, last or full name matches the query (case-insensitive).
 * First-name prefix ranks above last-name prefix, above a mid-name match; then by name.
 */
export function matchPlayers(players, query, limit = MAX_SUGGESTIONS) {
  const q = norm(query)
  if (!q) return []
  const scored = []
  for (const p of players || []) {
    const full = norm(displayName(p))
    if (!full) continue
    const first = norm(p.first_name), last = norm(p.last_name)
    let score = -1
    if (full.startsWith(q) || first.startsWith(q)) score = 0
    else if (last.startsWith(q) || norm(`${p.last_name} ${p.first_name}`).startsWith(q)) score = 1
    else if (full.includes(q)) score = 2
    if (score >= 0) scored.push({ p, score, full })
  }
  scored.sort((a, b) => a.score - b.score || a.full.localeCompare(b.full, 'he'))
  return scored.slice(0, limit).map(s => s.p)
}

/**
 * Replace the "@query" ending at `caret` with "@<first> <last> ".
 * @returns {{ text: string, caret: number, pick: { player_id: string, display: string } }}
 */
export function insertMention(text, q, caret, player) {
  const display = displayName(player)
  const src = String(text || '')
  const insert = `@${display} `
  const after = src.slice(caret).replace(/^ /, '')
  const next = src.slice(0, q.start) + insert + after
  return { text: next, caret: q.start + insert.length, pick: { player_id: player.id, display } }
}

/**
 * The picks to send to set_mentions: those whose "@display" is still in the final text,
 * one per player. (The server applies the same rule; filtering here keeps the payload honest.)
 */
export function finalMentions(text, picks) {
  const body = String(text || '')
  const seen = new Set()
  const out = []
  for (const p of picks || []) {
    const display = String(p?.display || '').trim()
    if (!p?.player_id || !display || seen.has(p.player_id)) continue
    if (!body.includes(`@${display}`)) continue
    seen.add(p.player_id)
    out.push({ player_id: p.player_id, display })
  }
  return out
}

/**
 * Split a body into runs: { text } for plain text and { text, mention } for a tag.
 * `text` of a tag run is the display WITHOUT the "@". Every occurrence of an active
 * mention's "@display" becomes a tag; when two displays could start at the same spot the
 * longer wins ("@דני כהן" over "@דני"). A "@name" with no mention row stays plain.
 */
export function splitMentions(body, mentions) {
  const src = String(body ?? '')
  const active = (mentions || []).filter(m => m && m.player_id && String(m.display || '').trim() && !m.removed_at)
  if (!src || !active.length) return src ? [{ text: src }] : []
  const byLen = [...active].sort((a, b) => String(b.display).trim().length - String(a.display).trim().length)

  const runs = []
  let plain = ''
  let i = 0
  while (i < src.length) {
    let hit = null
    if (src[i] === '@') {
      for (const m of byLen) {
        const d = String(m.display).trim()
        if (src.startsWith(d, i + 1)) { hit = { m, d }; break }
      }
    }
    if (hit) {
      if (plain) { runs.push({ text: plain }); plain = '' }
      runs.push({ text: hit.d, mention: hit.m })
      i += 1 + hit.d.length
    } else {
      // Step by code point so an emoji's surrogate pair is never split.
      const cp = src.codePointAt(i)
      const ch = String.fromCodePoint(cp)
      plain += ch
      i += ch.length
    }
  }
  if (plain) runs.push({ text: plain })
  return runs
}

const str = (v) => (typeof v === 'string' && v ? v : null)

/** A `mentions` row (or a set_mentions result item) → a safe object, or null if unusable. */
export function decodeMention(row) {
  if (!row || typeof row !== 'object') return null
  const id = str(row.id), player_id = str(row.player_id)
  const display = typeof row.display === 'string' ? row.display.trim() : ''
  if (!player_id || !display) return null
  return {
    id,
    player_id,
    display,
    author_id: str(row.author_id),
    post_id: str(row.post_id),
    comment_id: str(row.comment_id),
    item_comment_id: str(row.item_comment_id),
  }
}

/** A player_mentions() RPC row → a safe object (missing fields get harmless defaults). */
export function decodePlayerMention(row) {
  if (!row || typeof row !== 'object') return null
  const href = str(row.href)
  const safeHref = href && href.startsWith('/') && !href.startsWith('//') ? href : '/'
  return {
    id: str(row.mention_id) || `${safeHref}:${row.created_at || ''}`,
    kind: row.kind === 'comment' ? 'comment' : 'post',
    created_at: str(row.created_at),
    href: safeHref,
    preview: typeof row.preview === 'string' ? row.preview : '',
    author_id: str(row.author_id),
    author_name: str(row.author_name) || 'חבר/ת הליגה',
    author_avatar: str(row.author_avatar),
  }
}

/** Group decoded mentions by the id of the row they live on. */
export function groupMentions(rows, key) {
  const out = {}
  for (const r of rows || []) {
    const m = decodeMention(r)
    const k = m?.[key]
    if (!k) continue
    ;(out[k] ||= []).push(m)
  }
  return out
}

/** May this viewer remove this tag? The tagged player, the tagger, or an admin / content editor. */
export function canRemoveMention(m, { userId, playerId, isAdmin, isContentEditor } = {}) {
  if (!m || !userId) return false
  return !!(isAdmin || isContentEditor || m.author_id === userId || (playerId && m.player_id === playerId))
}
