import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./sessionUser', () => ({ sessionUser: async () => null }))
import { notificationText, notificationIcon, notificationHref, notificationPreview } from './notifications'

const PID = '0b6f2f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

describe('post notifications open the permalink', () => {
  it('post_like / post_comment → /posts/<id>', () => {
    expect(notificationHref({ type: 'post_like', entity_id: PID })).toBe(`/posts/${PID}`)
    expect(notificationHref({ type: 'post_comment', entity_id: PID })).toBe(`/posts/${PID}`)
    expect(notificationHref({ type: 'post_like' })).toBe('/')
  })
})

describe('tagged', () => {
  const n = (data) => ({ type: 'tagged', actor: { display_name: 'רון' }, data })
  it('text by where, icon, preview', () => {
    expect(notificationText(n({ where: 'post' }))).toBe('רון תייג/ה אותך בפוסט')
    expect(notificationText(n({ where: 'comment' }))).toBe('רון תייג/ה אותך בתגובה')
    expect(notificationIcon(n({}))).toBe('🏷️')
    expect(notificationPreview(n({ preview: ' כל הכבוד @רון ' }))).toBe('כל הכבוד @רון')
    expect(notificationPreview(n({}))).toBeNull()
    expect(notificationPreview({ type: 'post_like', data: { preview: 'x' } })).toBeNull()
  })
  it('href = data.href, in-app paths only', () => {
    expect(notificationHref(n({ href: `/posts/${PID}` }))).toBe(`/posts/${PID}`)
    expect(notificationHref(n({ href: '/games/abc' }))).toBe('/games/abc')
    expect(notificationHref(n({ href: '/#ms-1-p2' }))).toBe('/#ms-1-p2')
    expect(notificationHref(n({ href: 'https://evil.example' }))).toBe('/')
    expect(notificationHref(n({}))).toBe('/')
  })
})
