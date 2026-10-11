import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {}, setRequestReporter: () => {} }))
const { isAutomated } = await import('./telemetry')

const ua = userAgent => ({ userAgent, webdriver: false })

describe('isAutomated', () => {
  it('flags crawlers and headless browsers', () => {
    expect(isAutomated(ua('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'))).toBe(true)
    expect(isAutomated(ua('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0 Safari/537.36'))).toBe(true)
    expect(isAutomated(ua('facebookexternalhit/1.1'))).toBe(true)
    expect(isAutomated({ userAgent: 'Mozilla/5.0 Chrome/124.0', webdriver: true })).toBe(true)
  })
  it('leaves people alone', () => {
    expect(isAutomated(ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))).toBe(false)
    expect(isAutomated(ua('Mozilla/5.0 (Linux; Android 13; CUBOT X30 Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'))).toBe(false)
    expect(isAutomated(null)).toBe(false)
  })
})
