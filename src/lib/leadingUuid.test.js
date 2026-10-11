import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { leadingUuid } from './slugs'

const U = 'fff32757-8d29-4b9d-b8db-e7d7e7cfe4e8'

describe('leadingUuid', () => {
  it('keeps a clean UUID', () => expect(leadingUuid(U)).toBe(U))
  it('drops share text glued on after a space', () => expect(leadingUuid(`${U} ⚪ גול מטורף של בארי ודניאל!`)).toBe(U))
  it('lower-cases', () => expect(leadingUuid(U.toUpperCase() + '!')).toBe(U))
  it('rejects a longer hex run and non-UUIDs', () => {
    expect(leadingUuid(`${U}a`)).toBeNull()
    expect(leadingUuid('יואב-תורגמן')).toBeNull()
    expect(leadingUuid(null)).toBeNull()
  })
})
