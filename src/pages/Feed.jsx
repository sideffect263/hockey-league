import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { getGames, getTeams, getPlayers, getGameStats, getLeagueSetting, getPosts, getMyLikes, getRoleBadges } from "@/lib/api"
import { getItemLikes, getItemCommentCounts } from "@/lib/reactions"
import { getMyBlocks } from "@/lib/moderation"
import { useAuth } from "@/lib/AuthContext"
import { RefreshCw } from "lucide-react"
import { RinkIcon as Rink } from "@/components/icons/BrandIcons"
import { useSeasonMode, useSeasonName } from "@/App"
import { buildFeed, arrangeFeed, parseRanking } from "@/lib/feed"
import { getMyFollowSets } from "@/lib/follows"
import { getMarketFeed } from "@/lib/market"
import { setFeedTracking, observeFeedItem, getFeedPersonalization } from "@/lib/feedImpressions"
import { attachEventPhotos } from "@/lib/eventPhotos"
import { getPhotoIndex, getCachedPhotoIndex } from "@/lib/media"
import { getPhotoOverrides } from "@/lib/photoOverrides"
import { getMentions, MENTION_KIND } from "@/lib/mentionsApi"
import FeedPost from "@/components/feed/FeedPost"
import ComposerSheet, { ComposerPrompt } from "@/components/feed/ComposerSheet"
import FeedStories from "@/components/feed/FeedStories"
import FeedRoleCards from "@/components/feed/FeedRoleCards"
import LiveStory from "@/components/feed/LiveStory"
import { SeenHeader } from "@/components/feed/WorldPost"
import { getMyApprovedGameIds } from "@/lib/officials"
import { ilDay } from "@/lib/feedGamePost"
import { feedDemoOn, demoJudgeIds } from "@/components/feed/feedHarnessDemo"
import LiveGameBanner from "@/components/LiveGameBanner"
import { useLiveGames } from "@/lib/useLiveGames"
import FeedFilters, { matchesFilter } from "@/components/feed/FeedFilters"
import QuickActions from "@/components/feed/QuickActions"
import LoanInvite from "@/components/LoanInvite"
import VideoRail from "@/components/feed/VideoRail"
import { StandingsWidget, NextGameWidget, LeadersWidget, StandingsPost } from "@/components/feed/Widgets"
import { FeedSkeleton, SkeletonFeedPosts } from "@/components/skeletons/PageSkeletons"

const PAGE_SIZE = 25
// ONE unified smart feed (Ariel 10-27): the בשבילך / הכי חדש toggle is gone, the ranking stays.
const ORDER = "for_you"
// Stable identity so the feed useMemo doesn't rebuild on every render for guests.
const EMPTY_FOLLOWS = { teams: new Set(), players: new Set(), notify: new Set() }

/** The deep-link anchor wrapper, which also reports the card's impressions. */
function TrackedItem({ post, children }) {
  const ref = useRef(null)
  // Tags change only with the item's identity; joining keeps the effect from
  // re-subscribing on every feed rebuild.
  const tagKey = (post.tags || []).join('|')
  // The "caught up" line is not content — nothing to log.
  const synthetic = post.type === "caught_up" || post.type === "seen_header" || post.type === "standings"
  useEffect(() => synthetic ? undefined : observeFeedItem(ref.current, post.id, post.tags), [post.id, tagKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} id={post.id} className="scroll-mt-24">{children}</div>
}


const PHOTO_OVERRIDES_CACHE_KEY = 'photo-overrides-v1'
function readCachedOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(PHOTO_OVERRIDES_CACHE_KEY) || 'null')
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch { return {} }
}

export default function Feed() {
  const { seasonMode } = useSeasonMode()
  const seasonName = useSeasonName()
  const { user, profile, coachTeamIds = [], isJudgeRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const [composeOpen, setComposeOpen] = useState(false)
  const [liveStoryId, setLiveStoryId] = useState(null)   // the tapped live story's game id
  const closeCompose = useCallback(() => setComposeOpen(false), [])
  const closeLive = useCallback(() => setLiveStoryId(null), [])
  const [judgeIds, setJudgeIds] = useState(null)       // games this referee is on → "שפטת" + his cards
  const [games, setGames] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [gameStats, setGameStats] = useState([])
  const [posts, setPosts] = useState([])
  const [roleBadges, setRoleBadges] = useState({}) // { [userId]: { isAdmin, roles } }
  const [postMentions, setPostMentions] = useState({}) // { [postId]: active @-tags }
  const [photoIndex, setPhotoIndex] = useState(() => getCachedPhotoIndex() || { photos: [], photoPlayers: [] })
  const [photoOverrides, setPhotoOverrides] = useState(readCachedOverrides)
  const [likedPostIds, setLikedPostIds] = useState(() => new Set())
  const [likedItems, setLikedItems] = useState(() => new Set())
  const [itemLikeCounts, setItemLikeCounts] = useState({})
  const [itemCommentCounts, setItemCommentCounts] = useState({})
  const [blockedIds, setBlockedIds] = useState(() => new Set())
  const [follows, setFollows] = useState(EMPTY_FOLLOWS)
  const [personalization, setPersonalization] = useState(null)
  const [marketItems, setMarketItems] = useState([])
  const [championId, setChampionId] = useState(null)
  // league_settings.feed_ranking — the ranking knobs, tunable with no release (lib/feed.js).
  const [rankingRaw, setRankingRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("all")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef(null)

  useEffect(() => { loadData() }, [])

  // The + fan's "פוסט חדש" links here with ?compose=1: open the composer sheet, then drop
  // the param so a reload or Back does not open it again.
  useEffect(() => {
    if (params.get("compose") !== "1") return
    setComposeOpen(true)
    const next = new URLSearchParams(params)
    next.delete("compose")
    setParams(next, { replace: true })
  }, [params, setParams])

  // A referee's games (approved / assigned): his action cards and the "שפטת" chip.
  useEffect(() => {
    if (!user || !isJudgeRole) { setJudgeIds(null); return }
    let alive = true
    getMyApprovedGameIds("judge").then(ids => { if (alive) setJudgeIds(ids?.size || !feedDemoOn() ? ids : demoJudgeIds(games)) }).catch(() => {})
    return () => { alive = false }
  }, [user, isJudgeRole, games])

  // Likes/comments for synthetic feed items (game results, milestones, …).
  // Loaded separately from loadData so it stays decoupled from other feed work.
  useEffect(() => {
    getItemLikes().then(({ counts, mine }) => { setItemLikeCounts(counts); setLikedItems(mine) }).catch(() => {})
    getItemCommentCounts().then(setItemCommentCounts).catch(() => {})
  }, [])

  // What the viewer follows → the feed ranker gives those items a freshness bonus.
  // Guests follow nothing, so they get the plain chronological stream.
  useEffect(() => {
    if (!user) { setFollows(EMPTY_FOLLOWS); return }
    let alive = true
    getMyFollowSets().then(f => { if (alive) setFollows(f) }).catch(() => {})
    return () => { alive = false }
  }, [user])

  // Personalised ranking inputs (seen / affinity / popular) + impression tracking.
  // Loaded ONCE per visit: "seen" is a snapshot of earlier visits, so a card you are
  // reading never jumps because you just looked at it. Guests are neither tracked nor
  // personalised.
  useEffect(() => {
    setFeedTracking(!!user)
    if (!user) { setPersonalization(null); return }
    let alive = true
    getFeedPersonalization().then(p => { if (alive) setPersonalization(p) })
    return () => { alive = false }
  }, [user])

  // סטופר מרקט cards — for every viewer, guests included (public since 2026-10-27).
  // The server leaves the podium card (names) out for a guest. Re-read on sign-in.
  useEffect(() => {
    let alive = true
    getMarketFeed().then(items => { if (alive) setMarketItems(items) })
    return () => { alive = false }
  }, [user])

  // The viewer's block list — loaded only when signed in (skips the round trip for
  // guests). Used to hide blocked authors' posts + comments across the feed.
  useEffect(() => {
    if (!user) { setBlockedIds(new Set()); return }
    let alive = true
    getMyBlocks().then(ids => { if (alive) setBlockedIds(new Set(ids)) }).catch(() => {})
    return () => { alive = false }
  }, [user])

  // The photo index is heavy (thousands of rows) and only decorates cards, so it
  // loads separately — the feed paints immediately and photos fill in a moment later.
  // The admin photo overrides ride alongside it (a public read → guests get them too).
  // Both start from this browser's last copy (see getCachedPhotoIndex) so a returning
  // visitor's cards have their photos on first paint instead of ~1.5 s later.
  useEffect(() => {
    getPhotoIndex().then(setPhotoIndex).catch(() => {})
    getPhotoOverrides().then(o => {
      setPhotoOverrides(o)
      try { localStorage.setItem(PHOTO_OVERRIDES_CACHE_KEY, JSON.stringify(o)) } catch { /* ignore */ }
    }).catch(() => {})
  }, [])

  // League-role badges for post authors — fetched once posts are known so a
  // member's role (מנהל / מאמן / עורך תוכן / שופט) shows next to their name.
  useEffect(() => {
    const authorIds = posts.map(p => p.author_id).filter(Boolean)
    if (!authorIds.length) return
    getRoleBadges(authorIds).then(setRoleBadges).catch(() => {})
  }, [posts])

  // Active @player tags on the loaded posts (one chunked read; a miss = plain text).
  useEffect(() => {
    if (!posts.length) return
    let alive = true
    getMentions(MENTION_KIND.post, posts.map(p => p.id)).then(m => { if (alive) setPostMentions(prev => ({ ...prev, ...m })) })
    return () => { alive = false }
  }, [posts])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [g, t, p, s, champ, po, likes, rk] = await Promise.all([
        getGames(), getTeams(), getPlayers(), getGameStats(), getLeagueSetting('champion_team_id'), getPosts(), getMyLikes(),
        getLeagueSetting('feed_ranking').catch(() => null),   // defaults if unreadable
      ])
      setGames(g); setTeams(t); setPlayers(p); setGameStats(s); setChampionId(champ); setPosts(po); setLikedPostIds(new Set(likes)); setRankingRaw(rk)
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  // Reset pagination whenever the active filter changes
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [filter])

  const teamsMap = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])
  const playersMap = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players])
  const gamesById = useMemo(() => Object.fromEntries(games.map(g => [g.id, g])), [games])

  // Games being officiated right now — realtime, independent of the feed load.
  const liveGames = useLiveGames()

  // Rebuilds only when the underlying data changes — not on every scroll/like re-render.
  const ranking = useMemo(() => parseRanking(rankingRaw), [rankingRaw])
  const feed = useMemo(() => attachEventPhotos(
    buildFeed({
      games, teams, players, gameStats,
      humanPosts: posts.filter(p => !blockedIds.has(p.author_id)),
      championId, seasonName, seasonMode,
      followedTeams: follows.teams, followedPlayers: follows.players,
      personalization, marketItems, ranking,
    }),
    { photos: photoIndex.photos, photoPlayers: photoIndex.photoPlayers, players },
    photoOverrides
  ), [games, teams, players, gameStats, posts, championId, seasonName, seasonMode, photoIndex, blockedIds, photoOverrides, follows, personalization, marketItems, ranking])

  // "הכל" is what people scroll: one post per game, new-to-you first, outside news as
  // one post (arrangeFeed). The other filters keep the flat list, one item per thing.
  // The viewer's own teams (plays for / coaches: the "הקבוצה שלך" chip) and every team that
  // makes a game "yours" (own + followed: ordering and the stories row).
  const playerTeamId = profile?.player?.team_id || null
  const ownTeamIds = useMemo(() => new Set([playerTeamId, ...coachTeamIds].filter(Boolean)), [playerTeamId, coachTeamIds.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  const myTeamIds = useMemo(() => new Set([...ownTeamIds, ...follows.teams]), [ownTeamIds, follows])
  const storyTeamIds = useMemo(() => {
    const order = [...teams].sort((a, b) => (b.points || 0) - (a.points || 0)).map(t => t.id)
    const own = [...ownTeamIds]
    const followed = order.filter(id => follows.teams.has(id) && !ownTeamIds.has(id))
    return [...own, ...followed]
  }, [teams, ownTeamIds, follows])

  const arranged = useMemo(() => {
    const list = arrangeFeed(feed, { games, personalization, followedTeams: myTeamIds, mode: ORDER, ranking })
    // The table as a post right after the game posts of the top section (FeedPlayer board),
    // while the season has results; "כבר ראית" over what he already saw (FeedTail board).
    const out = [...list]
    const line = out.findIndex(it => it.type === "caught_up")
    const topEnd = line < 0 ? out.length : line
    let lastGame = -1
    for (let i = 0; i < topEnd; i++) if (out[i].type === "game") lastGame = i
    const done = games.filter(g => g.status === "completed" && g.game_type !== "ידידותי")
    if (done.length && teams.length) {
      const round = new Set(done.map(g => ilDay(g.game_date))).size
      out.splice(lastGame + 1, 0, { id: "row-standings", type: "standings", data: { round } })
    }
    const w = out.findIndex(it => it.type === "world")
    const afterLine = out.findIndex(it => it.type === "caught_up")
    const seenAt = w >= 0 ? w + 1 : afterLine >= 0 ? afterLine + 1 : -1
    if (seenAt > 0 && seenAt < out.length) out.splice(seenAt, 0, { id: "row-seen", type: "seen_header" })
    return out
  }, [feed, games, teams, personalization, myTeamIds, ranking])
  const firstGameId = useMemo(() => arranged.find(it => it.type === "game")?.id, [arranged])
  const showPredict = !!user && (!!profile?.player_id || coachTeamIds.length > 0)

  const counts = useMemo(() => ({
    all: arranged.filter(p => !["caught_up", "seen_header", "standings"].includes(p.type)).length,
    posts: feed.filter(p => matchesFilter(p, "posts")).length,
    results: feed.filter(p => matchesFilter(p, "results")).length,
    highlights: feed.filter(p => matchesFilter(p, "highlights")).length,
    world: feed.filter(p => matchesFilter(p, "world")).length,
    video: feed.filter(p => matchesFilter(p, "video")).length,
  }), [feed, arranged])

  const handlePosted = (newPost, tags = []) => {
    if (!newPost) return
    if (tags.length) setPostMentions(prev => ({ ...prev, [newPost.id]: tags }))
    setPosts(prev => [newPost, ...prev])
  }

  // An admin refreshed a card's photo — mirror the new pin into the overrides map so
  // the memo re-resolves that card in place (no refetch). photo === null → "no photo".
  const handlePhotoRefreshed = (itemKey, photo) => {
    setPhotoOverrides(prev => ({ ...prev, [itemKey]: photo?.photo_id ?? null }))
  }

  const filtered = filter === "all" ? arranged : feed.filter(p => matchesFilter(p, filter))
  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  // Auto-paginate when the sentinel near the bottom scrolls into view
  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setVisibleCount(c => c + PAGE_SIZE) },
      { rootMargin: "600px 0px" }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, filtered.length])

  if (loading) return <FeedSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  const liveStory = liveStoryId ? liveGames.find(l => l.game_id === liveStoryId) : null
  const liveGame = liveStory ? gamesById[liveStory.game_id] : null
  const renderItem = (post, i) => {
    if (post.type === "standings") return <StandingsPost teams={teams} round={post.data.round} myTeamIds={myTeamIds} />
    if (post.type === "seen_header") return <SeenHeader />
    const g = post.type === "game" || post.type === "game_result" ? post.data.game : null
    const chip = g && (ownTeamIds.has(g.home_team_id) || ownTeamIds.has(g.away_team_id)) ? "mine"
      : g && judgeIds?.has(g.id) ? "refereed" : null
    return (
      <FeedPost priority={i < 2} post={post} playersMap={playersMap} teamsMap={teamsMap} roleBadges={roleBadges} likedPostIds={likedPostIds}
        likedItems={likedItems} itemLikeCounts={itemLikeCounts} itemCommentCounts={itemCommentCounts} blockedIds={blockedIds}
        onPhotoRefreshed={handlePhotoRefreshed} mentions={postMentions[post.data?.post?.id]}
        large={post.id === firstGameId} chip={chip} showPredict={showPredict} />
    )
  }

  return (
    // Floodlight feed (FeedFan / FeedCoach / FeedLM / FeedRef boards). The shell header IS the
    // feed header (brand, search, bell, avatar), so the page starts with the stories row.
    // Phone: stories → the role's action cards (coach / LM / referee only; fan + player feeds
    // are clean) → posts edge to edge with an 8px page strip between them. Desktop: the same
    // ~600px column, centred, with the filters + quick actions and the widgets in side rails.
    <div className="mx-auto max-w-[1240px] px-4 pt-1 pb-6 sm:px-6 lg:px-8 lg:pt-6">
      <div className="lg:grid lg:grid-cols-[240px_minmax(0,600px)_300px] lg:justify-center lg:gap-8 lg:items-start">
        {/* (1) Filter rail — right in RTL (desktop) */}
        <aside className="hidden lg:block lg:sticky lg:top-20 self-start space-y-4">
          <FeedFilters active={filter} onChange={setFilter} counts={counts} />
          <QuickActions games={games} teamsMap={teamsMap} />
          {user && <LoanInvite compact />}
        </aside>

        {/* (2) The feed column */}
        <div className="min-w-0 sm:max-w-[600px] sm:mx-auto lg:max-w-none lg:mx-0">
          <FeedStories liveGames={liveGames} gamesById={gamesById} teamsMap={teamsMap} feed={feed}
            ownTeamId={playerTeamId || coachTeamIds[0] || null} teamIds={storyTeamIds} signedIn={!!user}
            onLive={(l) => setLiveStoryId(l.game_id)}
            onLeague={() => { setFilter("all"); document.getElementById("feed-list")?.scrollIntoView({ behavior: "smooth", block: "start" }) }} />

          <FeedRoleCards games={games} teamsMap={teamsMap} players={players} liveGames={liveGames} judgeIds={judgeIds} />

          <div className="mt-3 empty:hidden"><ComposerPrompt onOpen={() => setComposeOpen(true)} /></div>

          {/* Desktop: the newest videos (our clips only — outside news has its one post). */}
          {filter === "all" && <div className="hidden lg:block mt-4"><VideoRail feed={feed.filter(p => p.type !== "external")} onShowAll={() => { setFilter("video"); window.scrollTo({ top: 0, behavior: "smooth" }) }} /></div>}

          {/* Feed list */}
          <div id="feed-list" className="scroll-mt-24 mt-3">
            {filtered.length === 0 ? (
              <div className="fl-card p-10 text-center">
                <Rink className="w-12 h-12 mx-auto text-fg-faint mb-3" />
                <h3 className="text-[17px] font-bold text-fg-strong">אין עדכונים להצגה</h3>
                {filter !== "all" && <p className="text-[14px] text-fg-muted mt-1">נסו סינון אחר</p>}
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-4">
                {visible.map((post, i) => (
                  // Anchor for deep links into the feed (/#game-…, /#ms-…). Old /#post-<id>
                  // links are redirected to the permalink /posts/<id> (App.jsx).
                  <TrackedItem key={post.id} post={post}>{renderItem(post, i)}</TrackedItem>
                ))}
              </div>
            )}
          </div>

          {/* Infinite-scroll sentinel + status */}
          {filtered.length > 0 && (
            <div className="flex flex-col items-center gap-2 pt-3">
              {hasMore && (
                <div ref={sentinelRef} className="w-full pt-2">
                  <SkeletonFeedPosts count={1} />
                </div>
              )}
              {!hasMore && <p className="text-[12px] text-fg-subtle">זה הכל לעכשיו</p>}
            </div>
          )}
        </div>

        {/* (3) Widget rail — left in RTL (desktop), own scroll */}
        <aside className="hidden lg:block lg:sticky lg:top-20 self-start lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-4">
          <LiveGameBanner liveGames={liveGames} gamesById={gamesById} teamsMap={teamsMap} />
          <StandingsWidget teams={teams} />
          <NextGameWidget games={games} teams={teams} />
          <LeadersWidget players={players} teams={teams} />
        </aside>
      </div>

      <ComposerSheet open={composeOpen} onClose={closeCompose} onPosted={handlePosted} />
      {liveStory && (
        <LiveStory live={liveStory} game={liveGame} home={teamsMap[liveGame?.home_team_id]} away={teamsMap[liveGame?.away_team_id]}
          onClose={closeLive} />
      )}
    </div>
  )
}
