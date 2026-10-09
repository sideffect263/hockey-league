/**
 * Judge-board eligibility harness.  `node scripts/check-eligibility.mjs`
 * Pins src/lib/eligibility.js: who the judge may pick for a goal / card / lineup.
 */
import assert from 'node:assert/strict'
import { eligibilityMap, ineligibleReasons, isBlocked, isChecked, splitByEligibility, REASON } from '../src/lib/eligibility.js'

let n = 0
const t = (name, fn) => { fn(); n++; console.log('  ✓', name) }
const R = (id, extra = {}) => ({ player_id: id, team_id: 'h', suspended: false, suspension_games_remaining: null, medical_valid: true, medical_expires_at: '2027-06-30', ...extra })

const map = eligibilityMap([
  R('ok'),
  R('susp', { suspended: true, suspension_games_remaining: 1 }),
  R('nomed', { medical_valid: false, medical_expires_at: null }),
  R('both', { suspended: true, suspension_games_remaining: 2, medical_valid: false }),
])

t('eligible player has no reasons', () => assert.deepEqual(ineligibleReasons(map, 'ok'), []))
t('suspended → מושעה', () => assert.deepEqual(ineligibleReasons(map, 'susp'), [REASON.suspended]))
t('no valid medical → blocked', () => assert.deepEqual(ineligibleReasons(map, 'nomed'), [REASON.medical]))
t('both reasons reported, suspension first', () => assert.deepEqual(ineligibleReasons(map, 'both'), [REASON.suspended, REASON.medical]))
t('player with no row (borrowed from a third team) is unknown, not blocked', () => {
  assert.equal(isBlocked(map, 'stranger'), false); assert.equal(isChecked(map, 'stranger'), false)
})
t('free-text guest (no id) is never blocked', () => assert.equal(isBlocked(map, null), false))
t('eligibility failed to load (null) → nobody blocked', () => {
  assert.equal(isBlocked(null, 'susp'), false); assert.equal(isBlocked(eligibilityMap(null), 'nomed'), false)
})
t('admin override lets a blocked player through (array or Set)', () => {
  assert.equal(isBlocked(map, 'susp', ['susp']), false)
  assert.equal(isBlocked(map, 'nomed', new Set(['nomed'])), false)
  assert.equal(isBlocked(map, 'both', ['susp']), true)
})
t('split keeps order and routes guests to eligible', () => {
  const roster = [{ id: 'susp' }, { id: 'ok' }, { id: null, _guest: true }, { id: 'nomed' }, { id: 'stranger' }]
  const { eligible, blocked } = splitByEligibility(roster, map, ['nomed'])
  assert.deepEqual(eligible.map(p => p.id), ['ok', null, 'nomed', 'stranger'])
  assert.deepEqual(blocked.map(p => p.id), ['susp'])
})

console.log(`\n${n} eligibility checks passed`)
