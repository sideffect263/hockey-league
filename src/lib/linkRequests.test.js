import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./sessionUser', () => ({ sessionUser: async () => null }))
import { linkRequestErrorMessage, splitName } from './linkRequests'

describe('linkRequestErrorMessage', () => {
  it('maps the guard trigger codes', () => {
    expect(linkRequestErrorMessage({ message: 'request_already_pending' })).toMatch(/בקשה ממתינה/)
    expect(linkRequestErrorMessage({ message: 'profile_already_linked' })).toBe('החשבון שלך כבר משויך לשחקן')
    expect(linkRequestErrorMessage({ message: 'player_already_linked' })).toMatch(/משויך לחשבון אחר/)
  })
  it('maps the client wrapper + unique-index codes', () => {
    expect(linkRequestErrorMessage(new Error('submission-already-pending'))).toMatch(/בקשה ממתינה/)
    expect(linkRequestErrorMessage({ code: '23505', message: 'duplicate key' })).toBe('כבר קיימת בקשה כזו')
    expect(linkRequestErrorMessage(new Error('not-authenticated'))).toBe('יש להתחבר תחילה')
  })
  it('falls back to a generic message', () => {
    expect(linkRequestErrorMessage(new Error('boom'))).toBe('שליחת הבקשה נכשלה, נסו שוב')
    expect(linkRequestErrorMessage(null)).toBe('שליחת הבקשה נכשלה, נסו שוב')
  })
})

describe('splitName', () => {
  it('first word is the first name, the rest the last name', () => {
    expect(splitName('  יואב  בן דוד ')).toEqual({ firstName: 'יואב', lastName: 'בן דוד' })
    expect(splitName('יואב')).toEqual({ firstName: 'יואב', lastName: '' })
    expect(splitName('')).toEqual({ firstName: '', lastName: '' })
  })
})
