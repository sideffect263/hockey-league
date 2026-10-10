import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isStaleChunkError, reloadForStaleChunk } from './staleChunkReload'

describe('isStaleChunkError', () => {
  it('matches the browsers\' stale-chunk messages', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://rinkhockeyil.com/assets/Feed-abc.js'))).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError('error loading dynamically imported module')).toBe(true)
  })
  it('ignores real bugs', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })
})

describe('reloadForStaleChunk', () => {
  let store, reload
  beforeEach(() => {
    store = {}
    reload = vi.fn()
    vi.stubGlobal('sessionStorage', {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
    })
    vi.stubGlobal('window', { location: { reload } })
  })

  it('reloads once, then refuses inside the 30s window (no loop)', () => {
    expect(reloadForStaleChunk()).toBe(true)
    expect(reloadForStaleChunk()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads again once the window has passed', () => {
    store['stale-chunk-reload-at'] = String(Date.now() - 31_000)
    expect(reloadForStaleChunk()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reloads without sessionStorage (cannot guard against a loop)', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => {} })
    expect(reloadForStaleChunk()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})
