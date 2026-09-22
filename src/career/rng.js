/**
 * Deterministic, *immutable* PRNG — the spine of the whole career mode.
 *
 * The reason this file exists at all: a saved career is nothing but
 * `{ seed, choices: ['youth-1', 'offer-2', …] }`. Every season, every league
 * table, every injury and every wage number is re-derived by replaying the
 * engine over that seed. So a save is ~100 bytes, it survives any schema
 * change we make to the *derived* data, and two people who open the same
 * share link see the identical career. Nothing is persisted server-side.
 *
 * That only holds if randomness is threaded, never global: every draw returns
 * `{ rng, value }` and the caller carries the new rng forward. A stray
 * `Math.random()` anywhere in the engine silently breaks replay — the career
 * would re-roll differently on reload — so there are none, by rule.
 */

// FNV-1a: string → 32-bit seed.
function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A fresh generator from any string seed. */
export function rngFrom(seed) {
  return { seed, state: hashString(seed) || 1 }
}

/**
 * Sub-stream: derives an independent generator for one (step, tag) pair.
 * Used so that adding a draw in, say, the injury code can't shift the numbers
 * the transfer code pulls — each concern gets its own stream off the seed.
 */
export function streamFor(seed, step, tag) {
  return rngFrom(`${seed}|${step}|${tag}`)
}

// splitmix32.
function nextState(state) {
  let t = (state + 0x9e3779b9) >>> 0
  let z = t
  z = Math.imul(z ^ (z >>> 15), z | 1)
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
  return { state: t, value: ((z ^ (z >>> 14)) >>> 0) / 4294967296 }
}

/** Float in [0,1). */
export function next(rng) {
  const { state, value } = nextState(rng.state)
  return { rng: { seed: rng.seed, state }, value }
}

/** Integer in [min,max] inclusive. */
export function int(rng, min, max) {
  if (max <= min) return { rng, value: min }
  const r = next(rng)
  return { rng: r.rng, value: min + Math.floor(r.value * (max - min + 1)) }
}

/** Float in [min,max). */
export function float(rng, min, max) {
  const r = next(rng)
  return { rng: r.rng, value: min + r.value * (max - min) }
}

/** True with probability p. */
export function chance(rng, p) {
  const r = next(rng)
  return { rng: r.rng, value: r.value < p }
}

/** One item, uniform. */
export function pick(rng, arr) {
  if (!arr.length) return { rng, value: null }
  const r = int(rng, 0, arr.length - 1)
  return { rng: r.rng, value: arr[r.value] }
}

/** One item, weighted by `weightOf`. Zero-weight items can never come out. */
export function pickWeighted(rng, arr, weightOf) {
  const weights = arr.map(weightOf)
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return pick(rng, arr)
  const r = next(rng)
  let acc = r.value * total
  for (let i = 0; i < arr.length; i++) {
    acc -= weights[i]
    if (acc <= 0) return { rng: r.rng, value: arr[i] }
  }
  return { rng: r.rng, value: arr[arr.length - 1] }
}

/** Fisher–Yates, non-mutating. */
export function shuffle(rng, arr) {
  const out = arr.slice()
  let r = rng
  for (let i = out.length - 1; i > 0; i--) {
    const d = int(r, 0, i)
    r = d.rng
    ;[out[i], out[d.value]] = [out[d.value], out[i]]
  }
  return { rng: r, value: out }
}

/** `count` distinct items. */
export function sample(rng, arr, count) {
  const s = shuffle(rng, arr)
  return { rng: s.rng, value: s.value.slice(0, count) }
}

/** Roughly-normal draw (sum of 3 uniforms), clamped to [min,max]. */
export function bell(rng, min, max) {
  let r = rng, sum = 0
  for (let i = 0; i < 3; i++) {
    const d = next(r)
    r = d.rng
    sum += d.value
  }
  return { rng: r, value: min + (sum / 3) * (max - min) }
}

/** A short, human-typable seed. The one place a real random number is allowed. */
export function newSeed() {
  return Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36).slice(-4)
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
