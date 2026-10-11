import { describe, it, expect } from 'vitest'
import {
  mentionQuery, matchPlayers, insertMention, finalMentions, splitMentions,
  decodeMention, decodePlayerMention, groupMentions, canRemoveMention,
} from './mentions'

const players = [
  { id: 'p1', first_name: 'בארי', last_name: 'אוליאל', team_id: 't1' },
  { id: 'p2', first_name: 'דני', last_name: 'כהן', team_id: 't2' },
  { id: 'p3', first_name: 'דניאל', last_name: 'לוי', team_id: 't1' },
  { id: 'p4', first_name: 'Ido', last_name: 'Ben Ami', team_id: 't2' },
  { id: 'p5', first_name: 'יואב', last_name: 'בן דני', team_id: 't2' },
]

describe('mentionQuery (the "@" trigger)', () => {
  it('opens on "@" + a letter at a word start', () => {
    expect(mentionQuery('@ב')).toEqual({ start: 0, query: 'ב' })
    expect(mentionQuery('שער של @דנ')).toEqual({ start: 7, query: 'דנ' })
    expect(mentionQuery('שורה\n@Id')).toEqual({ start: 5, query: 'Id' })
  })
  it('allows a space to type the full name', () => {
    expect(mentionQuery('יופי @בארי או')).toEqual({ start: 5, query: 'בארי או' })
  })
  it('stays closed otherwise', () => {
    expect(mentionQuery('@')).toBeNull()                // no letter yet
    expect(mentionQuery('@ ב')).toBeNull()               // space right after "@"
    expect(mentionQuery('@1')).toBeNull()                // digit first
    expect(mentionQuery('mail@gmail')).toBeNull()        // mid-word "@"
    expect(mentionQuery('@דני  כהן')).toBeNull()         // double space ends it
    expect(mentionQuery('@דני\nכהן')).toBeNull()         // line break ends it
    expect(mentionQuery('')).toBeNull()
  })
  it('respects the caret position', () => {
    const t = '@דני ועוד טקסט'
    expect(mentionQuery(t, 3)).toEqual({ start: 0, query: 'דנ' })
  })
})

describe('matchPlayers', () => {
  it('matches first, last and full name, prefix first', () => {
    expect(matchPlayers(players, 'דני').map(p => p.id)).toEqual(['p2', 'p3', 'p5'])
    expect(matchPlayers(players, 'כהן').map(p => p.id)).toEqual(['p2'])
    expect(matchPlayers(players, 'בארי או').map(p => p.id)).toEqual(['p1'])
  })
  it('is case-insensitive', () => {
    expect(matchPlayers(players, 'ido b').map(p => p.id)).toEqual(['p4'])
    expect(matchPlayers(players, 'AMI').map(p => p.id)).toEqual(['p4'])
  })
  it('caps at 8 and ignores an empty query', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, first_name: 'אבי', last_name: `${i}` }))
    expect(matchPlayers(many, 'אבי')).toHaveLength(8)
    expect(matchPlayers(players, '  ')).toEqual([])
  })
})

describe('insertMention + finalMentions', () => {
  it('replaces the query with "@<first> <last> "', () => {
    const text = 'כל הכבוד @בא'
    const q = mentionQuery(text)
    const r = insertMention(text, q, text.length, players[0])
    expect(r.text).toBe('כל הכבוד @בארי אוליאל ')
    expect(r.caret).toBe(r.text.length)
    expect(r.pick).toEqual({ player_id: 'p1', display: 'בארי אוליאל' })
  })
  it('keeps the text after the caret', () => {
    const text = '@ד ושאר'
    const r = insertMention(text, mentionQuery(text, 2), 2, players[1])
    expect(r.text).toBe('@דני כהן ושאר')
  })
  it('keeps picks still in the text, once per player', () => {
    const picks = [
      { player_id: 'p1', display: 'בארי אוליאל' },
      { player_id: 'p2', display: 'דני כהן' },
      { player_id: 'p1', display: 'בארי אוליאל' },
      { player_id: null, display: 'x' },
    ]
    expect(finalMentions('תודה @בארי אוליאל!', picks)).toEqual([{ player_id: 'p1', display: 'בארי אוליאל' }])
    expect(finalMentions('', picks)).toEqual([])
  })
})

describe('splitMentions (rendering)', () => {
  const barry = { id: 'm1', player_id: 'p1', display: 'בארי אוליאל' }
  const dani = { id: 'm2', player_id: 'p2', display: 'דני כהן' }

  it('splits text and tag runs', () => {
    expect(splitMentions('כל הכבוד @בארי אוליאל על השער', [barry])).toEqual([
      { text: 'כל הכבוד ' },
      { text: 'בארי אוליאל', mention: barry },
      { text: ' על השער' },
    ])
  })
  it('handles multiple tags and a repeated name', () => {
    const runs = splitMentions('@בארי אוליאל ו@דני כהן — שוב @בארי אוליאל', [barry, dani])
    expect(runs.filter(r => r.mention).map(r => r.mention.id)).toEqual(['m1', 'm2', 'm1'])
    expect(runs.map(r => r.text).join('')).toBe('בארי אוליאל ודני כהן — שוב בארי אוליאל')
  })
  it('leaves an "@name" without a tag row as plain text', () => {
    expect(splitMentions('שלום @יוסי לוי', [barry])).toEqual([{ text: 'שלום @יוסי לוי' }])
    expect(splitMentions('שלום @בארי אוליאל', [])).toEqual([{ text: 'שלום @בארי אוליאל' }])
    expect(splitMentions('שלום @בארי אוליאל', undefined)).toEqual([{ text: 'שלום @בארי אוליאל' }])
  })
  it('keeps emoji intact around a tag', () => {
    const runs = splitMentions('🔥🏒 @בארי אוליאל 👏🏽', [barry])
    expect(runs).toEqual([{ text: '🔥🏒 ' }, { text: 'בארי אוליאל', mention: barry }, { text: ' 👏🏽' }])
  })
  it('prefers the longer display at the same spot', () => {
    const short = { id: 's', player_id: 'p9', display: 'דני' }
    const runs = splitMentions('@דני כהן', [short, dani])
    expect(runs).toEqual([{ text: 'דני כהן', mention: dani }])
  })
  it('ignores removed or broken rows and empty bodies', () => {
    expect(splitMentions('@בארי אוליאל', [{ ...barry, removed_at: '2026-01-01' }])).toEqual([{ text: '@בארי אוליאל' }])
    expect(splitMentions('@בארי אוליאל', [{ id: 'x', display: 'בארי אוליאל' }])).toEqual([{ text: '@בארי אוליאל' }])
    expect(splitMentions('', [barry])).toEqual([])
    expect(splitMentions(null, [barry])).toEqual([])
  })
})

describe('decoding rows', () => {
  it('decodeMention tolerates missing fields', () => {
    expect(decodeMention({ id: 'm', player_id: 'p', display: ' דני ' })).toEqual({
      id: 'm', player_id: 'p', display: 'דני', author_id: null, post_id: null, comment_id: null, item_comment_id: null,
    })
    expect(decodeMention({ id: 'm', display: 'x' })).toBeNull()
    expect(decodeMention({ id: 'm', player_id: 'p' })).toBeNull()
    expect(decodeMention(null)).toBeNull()
    expect(decodeMention('nope')).toBeNull()
  })
  it('groupMentions groups by the owning row', () => {
    const g = groupMentions([
      { id: 'a', player_id: 'p', display: 'x', post_id: 'P1' },
      { id: 'b', player_id: 'q', display: 'y', post_id: 'P1' },
      { id: 'c', player_id: 'q', display: 'y', post_id: null },
      null,
    ], 'post_id')
    expect(Object.keys(g)).toEqual(['P1'])
    expect(g.P1.map(m => m.id)).toEqual(['a', 'b'])
  })
  it('decodePlayerMention fills defaults and refuses off-site hrefs', () => {
    expect(decodePlayerMention({ mention_id: 'm', kind: 'comment', href: '/posts/x', preview: 'hi', author_name: 'רון' }))
      .toMatchObject({ id: 'm', kind: 'comment', href: '/posts/x', preview: 'hi', author_name: 'רון', author_avatar: null })
    const bare = decodePlayerMention({})
    expect(bare).toMatchObject({ kind: 'post', href: '/', preview: '', author_name: 'חבר/ת הליגה', created_at: null })
    expect(decodePlayerMention({ href: 'https://evil.example' }).href).toBe('/')
    expect(decodePlayerMention({ href: '//evil.example' }).href).toBe('/')
    expect(decodePlayerMention({ href: '/#ms-1' }).href).toBe('/#ms-1')
    expect(decodePlayerMention(null)).toBeNull()
  })
})

describe('canRemoveMention', () => {
  const m = { id: 'm', player_id: 'p1', author_id: 'u-author' }
  it('the tagged player, the tagger, admins and content editors', () => {
    expect(canRemoveMention(m, { userId: 'u1', playerId: 'p1' })).toBe(true)
    expect(canRemoveMention(m, { userId: 'u-author' })).toBe(true)
    expect(canRemoveMention(m, { userId: 'u2', isAdmin: true })).toBe(true)
    expect(canRemoveMention(m, { userId: 'u2', isContentEditor: true })).toBe(true)
  })
  it('nobody else, and never a guest', () => {
    expect(canRemoveMention(m, { userId: 'u2', playerId: 'p2' })).toBe(false)
    expect(canRemoveMention(m, { userId: null, isAdmin: true })).toBe(false)
  })
})
