import { describe, it, expect } from 'vitest'
import { saveWithRetry, isNetworkError } from './saveRetry'

const net = () => Object.assign(new Error('TypeError: Failed to fetch'), { code: '' })
const refused = (m) => Object.assign(new Error(m), { code: 'P0001' })
const noSleep = { sleep: async () => {} }

describe('saveWithRetry', () => {
  it('classifies errors', () => {
    expect(isNetworkError(net())).toBe(true)
    expect(isNetworkError(refused('not authorized to score games'))).toBe(false)
  })
  it('retries network failures, then succeeds', async () => {
    let n = 0
    const r = await saveWithRetry(async () => { if (++n < 3) throw net() }, noSleep)
    expect(r.attempts).toBe(3)
  })
  it('treats "already completed" on a retry as success', async () => {
    let n = 0
    const r = await saveWithRetry(async () => { if (++n === 1) throw net(); throw refused('game already completed') }, noSleep)
    expect(r.alreadySaved).toBe(true)
  })
  it('"already completed" on the FIRST attempt is a real error', async () => {
    await expect(saveWithRetry(async () => { throw refused('game already completed') }, noSleep)).rejects.toThrow('game already completed')
  })
  it('does not retry a server refusal', async () => {
    let n = 0
    await expect(saveWithRetry(async () => { n++; throw refused('invalid score') }, noSleep)).rejects.toThrow('invalid score')
    expect(n).toBe(1)
  })
  it('gives up after 3 network failures', async () => {
    let n = 0
    await expect(saveWithRetry(async () => { n++; throw net() }, noSleep)).rejects.toThrow('Failed to fetch')
    expect(n).toBe(3)
  })
})
