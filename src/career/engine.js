/**
 * The career engine.
 *
 * A pure state machine: `start()` gives you a state with one pending decision
 * card, `choose()` folds an option key into the next state, and that's the
 * whole API. Nothing here touches React, the network, or the clock — which is
 * what lets `replay()` rebuild a twenty-season career from `{seed, choices}`
 * alone, and what lets us verify a leaderboard entry server-side later by
 * running the exact same function over the exact same input.
 *
 * Two rules keep that property true, and both are easy to break by accident:
 *   1. Every random draw threads an rng (see rng.js) — no Math.random().
 *   2. Anything derived (wages, tables, trophies) is recomputed, never stored
 *      as the source of truth. `choices` is the only real state.
 */

import { rngFrom, streamFor, int, float, chance, pick, pickWeighted, sample, bell, clamp } from './rng.js'
import { BAND_ORDER, BAND_LABEL, CONTINENTAL_LABEL, allClubs } from './clubs.js'
import { EVENTS } from './events.js'

export const START_AGE = 16
export const START_SEASON = 2026

export const POSITIONS = [
  { key: 'GK',  label: 'שוער',  archetype: 'goalkeeper' },
  { key: 'DEF', label: 'בלם',   archetype: 'defensive' },
  { key: 'MID', label: 'קשר',   archetype: 'support' },
  { key: 'FWD', label: 'חלוץ',  archetype: 'attacker' },
]

export const CADENCES = [
  { key: 'intense', label: 'כל עונה',  seasons: 1, note: 'החלטה בכל עונה — הקריירה הארוכה והמפורטת ביותר.' },
  { key: 'balanced', label: '2 עונות', seasons: 2, note: 'החלטה כל שתי עונות — קצב בינוני.' },
  { key: 'fast',    label: '3 עונות',  seasons: 3, note: 'החלטה כל שלוש עונות — קריירה מהירה.' },
]

const ARCHETYPE_OF = Object.fromEntries(POSITIONS.map((p) => [p.key, p.archetype]))

// ── Playing role ──────────────────────────────────────────────────────────
// Rink hockey rosters are tiny — five on the floor, about ten dressed — so the
// gap between "starter" and "benched" is far more brutal than in football and
// the thresholds below are tighter on purpose.
const ROLES = {
  starter:   { key: 'starter',   label: 'הרכב קבוע',    share: 0.92 },
  rotation:  { key: 'rotation',  label: 'רוטציה',        share: 0.62 },
  fringe:    { key: 'fringe',    label: 'סגל רחב',       share: 0.3 },
  bench:     { key: 'bench',     label: 'ספסל',          share: 0.12 },
}

function roleFor(overall, club) {
  const gap = overall - club.baseOverall
  if (gap >= 1) return ROLES.starter
  if (gap >= -4) return ROLES.rotation
  if (gap >= -9) return ROLES.fringe
  return ROLES.bench
}

// Goals+assists per appearance, by archetype. Rink hockey is a high-scoring
// sport (10–12 goals a game is normal), so these are much higher than the
// football equivalents would be.
const OUTPUT = {
  goalkeeper: { goals: 0.01, assists: 0.04 },
  defensive:  { goals: 0.25, assists: 0.35 },
  support:    { goals: 0.45, assists: 0.55 },
  attacker:   { goals: 1.05, assists: 0.5 },
}

// Age → [min,max] OVR change per season, by development profile.
const GROWTH = {
  early:  { 16: [2, 6], 18: [2, 6], 20: [1, 5], 23: [0, 3], 26: [-1, 2], 29: [-4, -1], 32: [-6, -2], 35: [-9, -4] },
  normal: { 16: [1, 5], 18: [2, 6], 20: [2, 6], 23: [1, 5], 26: [0, 3], 29: [-3, 0], 32: [-5, -2], 35: [-8, -3] },
  late:   { 16: [0, 3], 18: [1, 4], 20: [1, 5], 23: [2, 6], 26: [1, 5], 29: [-2, 1], 32: [-4, -1], 35: [-7, -3] },
}

function growthBand(profile, age) {
  const table = GROWTH[profile] || GROWTH.normal
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b)
  let band = table[keys[0]]
  for (const k of keys) if (age >= k) band = table[k]
  return band
}

// Wage in ₪ per season. Deliberately researched-low: rink hockey abroad is
// semi-pro outside the very top, and a game that promises football money would
// read as fake to anyone who actually plays the sport.
const WAGE_BY_BAND = {
  academy: [0, 0],
  israel:  [0, 6000],
  entry:   [18000, 55000],
  strong:  [60000, 180000],
  elite:   [150000, 420000],
  world:   [350000, 900000],
}

function wageFor(rng, club, overall, role) {
  const [lo, hi] = WAGE_BY_BAND[club.band] || [0, 0]
  if (hi === 0) return { rng, value: 0 }
  const quality = clamp((overall - club.baseOverall + 10) / 20, 0, 1)
  const roleMul = role.key === 'starter' ? 1 : role.key === 'rotation' ? 0.78 : 0.55
  const r = float(rng, 0.9, 1.15)
  const raw = (lo + (hi - lo) * quality) * roleMul * r.value
  return { rng: r.rng, value: Math.round(raw / 1000) * 1000 }
}

export function formatMoney(v) {
  if (!v) return '—'
  if (v >= 1000000) return `₪${(v / 1000000).toFixed(1)} מיליון`
  if (v >= 1000) return `₪${Math.round(v / 1000)} אלף`
  return `₪${v}`
}

// ── League table ──────────────────────────────────────────────────────────
/**
 * Simulates one league season around the player's club and returns the finish.
 * We don't model fixtures — a full table is generated from each club's
 * strength plus noise, which lands in the same place and costs nothing.
 */
function simulateTable(rng, club, peers, playerBoost) {
  let r = rng
  const field = [club, ...peers].map((c) => {
    const n = bell(r, -4.5, 4.5)
    r = n.rng
    const boost = c.id === club.id ? playerBoost : 0
    return { club: c, strength: c.baseOverall + n.value + boost }
  })
  field.sort((a, b) => b.strength - a.strength)
  const position = field.findIndex((f) => f.club.id === club.id) + 1
  return { rng: r, position, size: field.length, table: field }
}

/** Clubs that plausibly share a league with `club`. */
function peersOf(clubs, club) {
  const same = clubs.filter((c) => c.id !== club.id && c.league === club.league)
  if (same.length >= 5) return same.slice(0, 11)
  return clubs.filter((c) => c.id !== club.id && c.band === club.band).slice(0, 9)
}

const TROPHY = {
  league: (club) => `אליפות ${club.league}`,
  cup: (club) => (club.isIsraeli ? 'גביע המדינה' : `הגביע הלאומי · ${club.country}`),
  ucl: () => CONTINENTAL_LABEL.ucl,
  uel: () => CONTINENTAL_LABEL.uel,
}

// ── One season ────────────────────────────────────────────────────────────
function playSeason(state, clubs) {
  const club = clubById(clubs, state.clubId)
  const season = START_SEASON + (state.player.age - START_AGE)
  let r = streamFor(state.seed, state.step * 10 + state.player.age, 'season')

  const role = roleFor(state.player.overall, club)
  const shareJitter = float(r, 0.85, 1.12); r = shareJitter.rng

  // Injury: a lost chunk of the season, and it hurts development too.
  const inj = chance(r, state.player.age >= 30 ? 0.16 : 0.1); r = inj.rng
  let injuryWeeks = 0
  if (inj.value) {
    const w = int(r, 3, 20); r = w.rng
    injuryWeeks = w.value
  }
  const availability = clamp(1 - injuryWeeks / 40, 0.3, 1)

  const apps = Math.max(0, Math.round(club.seasonLength * role.share * shareJitter.value * availability))

  // Form: how far above or below their own level the season went.
  const formDraw = bell(r, 0.62, 1.45); r = formDraw.rng
  const form = formDraw.value

  const out = OUTPUT[state.player.archetype]
  const quality = clamp(1 + (state.player.overall - club.baseOverall) / 22, 0.45, 1.75)
  const gDraw = float(r, 0.85, 1.15); r = gDraw.rng
  const aDraw = float(r, 0.85, 1.15); r = aDraw.rng

  const goals = Math.round(apps * out.goals * quality * form * gDraw.value)
  const assists = Math.round(apps * out.assists * quality * form * aDraw.value)

  // Goalkeepers are judged on clean sheets instead.
  let cleanSheets = 0
  if (state.player.archetype === 'goalkeeper') {
    const cs = float(r, 0.08, 0.3); r = cs.rng
    // `cs` is a {rng, value} pair — using it directly here silently produced
    // NaN clean sheets for every goalkeeper, which then poisoned the career
    // total. It never surfaced because no screen displayed the number until
    // the season recap did.
    cleanSheets = Math.round(apps * cs.value * quality)
  }

  // League finish. One player drags a club up a little — but only a little.
  // At ±6 a single star turned any mid-table side into perennial champions,
  // which is how a "stay loyal" career was ending with sixteen trophies.
  const boost = clamp((state.player.overall - club.baseOverall) * role.share * 0.18, -1.5, 3)
  const tbl = simulateTable(r, club, peersOf(clubs, club), boost); r = tbl.rng

  // Silverware has to stay rare or it stops meaning anything on the career
  // card. You must have genuinely been part of the side, not merely present.
  const trophies = []
  const contributed = apps >= club.seasonLength * 0.5 && (role.key === 'starter' || role.key === 'rotation')
  if (tbl.position === 1 && contributed) trophies.push(TROPHY.league(club))
  const cup = chance(r, tbl.position <= 4 ? 0.12 : 0.02); r = cup.rng
  if (cup.value && contributed) trophies.push(TROPHY.cup(club))
  if (club.continental) {
    const cont = chance(r, club.continental === 'ucl' ? 0.07 : 0.11); r = cont.rng
    if (cont.value && contributed) trophies.push(TROPHY[club.continental]())
  }

  // Development.
  //
  // The important term here is `challenge`. Training and playing against
  // better players is how anyone actually improves, so signing for a club
  // ABOVE your level speeds you up even though you play less — and dominating
  // a league beneath you barely moves you at all. Without this the game
  // punished ambition: moving abroad cost you minutes and gave nothing back,
  // so the optimal career was to never leave home. That is the opposite of
  // the fantasy, and it showed up immediately in the numbers.
  const [gLo, gHi] = growthBand(state.player.developmentProfile, state.player.age)
  const gd = float(r, gLo, gHi); r = gd.rng
  let delta = gd.value
  if (delta > 0) {
    const gap = club.baseOverall - state.player.overall   // >0 = you're the small fish
    const challenge = clamp(1 + gap / 14, 0.55, 1.7)
    // Potential still caps you, but the squeeze starts later so a good move
    // late on can still add a couple of points.
    const headroom = clamp((state.player.potential - state.player.overall) / 6, 0, 1)
    delta *= headroom
    delta *= challenge
    delta *= clamp(role.share + 0.35, 0.45, 1.2)
    delta *= clamp(form, 0.7, 1.3)
    delta *= availability
  }
  const overall = clamp(Math.round(state.player.overall + delta), 40, 99)

  const w = wageFor(r, club, state.player.overall, role); r = w.rng

  // National team. You get called up once you're clearly above the domestic
  // level — for an Israeli player that bar is low, which is true to life.
  let national = null
  if (state.player.overall >= 58 && state.player.age >= 18) {
    const called = chance(r, clamp((state.player.overall - 55) / 30, 0.15, 0.9)); r = called.rng
    if (called.value) {
      const caps = int(r, 2, 8); r = caps.rng
      const ng = Math.round(caps.value * OUTPUT[state.player.archetype].goals * 0.7)
      national = { caps: caps.value, goals: ng }
    }
  }

  return {
    rng: r,
    block: {
      season,
      age: state.player.age,
      clubId: club.id,
      clubName: club.name,
      league: club.league,
      band: club.band,
      // Carried on the block so the recap and timeline can render a club's
      // identity without re-resolving it against the club list every frame.
      country: club.country,
      clubColors: club.colors,
      clubLogo: club.logoUrl || null,
      loan: !!state.loan,
      role: role.label,
      apps, goals, assists, cleanSheets,
      position: tbl.position,
      tableSize: tbl.size,
      trophies,
      injuryWeeks,
      wage: w.value,
      overallBefore: state.player.overall,
      overallAfter: overall,
      national,
    },
    overall,
  }
}

function clubById(clubs, id) {
  return clubs.find((c) => c.id === id) || clubs[0]
}

// ── Offers ────────────────────────────────────────────────────────────────
/**
 * Which rung you can reach next. You climb on merit (OVR relative to the rung
 * above) and you fall when you stop playing — an offer set never skips a rung,
 * because the whole fantasy of the game is that each step was earned.
 */
function reachableBands(state, club) {
  // Nobody is leaving the country at sixteen. A 17-year-old was being offered
  // French clubs — and then spending two seasons on their bench, because a
  // youth-team OVR looks enormous next to an academy baseline. Until 18 the
  // only moves available are inside Israel, which is both true to life and
  // stops the career skipping the league it is supposed to start in.
  if (state.player.age < 18) return ['academy', 'israel']

  const i = BAND_ORDER.indexOf(club.band)
  const bands = [club.band]
  const gap = state.player.overall - club.baseOverall
  if (gap >= 3 && i < BAND_ORDER.length - 1) bands.push(BAND_ORDER[i + 1])
  if (gap >= 10 && i < BAND_ORDER.length - 2) bands.push(BAND_ORDER[i + 2])
  if (gap < -3 && i > 1) bands.push(BAND_ORDER[i - 1])
  return [...new Set(bands)]
}

function clubFitScore(state, c) {
  const gap = state.player.overall - c.baseOverall
  // Sweet spot: a club a little above you — far enough to stretch you, close
  // enough that you get on the floor. Clubs well above your level barely ever
  // call, because signing for one means two seasons of watching.
  if (gap < -10) return 0
  if (gap < -6) return 0.08
  if (gap < 0) return 1
  if (gap < 8) return 0.8
  return 0.25
}

function buildOffers(state, clubs, rng, { count = 4, includeStay = true, preferBands = null } = {}) {
  let r = rng
  const current = clubById(clubs, state.clubId)
  const bands = reachableBands(state, current)
  const poolAll = clubs.filter(
    (c) => c.id !== current.id && bands.includes(c.band) && !state.clubHistory.includes(c.id)
  )
  const pool = poolAll.length >= count ? poolAll : clubs.filter((c) => c.id !== current.id && bands.includes(c.band))

  const chosen = []
  let rest = pool
  for (let i = 0; i < count && rest.length; i++) {
    const p = pickWeighted(r, rest, (c) => {
      const base = clubFitScore(state, c)
      return preferBands?.includes(c.band) ? base * 6 : base
    })
    r = p.rng
    if (!p.value) break
    chosen.push(p.value)
    rest = rest.filter((c) => c.id !== p.value.id)
  }

  const options = chosen.map((c, i) => {
    const role = roleFor(state.player.overall, c)
    const w = wageFor(r, c, state.player.overall, role)
    r = w.rng
    return {
      key: `to:${c.id}`,
      kind: 'transfer',
      club: c,
      label: c.name,
      sub: `${c.league} · ${BAND_LABEL[c.band]}`,
      role: role.label,
      wage: w.value,
      index: i,
    }
  })

  if (includeStay && current.band !== 'academy') {
    const role = roleFor(state.player.overall, current)
    const w = wageFor(r, current, state.player.overall, role)
    r = w.rng
    options.unshift({
      key: `stay:${current.id}`,
      kind: 'stay',
      club: current,
      label: `להישאר ב${current.shortName}`,
      sub: `${current.league} · ${BAND_LABEL[current.band]}`,
      role: role.label,
      wage: w.value,
      index: -1,
    })
  }
  return { rng: r, options }
}

// ── Cards ─────────────────────────────────────────────────────────────────
function youthCard(state, clubs) {
  let r = streamFor(state.seed, 0, 'youth')
  const academies = clubs.filter((c) => c.band === 'academy')
  const s = sample(r, academies, Math.min(3, academies.length))
  r = s.rng
  return {
    id: 'youth',
    kind: 'offers',
    title: 'איפה מתחילים',
    description: 'שלוש מחלקות נוער בליגת ההוקי הישראלית פתחו לך את הדלת. כאן הקריירה מתחילה.',
    options: s.value.map((c, i) => ({
      key: `to:${c.id}`,
      kind: 'transfer',
      club: c,
      label: c.name,
      sub: `${c.league} · ${BAND_LABEL[c.band]}`,
      role: ROLES.starter.label,
      wage: 0,
      index: i,
    })),
  }
}

function retireCard(state) {
  return {
    id: `retire-${state.step}`,
    kind: 'retire',
    title: 'סוף הדרך',
    description: 'הגלגיליות נתלות על המסמר. זה הזמן להסתכל אחורה.',
    options: [{ key: 'retire', kind: 'retire', label: 'לסיים את הקריירה', sub: 'הצג את כרטיס הקריירה' }],
  }
}

/**
 * The next decision after a season block. Alternates between transfer windows
 * and flavour dilemmas so the game never feels like a pure offer treadmill.
 */
function nextCard(state, clubs) {
  if (state.retired) return null
  if (state.player.age >= 40) return retireCard(state)

  const club = clubById(clubs, state.clubId)
  let r = streamFor(state.seed, state.step, 'card')

  // Leaving the academy is always a decision — and it should almost always
  // be a decision about WHICH Israeli senior club, not about Europe. A 18-year
  // old walking out of a youth side straight into a foreign league skips the
  // step the whole game is about earning, so the offer set is weighted home
  // and only opens abroad for someone who is genuinely already too good for
  // the domestic league.
  if (club.band === 'academy' && state.player.age >= 18) {
    const o = buildOffers(state, clubs, r, {
      count: 4,
      includeStay: false,
      preferBands: state.player.overall >= 62 ? ['israel', 'entry'] : ['israel'],
    })
    return {
      id: `graduate-${state.step}`,
      kind: 'offers',
      title: 'סיום מחלקת הנוער',
      description: `סיימת את הדרך ב${club.shortName}. עכשיו מתחילה הליגה האמיתית.`,
      options: o.options,
    }
  }

  // Forced move: nobody keeps a player who never plays.
  const role = roleFor(state.player.overall, club)
  const stagnant = state.benchStreak >= 2

  const wantsEvent = chance(r, stagnant ? 0.15 : 0.45)
  r = wantsEvent.rng

  if (wantsEvent.value) {
    const usable = EVENTS.filter((e) => !state.usedEvents.includes(e.id) && (!e.when || e.when(state, club)))
    if (usable.length) {
      const p = pick(r, usable)
      r = p.rng
      const e = p.value
      return {
        id: `event-${state.step}-${e.id}`,
        kind: 'event',
        eventId: e.id,
        title: e.title,
        description: typeof e.description === 'function' ? e.description(state, club) : e.description,
        options: e.options.map((o, i) => ({ ...o, key: `${e.id}:${o.key}`, kind: 'event', index: i })),
      }
    }
  }

  const o = buildOffers(state, clubs, r, { count: 4, includeStay: !stagnant })
  if (state.player.age >= 29) {
    o.options.push({
      key: 'retire',
      kind: 'retire',
      label: 'לתלות את הגלגיליות',
      sub: 'לסיים בתנאים שלך',
      index: 99,
    })
  }
  return {
    id: `window-${state.step}`,
    kind: 'offers',
    title: stagnant ? 'צריך לשחק' : 'חלון ההעברות',
    description: stagnant
      ? `עונתיים על הספסל ב${club.shortName}. הסוכן שלך אומר את זה בפה מלא: צריך לזוז.`
      : `${role.label} ב${club.shortName}. הטלפון מצלצל — מה עושים?`,
    options: o.options,
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export function start(config, israeliTeams) {
  const clubs = allClubs(israeliTeams)
  const seed = config.seed
  let r = streamFor(seed, 0, 'base')

  // Wider than it looks: combined with the tighter potential squeeze above,
  // this is what stops every career converging on the same peak OVR. A run
  // where the ceiling is 62 should feel different from one where it's 94.
  const pot = int(r, 55, 94); r = pot.rng
  const prof = pick(r, ['early', 'normal', 'normal', 'late']); r = prof.rng
  const ovr = int(r, 42, 50); r = ovr.rng

  const state = {
    seed,
    step: 0,
    cadence: config.cadence || 'intense',
    identity: {
      lastName: config.lastName || 'השחקן',
      number: config.number || 7,
      hand: config.hand || 'right',
      position: config.position || 'FWD',
    },
    player: {
      age: START_AGE,
      overall: ovr.value,
      potential: pot.value,
      developmentProfile: prof.value,
      position: config.position || 'FWD',
      archetype: ARCHETYPE_OF[config.position || 'FWD'],
    },
    clubId: null,
    clubHistory: [],
    loan: false,
    wage: 0,
    careerEarnings: 0,
    blocks: [],
    totals: { apps: 0, goals: 0, assists: 0, cleanSheets: 0 },
    national: { caps: 0, goals: 0 },
    trophies: [],
    collection: { clubs: [], trophies: [] },
    usedEvents: [],
    benchStreak: 0,
    retired: false,
    pending: null,
    lastBlocks: [],
  }
  state.pending = youthCard(state, clubs)
  return state
}

/** Fold one chosen option into the next state. Pure. */
export function choose(state, optionKey, israeliTeams) {
  const clubs = allClubs(israeliTeams)
  const card = state.pending
  if (!card) return state
  const option = card.options.find((o) => o.key === optionKey)
  if (!option) return state

  let next = { ...state, step: state.step + 1, lastBlocks: [] }

  if (option.kind === 'retire') {
    return { ...next, retired: true, pending: null }
  }

  if (option.kind === 'event') {
    const event = EVENTS.find((e) => e.id === card.eventId)
    let r = streamFor(state.seed, state.step, 'event-roll')
    const raw = option.key.split(':')[1]
    const spec = event?.options.find((o) => o.key === raw)
    const roll = chance(r, spec?.p ?? 1); r = roll.rng
    const outcome = roll.value ? spec?.good : spec?.bad || spec?.good
    next.usedEvents = [...state.usedEvents, event.id]
    next.lastOutcome = { title: event.title, text: outcome?.label || '', good: roll.value }
    const fx = outcome?.effects || {}
    next.player = {
      ...state.player,
      overall: clamp(state.player.overall + (fx.overall || 0), 40, 99),
      potential: clamp(state.player.potential + (fx.potential || 0), 40, 99),
    }
    if (fx.money) next.careerEarnings = state.careerEarnings + fx.money
  } else {
    // Transfer or stay.
    next.clubId = option.club.id
    next.loan = !!option.loan
    next.wage = option.wage
    next.clubHistory = state.clubHistory.includes(option.club.id)
      ? state.clubHistory
      : [...state.clubHistory, option.club.id]
    if (!state.collection.clubs.includes(option.club.id)) {
      next.collection = { ...state.collection, clubs: [...state.collection.clubs, option.club.id] }
    }
    next.lastOutcome = null
  }

  // Play out the seasons until the next decision.
  const seasons = CADENCES.find((c) => c.key === next.cadence)?.seasons || 1
  const blocks = []
  for (let i = 0; i < seasons; i++) {
    if (next.player.age >= 40) break
    const res = playSeason(next, clubs)
    const b = res.block
    blocks.push(b)
    next.player = { ...next.player, overall: res.overall, age: next.player.age + 1 }
    next.totals = {
      apps: next.totals.apps + b.apps,
      goals: next.totals.goals + b.goals,
      assists: next.totals.assists + b.assists,
      cleanSheets: next.totals.cleanSheets + b.cleanSheets,
    }
    next.careerEarnings += b.wage
    next.trophies = [
      ...next.trophies,
      ...b.trophies.map((t) => ({ name: t, season: b.season, clubId: b.clubId, band: b.band })),
    ]
    const newTrophies = b.trophies.filter((t) => !next.collection.trophies.includes(t))
    if (newTrophies.length) {
      next.collection = { ...next.collection, trophies: [...next.collection.trophies, ...newTrophies] }
    }
    if (b.national) {
      next.national = { caps: next.national.caps + b.national.caps, goals: next.national.goals + b.national.goals }
    }
    next.benchStreak = b.role === ROLES.bench.label || b.role === ROLES.fringe.label ? next.benchStreak + 1 : 0
  }
  next.blocks = [...state.blocks, ...blocks]
  next.lastBlocks = blocks

  // Decline forces the end: once you're well past it and nobody plays you.
  // Nobody in this sport is grinding out a fringe season at 37. Careers were
  // averaging 21 seasons and ending at 37.4, which is both unrealistic and a
  // lot of clicking for the back half of a run that has stopped going
  // anywhere.
  const done =
    next.player.age >= 37 ||
    (next.player.age >= 29 && next.player.overall < 50) ||
    (next.player.age >= 31 && next.benchStreak >= 2) ||
    (next.player.age >= 33 && next.player.overall < 60)
  next.pending = done ? retireCard(next) : nextCard(next, clubs)
  return next
}

/** Rebuild a whole career from a save. The reason saves are 100 bytes. */
export function replay(config, choices, israeliTeams) {
  let s = start(config, israeliTeams)
  for (const key of choices) {
    if (!s.pending) break
    s = choose(s, key, israeliTeams)
  }
  return s
}

/** The headline numbers on the end-of-career card. */
export function careerSummary(state) {
  const peak = state.blocks.reduce((m, b) => Math.max(m, b.overallAfter), 0)
  const clubs = [...new Set(state.blocks.map((b) => b.clubName))]
  const countries = [...new Set(state.blocks.map((b) => b.band))]
  const topBand = BAND_ORDER.reduce((best, b) => (state.blocks.some((x) => x.band === b) ? b : best), 'academy')
  return {
    peak,
    seasons: state.blocks.length,
    clubs,
    clubCount: clubs.length,
    countries: countries.length,
    topBand,
    topBandLabel: BAND_LABEL[topBand],
    ...state.totals,
    trophies: state.trophies,
    earnings: state.careerEarnings,
    caps: state.national.caps,
  }
}

/**
 * A single letter for a whole career, so two runs are comparable at a glance.
 *
 * The cutoffs are not guesses — they're percentiles measured over 1,200
 * simulated careers spanning every position, cadence and play style. The
 * first version graded on bands alone and put 85% of all careers on B or C,
 * which made the letter decorative. These give roughly:
 *   S 3% · A 10% · B 26% · C 28% · D 20% · E 13%
 *
 * The check that matters is not the spread but WHICH careers land where: S is
 * reserved for elite and world runs, and a career that never left the Israeli
 * league should sit in C/D/E. An earlier version handed out "שחקן עולמי" to a
 * player who spent twenty seasons at one domestic club farming titles.
 *
 * Re-measure (scripts/check-career.mjs) if the balance constants above move.
 */
const BAND_SCORE = { academy: 0, israel: 0, entry: 1, strong: 2, elite: 3, world: 4 }

const GRADES = [
  { key: 'S', min: 120, label: 'אגדה' },
  { key: 'A', min: 107, label: 'שחקן עולמי' },
  { key: 'B', min: 90,  label: 'ליגיונר צמרת' },
  { key: 'C', min: 79,  label: 'ליגיונר' },
  { key: 'D', min: 69,  label: 'יצא לחו״ל' },
  { key: 'E', min: 0,   label: 'קריירה מקומית' },
]

/**
 * Not all silverware is equal. Weighting every trophy the same let a career
 * that never left the seven-club Israeli league out-score one that reached
 * Serie A1 — the end card was handing out "שחקן עולמי" to a domestic career.
 */
const TROPHY_WEIGHT = { academy: 0.4, israel: 1, entry: 1.6, strong: 2.6, elite: 4, world: 5 }

export function careerScore(sum) {
  const silverware = sum.trophies.reduce((total, t) => total + (TROPHY_WEIGHT[t.band] ?? 1), 0)
  return sum.peak + 8 * (BAND_SCORE[sum.topBand] ?? 0) + silverware + 0.12 * sum.caps
}

export function careerGrade(sum) {
  const score = careerScore(sum)
  return { ...GRADES.find((g) => score >= g.min), score: Math.round(score) }
}

export { ROLES, clubById }
