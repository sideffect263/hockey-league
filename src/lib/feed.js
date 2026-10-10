/**
 * Pure, dependency-free feed builder for the social-feed home page.
 * Derives a sorted list of "post" objects from existing league data.
 * No DB access, no side effects — safe to unit test.
 */

/**
 * Group game_stats rows by their game_id.
 * @param {Array} gameStats
 * @returns {Object} map of game_id -> array of stat rows
 */
export function groupStatsByGame(gameStats = []) {
  const byGame = {}
  for (const s of gameStats) {
    if (!byGame[s.game_id]) byGame[s.game_id] = []
    byGame[s.game_id].push(s)
  }
  return byGame
}

/**
 * How much "freshness" a followed item is worth, expressed as time.
 *
 * Ranking is score = timestamp + (followed ? boost : 0), which keeps ONE stream rather
 * than splitting into tabs: recency still dominates, so the feed never becomes a stale
 * wall of your own team, but among items of a similar age the ones you follow surface
 * first. 18 hours is tuned so a followed item outranks unfollowed ones from the same
 * day and the day before, and loses to anything genuinely newer than that.
 */
export const FOLLOW_BOOST_MS = 18 * 60 * 60 * 1000

/**
 * Does this post concern something the viewer follows?
 * Kept separate from the builder so the rule is testable on its own.
 */
export function isFollowedPost(post, followedTeams, followedPlayers) {
  if (!followedTeams?.size && !followedPlayers?.size) return false
  const d = post.data || {}
  const team = (id) => !!id && followedTeams?.has(id)
  const player = (id) => !!id && followedPlayers?.has(id)

  switch (post.type) {
    case 'game_result':
      return team(d.game?.home_team_id) || team(d.game?.away_team_id)
    case 'milestone':
      return player(d.playerId) || team(d.team?.id)
    case 'champion':
      return team(d.team?.id)
    case 'top_scorer':
      return player(d.player?.id) || team(d.team?.id)
    case 'post':
      // a post is followed via its team, or via the author's linked player
      return team(d.post?.team_id) || player(d.author?.player_id)
    default:
      return false
  }
}

/**
 * The player a daily birthday post is about, or null. Those posts are written by
 * post_birthdays() (supabase/birthday-celebrations.sql) with
 * external_guid = birthday:<player uuid>:<year>.
 */
export function birthdayPlayerId(p) {
  const m = /^birthday:([0-9a-f-]{36}):\d{4}$/.exec(p?.external_guid || '')
  return m ? m[1] : null
}

/**
 * Tags describing what a feed item is ABOUT. Sent with every impression so the server
 * can learn affinity without knowing how the feed is built — synthetic items (game
 * results, milestones) have no table of their own to join against.
 *
 * Vocabulary (keep in step with the iOS and Android ports):
 *   type:<post.type>   origin:league|world   team:<uuid>   player:<uuid>
 *   source:<source_name>   media:video
 */
export function feedItemTags(post) {
  const d = post?.data || {}
  const tags = new Set([`type:${post?.type}`, `origin:${post?.type === 'external' ? 'world' : 'league'}`])
  const team = (id) => { if (id) tags.add(`team:${id}`) }
  const player = (id) => { if (id) tags.add(`player:${id}`) }
  switch (post?.type) {
    case 'game_result':
      team(d.game?.home_team_id); team(d.game?.away_team_id)
      break
    case 'milestone':
      player(d.playerId); team(d.team?.id)
      break
    case 'champion':
      team(d.team?.id)
      break
    case 'top_scorer':
      player(d.player?.id); team(d.team?.id)
      break
    case 'post':
      team(d.post?.team_id); player(d.author?.player_id); player(birthdayPlayerId(d.post))
      break
    case 'market':
      for (const g of d.games || []) { team(g.home_team_id); team(g.away_team_id) }
      team(d.home_team_id); team(d.away_team_id)
      break
    case 'external':
      if (d.post?.source_name) tags.add(`source:${d.post.source_name}`)
      if (/youtu\.?be/.test(d.post?.link_url || '')) tags.add('media:video')
      break
  }
  return [...tags].slice(0, 12)
}

/*
 * Personalised ranking. Everything is still expressed as TIME, on top of the item's
 * own timestamp, so recency keeps dominating and one number explains every position:
 *
 *   score = date + follow + affinity + popularity − world − seen
 *
 * - AFFINITY_MS: a tag profile of ±1 is worth ±24h. Built server-side from what this
 *   viewer lingered on, opened, liked and commented on (feed_personalization()).
 * - POPULAR_MS_PER_LOG: league-wide engagement, log-scaled and capped, so one card
 *   people reacted to rises a bit for everyone without pinning itself to the top.
 * - WORLD_PENALTY_MS: outside news yields to league content of a similar age — the
 *   wire feed must never bury what happened here. Applies to guests too.
 * - SEEN_PENALTY_MS: something you already looked at on an earlier visit sinks by two
 *   days, so every visit opens on what is new to YOU. "Seen" comes from the snapshot
 *   taken at load, so a card never jumps while you are reading.
 * Pinned posts are exempt from all of it.
 */
export const AFFINITY_MS = 24 * 60 * 60 * 1000
export const POPULAR_MS_PER_LOG = 6 * 60 * 60 * 1000
export const POPULAR_CAP_MS = 18 * 60 * 60 * 1000
export const WORLD_PENALTY_MS = 12 * 60 * 60 * 1000
export const SEEN_PENALTY_MS = 48 * 60 * 60 * 1000

/** Mean affinity of the tags we have an opinion on, clamped to −1..1. */
export function affinityOf(tags, affinity) {
  if (!affinity) return 0
  let sum = 0, n = 0
  for (const t of tags) {
    // Every tag counts, type/origin included: someone who never reads outside news
    // should see less of it, not just less of one source.
    const v = affinity[t]
    if (typeof v === 'number' && isFinite(v)) { sum += v; n++ }
  }
  return n ? Math.max(-1, Math.min(1, sum / n)) : 0
}

/**
 * Score one item. Split out so the ranking rule is unit-testable and so the parts can
 * be inspected on a live page (`post.scoreParts`).
 */
export function scoreItem(post, personalization) {
  const t = new Date(post.date).getTime()
  const parts = { date: isNaN(t) ? 0 : t, follow: 0, affinity: 0, popular: 0, world: 0, seen: 0 }
  if (post.data?.post?.pinned) return { score: parts.date, parts }
  if (post.followed) parts.follow = FOLLOW_BOOST_MS
  if (post.type === 'external') parts.world = -WORLD_PENALTY_MS
  if (personalization) {
    parts.affinity = Math.round(AFFINITY_MS * affinityOf(post.tags || feedItemTags(post), personalization.affinity))
    const pop = personalization.popular?.[post.id] || 0
    if (pop > 0) parts.popular = Math.min(POPULAR_CAP_MS, Math.round(POPULAR_MS_PER_LOG * Math.log2(1 + pop)))
    if (personalization.seen?.[post.id]) parts.seen = -SEEN_PENALTY_MS
  }
  const score = parts.date + parts.follow + parts.affinity + parts.popular + parts.world + parts.seen
  return { score, parts }
}

/**
 * Build the feed.
 * @param {Object} args
 * @param {Array} args.games
 * @param {Array} args.teams
 * @param {Array} args.players
 * @param {Array} args.gameStats
 * @param {string|null} args.championId
 * @param {string} args.seasonName
 * @param {string} args.seasonMode - 'regular' | 'final_four'
 * @param {Set} args.followedTeams - team ids the viewer follows
 * @param {Set} args.followedPlayers - player ids the viewer follows
 * @param {Object|null} args.personalization - feed_personalization() result, or null
 *   for guests / before it loads ({ seen, affinity, popular })
 * @returns {Array} post objects: { id, type, date, rank, followed, data }
 */
export function buildFeed({
  games = [],
  teams = [],
  players = [],
  gameStats = [],
  humanPosts = [],
  championId = null,
  seasonName = '',
  seasonMode = 'regular',
  followedTeams = new Set(),
  followedPlayers = new Set(),
  personalization = null,
  marketItems = [],
} = {}) {
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const playersMap = Object.fromEntries(players.map(p => [p.id, p]))

  const completed = games.filter(
    g => g.status === 'completed' && g.home_score != null && g.away_score != null
  )
  const statsByGame = groupStatsByGame(gameStats)

  const posts = []

  // ---- GAME RESULT posts ----
  for (const g of completed) {
    const home = teamsMap[g.home_team_id]
    const away = teamsMap[g.away_team_id]
    posts.push({
      id: `game-${g.id}`,
      type: 'game_result',
      date: g.game_date,
      rank: 2,
      data: { game: g, home, away, stats: statsByGame[g.id] || [] },
    })

    // ---- MILESTONE posts (aggregate goals per scorer from this game) ----
    const scorers = {}
    for (const s of (statsByGame[g.id] || [])) {
      const goals = s.goals || 0
      if (goals <= 0) continue
      const key = s.player_id ? `p${s.player_id}` : `g${s.guest_player_name}`
      if (!scorers[key]) {
        const player = s.player_id ? playersMap[s.player_id] : null
        const team = player ? teamsMap[player.team_id] : null
        scorers[key] = {
          key,
          goals: 0,
          player,
          team,
          name: player
            ? `${player.first_name} ${player.last_name}`
            : (s.guest_player_name || ''),
          teamName: team ? team.name : (s.guest_player_original_team || ''),
        }
      }
      scorers[key].goals += goals
    }

    for (const sc of Object.values(scorers)) {
      if (sc.goals < 3) continue
      posts.push({
        id: `ms-${g.id}-${sc.key}`,
        type: 'milestone',
        date: g.game_date,
        rank: 1,
        data: {
          kind: sc.goals >= 5 ? 'big_game' : 'hat_trick',
          name: sc.name,
          playerId: sc.player?.id || null,
          team: sc.team,
          teamName: sc.teamName,
          goals: sc.goals,
          game: g,
          home,
          away,
        },
      })
    }
  }

  // ---- Determine last game date (for champion / top-scorer synthetic dates) ----
  let lastGameTime = null
  for (const g of completed) {
    const t = new Date(g.game_date).getTime()
    if (!isNaN(t) && (lastGameTime == null || t > lastGameTime)) lastGameTime = t
  }
  if (lastGameTime == null) lastGameTime = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  // ---- CHAMPION post ----
  if (seasonMode === 'final_four' && championId && teamsMap[championId]) {
    posts.push({
      id: 'champion',
      type: 'champion',
      date: new Date(lastGameTime + DAY).toISOString(),
      rank: 100,
      data: { team: teamsMap[championId], seasonName },
    })
  }

  // ---- TOP SCORER post (authoritative season total from players.goals) ----
  // Season-summary card: like the champion, only once the season is decided — mid-season
  // the current leader isn't "מלך השערים של העונה" yet.
  const seasonOver = seasonMode === 'final_four' && !!championId
  const topScorer = !seasonOver ? null : players
    .filter(p => p.position === 'Field Player' && (p.goals || 0) > 0)
    .reduce((best, p) => ((p.goals || 0) > (best?.goals || 0) ? p : best), null)
  if (topScorer) {
    // 1 second earlier than the champion so the champion sorts first on the same day.
    posts.push({
      id: 'top-scorer',
      type: 'top_scorer',
      date: new Date(lastGameTime + DAY - 1000).toISOString(),
      rank: 90,
      data: {
        player: topScorer,
        team: teamsMap[topScorer.team_id],
        goals: topScorer.goals || 0,
      },
    })
  }

  // ---- HUMAN posts (Stage B2) ----
  for (const p of humanPosts) {
    if (!p || p.deleted_at) continue
    // An ingested item carries source_name; it gets its own type so the "פוסטים"
    // filter keeps meaning "what people here wrote" rather than silently mixing
    // in a wire feed. See supabase/functions/ingest-rink-hockey-news.
    // Birthday posts are sourced too (so native shows them without a release), but they
    // are league content, not world news.
    const isExternal = !!p.source_name && !birthdayPlayerId(p)
    posts.push({
      id: `post-${p.id}`,
      type: isExternal ? 'external' : 'post',
      date: p.created_at,
      rank: isExternal ? 60 : 50,
      data: {
        post: p,
        author: p.author || null,
        team: p.team_id ? teamsMap[p.team_id] : null,
      },
    })
  }

  // ---- הוקי מרקט cards (market_feed RPC — empty for anyone under 18) ----
  for (const m of marketItems) {
    if (!m?.kind || !m?.key) continue
    posts.push({ id: `market-${m.key}`, type: 'market', date: m.date, rank: 55, data: m })
  }

  // ---- Rank: recency, plus time-denominated nudges (see scoreItem) ----
  // One stream, not tabs: a followed / liked-topic item floats above same-age
  // neighbours but still loses to genuinely newer news, so the feed stays current AND
  // personal.
  for (const p of posts) {
    p.followed = isFollowedPost(p, followedTeams, followedPlayers)
    p.tags = feedItemTags(p)
    const { score, parts } = scoreItem(p, personalization)
    p.score = score
    p.scoreParts = parts
  }

  posts.sort((a, b) => {
    const ds = b.score - a.score
    if (ds !== 0) return ds
    return b.rank - a.rank
  })

  return posts
}
