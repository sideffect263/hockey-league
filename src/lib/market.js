import { supabase } from './supabase'

/**
 * הוקי מרקט — a play-money prediction market.
 *
 * Pricing is an LMSR automated market maker rather than an order book. With a
 * league this size an order book would never fill: you would post a bet and sit
 * there. The AMM is always the counterparty, so a trade is instant, and the price
 * it quotes IS the market's implied probability — the thing that makes the board
 * feel alive between games.
 *
 * The functions below mirror the SQL in market_lse / market_prices /
 * market_shares_for_coins exactly, so the stake box can quote a price on every
 * keystroke without a round trip. They are for DISPLAY ONLY. Every coin that
 * actually moves is priced again inside the RPC under a row lock — this file
 * cannot be trusted and is not trusted.
 */

/** Coins a wallet opens with. Mirrors market_wallets.balance's default. */
export const START_BALANCE = 1000

// ── LMSR ────────────────────────────────────────────────────────────────────
// Every exponent is shifted by the largest one before Math.exp, so the biggest
// term is always 1. Without the shift a market that ran up a few thousand shares
// would overflow to Infinity and the whole board would render NaN.

function shifted(qs, b) {
  const xs = qs.map(q => Number(q) / b)
  const m = Math.max(...xs)
  return { m, es: xs.map(x => Math.exp(x - m)) }
}

/** Price of every outcome, in the order given. Always sums to 1. */
export function prices(qs, b) {
  if (!qs?.length) return []
  const { es } = shifted(qs, b)
  const sum = es.reduce((a, e) => a + e, 0)
  return es.map(e => e / sum)
}

/**
 * Shares bought by spending exactly `coins` on outcome `idx`.
 *   Δ = b·ln( (s·e^(coins/b) − r) / a )
 * A closed form, so "spend 100" is exact instead of a solver's approximation.
 */
export function sharesForCoins(qs, b, idx, coins) {
  if (!(coins > 0) || !qs?.length) return 0
  const k = coins / b
  if (k > 300) return 0 // guarded server-side too; refuse rather than show Infinity
  const { es } = shifted(qs, b)
  const s = es.reduce((a, e) => a + e, 0)
  const a = es[idx]
  if (!(a > 0)) return 0
  const inner = (s * Math.exp(k) - (s - a)) / a
  return inner > 0 ? b * Math.log(inner) : 0
}

/** Coins returned for selling `shares` of outcome `idx` (always >= 0). */
export function coinsForShares(qs, b, idx, shares) {
  if (!(shares > 0) || !qs?.length) return 0
  const lse = arr => {
    const m = Math.max(...arr)
    return m + Math.log(arr.reduce((a, x) => a + Math.exp(x - m), 0))
  }
  const before = qs.map(q => Number(q) / b)
  const after = before.slice()
  after[idx] -= shares / b
  return Math.max(0, b * (lse(before) - lse(after)))
}

/** Average price actually paid — what a trader reads as "my entry". */
export function avgPrice(coins, shares) {
  return shares > 0 ? coins / shares : 0
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** A probability as a whole percent. */
export const pct = p => `${Math.round((p || 0) * 100)}%`

/** Coins, grouped, no decimals unless they matter. */
export function coins(n) {
  const v = Number(n || 0)
  return v.toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) < 100 && !Number.isInteger(v) ? 2 : 0,
  })
}

/** Hebrew label for why a signed-in user cannot trade. */
export const BLOCK_COPY = {
  'signed-out': {
    title: 'צריך להתחבר',
    body: 'הוקי מרקט פתוח לשחקני הליגה הרשומים בלבד.',
  },
  'no-player': {
    title: 'הכרטיס שלך עדיין לא משויך',
    body: 'הוקי מרקט פתוח לשחקנים עם כרטיס שחקן בליגה. אם יש לך כרטיס, אפשר לבקש שיוך מהדף שלי.',
  },
  'no-dob': {
    title: 'חסר תאריך לידה',
    body: 'המרקט פתוח לגילאי 18 ומעלה בלבד, ולכן צריך תאריך לידה בכרטיס השחקן.',
  },
  'under-18': {
    title: 'המרקט פתוח מגיל 18',
    body: 'לפי תאריך הלידה בכרטיס השחקן שלך עדיין לא מלאו לך 18. הגישה תיפתח מעצמה ביום ההולדת.',
  },
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Why the signed-in user can't trade, or null if they can. */
export async function getBlockReason() {
  const { data, error } = await supabase.rpc('market_block_reason')
  if (error) return 'signed-out'
  return data ?? null
}

/**
 * Opens the wallet on first call (1,000 coins) and returns it, paying out any
 * weekly allowance owed since the last visit. Idempotent — the stake is granted
 * once, and a second call in the same week credits nothing.
 *
 * Shape: { balance, allowance_credited, allowance_weeks, next_allowance_at }
 */
export async function getWallet() {
  const { data, error } = await supabase.rpc('market_wallet')
  if (error) throw error
  return data
}

/**
 * Every market with its outcomes, live prices, and enough context to render a
 * card. Teams and players are fetched as flat lookups rather than nested embeds:
 * a bare embed here would break the moment a second FK to either table appears
 * (PGRST201), which has already bitten this codebase once.
 */
export async function listMarkets() {
  const [{ data: markets, error: e1 }, { data: outcomes, error: e2 }] = await Promise.all([
    supabase.from('markets').select('*').order('closes_at', { ascending: true, nullsFirst: false }),
    supabase.from('market_outcomes').select('*').order('ord'),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const gameIds = markets.filter(m => m.game_id).map(m => m.game_id)
  const playerIds = [...new Set(outcomes.map(o => o.player_id).filter(Boolean))]

  const [games, players] = await Promise.all([
    gameIds.length
      ? supabase.from('games').select('id, game_date, venue, status, home_team_id, away_team_id')
          .in('id', gameIds).then(r => r.data || [])
      : [],
    playerIds.length
      ? supabase.from('players').select('id, first_name, last_name, photo_url, team_id')
          .in('id', playerIds).then(r => r.data || [])
      : [],
  ])

  // Teams wait on players deliberately: a runner in מלך השערים carries no
  // team_id of its own, and the price chart colours that line by the team the
  // player plays for. One extra round trip, and only when the board holds a
  // player market at all.
  const teamIds = [...new Set([
    ...outcomes.map(o => o.team_id),
    ...players.map(p => p.team_id),
  ].filter(Boolean))]

  const teams = teamIds.length
    ? await supabase.from('teams').select('id, name, logo_url, primary_color')
        .in('id', teamIds).then(r => r.data || [])
    : []

  const gameById = Object.fromEntries(games.map(g => [g.id, g]))
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]))
  const playerById = Object.fromEntries(players.map(p => [p.id, p]))

  return markets.map(m => {
    const os = outcomes.filter(o => o.market_id === m.id)
    const ps = prices(os.map(o => o.q), Number(m.b))
    return {
      ...m,
      game: m.game_id ? gameById[m.game_id] || null : null,
      outcomes: os.map((o, i) => {
        const player = o.player_id ? playerById[o.player_id] || null : null
        const team = o.team_id ? teamById[o.team_id] || null : null
        return {
          ...o,
          price: ps[i] ?? 0,
          team,
          player,
          // The team this outcome is coloured by — its own, or the one the
          // player belongs to. Deliberately NOT `team`: OutcomeFace draws a
          // crest whenever `team` is set, so filling it in for a player would
          // replace every runner's photo with their club badge.
          markTeam: team || (player?.team_id ? teamById[player.team_id] || null : null),
        }
      }),
    }
  })
}

/**
 * My open positions, keyed by outcome id.
 *
 * The user filter is explicit and load-bearing: market_positions is readable by
 * its owner OR an admin, so leaning on RLS alone handed a manager the whole
 * league's book. Keyed by outcome, two traders holding the same outcome then
 * collapsed onto one row, and the wallet hero added strangers' shares into
 * "שווי תיק" — an admin with an empty portfolio was shown 2,534 coins.
 */
export async function getMyPositions() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data, error } = await supabase
    .from('market_positions').select('*').eq('user_id', user.id).gt('shares', 0)
  if (error) return {}
  return Object.fromEntries((data || []).map(p => [p.outcome_id, p]))
}

/** The tape for one market, newest first. */
export async function getTrades(marketId, limit = 60) {
  const { data, error } = await supabase
    .from('market_trades').select('*')
    .eq('market_id', marketId).order('created_at', { ascending: false }).limit(limit)
  if (error) return []
  const ids = [...new Set((data || []).map(t => t.user_id))]
  if (!ids.length) return []
  const { data: profs } = await supabase
    .from('profiles').select('id, display_name, avatar_url').in('id', ids)
  const by = Object.fromEntries((profs || []).map(p => [p.id, p]))
  return (data || []).map(t => ({ ...t, trader: by[t.user_id] || null }))
}

/**
 * Ids of every market that has already traded, as a Set.
 *
 * An outcome set is frozen the moment the first coin moves — LMSR prices are
 * computed across the whole field, so a runner added underneath an open position
 * silently re-prices shares somebody already paid for. The server enforces it;
 * this read exists so the manager sees the lock before typing a name into a form
 * that was never going to accept it.
 */
export async function getTradedMarketIds() {
  const { data, error } = await supabase.from('market_trades').select('market_id')
  if (error) return new Set()
  return new Set((data || []).map(r => r.market_id))
}

export async function getLeaderboard() {
  const { data, error } = await supabase.rpc('market_leaderboard')
  if (error) throw error
  return data || []
}

/**
 * Markets I'm barred from, as a Map of market id → reason ('own-team' |
 * 'referee'). Resolved in one round trip so the board can grey them out up front
 * with the rule that applied, rather than letting someone pick an outcome and
 * type a stake before being told no.
 */
export async function getConflicts() {
  const { data } = await supabase.rpc('market_my_conflicts')
  return new Map((data || []).map(r => [r.market_id, r.reason]))
}

/** Why a market is locked for me, in Hebrew. */
export const CONFLICT_COPY = {
  'own-team': 'משחק של הקבוצה שלך — לא ניתן למסחר',
  referee: 'אתה שופט את המשחק הזה — לא ניתן למסחר',
}

// ── Writes ──────────────────────────────────────────────────────────────────

function tradeError(error) {
  const m = error?.message || ''
  if (/not enough coins/i.test(m)) return new Error('אין לך מספיק מטבעות')
  if (/refereeing/i.test(m)) return new Error('אי אפשר להמר על משחק שאתה שופט')
  if (/own team/i.test(m)) return new Error('אי אפשר להמר על משחק של הקבוצה שלך')
  if (/no longer trading|is (closed|resolved|void)/i.test(m)) return new Error('המסחר בשוק הזה נסגר')
  if (/no shares to sell/i.test(m)) return new Error('אין לך פוזיציה למכירה כאן')
  if (/must be positive|too small/i.test(m)) return new Error('הסכום קטן מדי')
  if (/too large/i.test(m)) return new Error('הסכום גדול מדי לשוק הזה')
  if (/not eligible/i.test(m)) return new Error('אין לך גישה להוקי מרקט')
  return new Error('הפעולה נכשלה, נסו שוב')
}

export async function buy(outcomeId, coinsAmount) {
  const { data, error } = await supabase.rpc('market_buy', {
    p_outcome: outcomeId, p_coins: coinsAmount,
  })
  if (error) throw tradeError(error)
  return data
}

export async function sell(outcomeId, shares) {
  const { data, error } = await supabase.rpc('market_sell', {
    p_outcome: outcomeId, p_shares: shares,
  })
  if (error) throw tradeError(error)
  return data
}

// ── Manager ─────────────────────────────────────────────────────────────────

export async function getTraders() {
  const { data, error } = await supabase.rpc('market_admin_traders')
  if (error) throw error
  return data || []
}

export async function adjustCoins(userId, delta, reason) {
  const { data, error } = await supabase.rpc('market_admin_adjust', {
    p_user: userId, p_delta: delta, p_reason: reason || null,
  })
  if (error) throw error
  return data
}

export async function resolveMarket(marketId, outcomeId, note) {
  const { error } = await supabase.rpc('market_admin_resolve', {
    p_market: marketId, p_outcome: outcomeId, p_note: note || null,
  })
  if (error) throw error
}

export async function voidMarket(marketId, note) {
  const { error } = await supabase.rpc('market_admin_void', {
    p_market: marketId, p_note: note || null,
  })
  if (error) throw error
}

export async function setMarketStatus(marketId, status) {
  const { error } = await supabase.rpc('market_admin_set_status', {
    p_market: marketId, p_status: status,
  })
  if (error) throw error
}

export async function setLiquidity(marketId, b) {
  const { error } = await supabase.rpc('market_admin_set_liquidity', {
    p_market: marketId, p_b: b,
  })
  if (error) {
    if (/already traded/i.test(error.message || '')) throw new Error('כבר בוצעו עסקאות בשוק הזה')
    throw error
  }
}

/**
 * Moves a custom market's trading deadline. `closesAt` is an ISO instant, or
 * null for "no deadline" — trades until the manager closes it by hand.
 *
 * Only custom (futures) markets: a game market's deadline IS its fixture's
 * date, and rescheduling the fixture rewrites it, so an edit there would be
 * silently undone the next time the game moved.
 *
 * Returns { closes_at, status } — a deadline that has already passed closes the
 * market on the spot, so the caller has to read the status back rather than
 * assume the market is still trading.
 */
export async function setMarketCloses(marketId, closesAt) {
  const { data, error } = await supabase.rpc('market_admin_set_closes', {
    p_market: marketId, p_closes_at: closesAt || null,
  })
  if (error) {
    const m = error.message || ''
    if (/closes with its fixture/i.test(m)) throw new Error('שוק משחק נסגר לפי מועד המשחק')
    if (/already settled/i.test(m)) throw new Error('השוק כבר הוכרע ואי אפשר לשנות אותו')
    if (/not authorized/i.test(m)) throw new Error('אין לך הרשאה לפעולה הזו')
    throw new Error('שמירת התאריך נכשלה, נסו שוב')
  }
  return data
}

export async function createFutures({ title, subtitle, closesAt, b }) {
  const { data, error } = await supabase.rpc('market_admin_create_futures', {
    p_title: title, p_subtitle: subtitle || null,
    p_closes_at: closesAt || null, p_b: b || 1000,
  })
  if (error) throw error
  return data
}

export async function addOutcome(marketId, label, teamId, playerId) {
  const { data, error } = await supabase.rpc('market_admin_add_outcome', {
    p_market: marketId, p_label: label, p_team: teamId || null, p_player: playerId || null,
  })
  if (error) {
    if (/already traded/i.test(error.message || '')) throw new Error('כבר בוצעו עסקאות בשוק הזה')
    throw error
  }
  return data
}

export async function removeOutcome(outcomeId) {
  const { error } = await supabase.rpc('market_admin_remove_outcome', { p_outcome: outcomeId })
  if (error) {
    if (/already traded/i.test(error.message || '')) throw new Error('כבר בוצעו עסקאות בשוק הזה')
    throw error
  }
}

export async function syncGameMarkets() {
  const { data, error } = await supabase.rpc('market_sync_games')
  if (error) throw error
  return data || 0
}

/**
 * Trade activity per market, keyed by market id:
 *   { trades, volume, traders, last }
 *
 * The whole tape is small enough to count on the client (a season is a few
 * hundred rows at most) and it is already readable by anyone allowed on the
 * board, so this is one round trip instead of a new aggregate RPC.
 */
export async function getActivity() {
  const { data, error } = await supabase
    .from('market_trades').select('market_id, coins, user_id, created_at')
  if (error) return new Map()
  const by = new Map()
  for (const t of data || []) {
    let a = by.get(t.market_id)
    if (!a) { a = { trades: 0, volume: 0, traders: new Set(), last: null }; by.set(t.market_id, a) }
    a.trades += 1
    a.volume += Number(t.coins || 0)
    a.traders.add(t.user_id)
    if (!a.last || t.created_at > a.last) a.last = t.created_at
  }
  return new Map([...by].map(([id, a]) => [
    id, { trades: a.trades, volume: a.volume, traders: a.traders.size, last: a.last },
  ]))
}

const DAY = 86400000

/**
 * The one market the board opens with.
 *
 * A featured slot is only worth the space it takes if it lands on the market a
 * trader would have gone looking for anyway, so it scores the two things that
 * make a market interesting — that other people are trading it, and that the
 * window to trade it is closing — and never picks one the viewer is barred
 * from, which would be a hero card they can only look at.
 *
 * Returns null when nothing is open; the board then renders as it always did.
 */
export function pickFeatured(markets, activity = new Map(), conflicts = new Map()) {
  const now = Date.now()
  let best = null, bestScore = -Infinity
  for (const m of markets || []) {
    if (m.status !== 'open') continue
    if (conflicts.get(m.id)) continue
    if (!m.outcomes?.length) continue

    const a = activity.get(m.id)
    let score = 0
    if (a) {
      score += Math.min(a.trades, 20) * 3
      score += Math.min(a.traders, 10) * 2
      score += Math.min(a.volume / 500, 10)
      const age = now - new Date(a.last).getTime()
      if (age < 3 * DAY) score += 12
      else if (age < 14 * DAY) score += 6
    }
    const left = m.closes_at ? new Date(m.closes_at).getTime() - now : null
    if (left != null && left > 0) {
      if (left < 2 * DAY) score += 14
      else if (left < 7 * DAY) score += 8
      else if (left < 30 * DAY) score += 3
    }
    // A tie between two untouched markets should at least be stable rather than
    // re-ordering on every load.
    score += m.kind === 'game' ? 2 : 0
    if (score > bestScore) { best = m; bestScore = score }
  }
  return best
}
