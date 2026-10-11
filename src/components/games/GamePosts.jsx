import { useState, useEffect, useMemo } from "react"
import { Clapperboard } from "lucide-react"
import { getGamePosts, getMyLikes, getRoleBadges } from "@/lib/api"
import { getMyBlocks } from "@/lib/moderation"
import { getMentions, MENTION_KIND } from "@/lib/mentionsApi"
import { orderGamePosts } from "@/lib/gamePosts"
import { birthdayPlayerId } from "@/lib/feed"
import { useAuth } from "@/lib/AuthContext"
import FeedPost from "@/components/feed/FeedPost"

const PAGE = 10

/**
 * "היילייטס ופוסטים מהמשחק" — the posts attached to this game (posts.game_id, the
 * "שייך למשחק" picker). Video posts first; each is the feed's own card, so clips play
 * inline and likes / comments / share work as in the feed. Renders NOTHING when the
 * game has no attached posts (or the read fails).
 */
export default function GamePosts({ game, teamsMap, playersMap }) {
  const { user } = useAuth()
  const [posts, setPosts] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const [liked, setLiked] = useState(() => new Set())
  const [blocked, setBlocked] = useState(() => new Set())
  const [roleBadges, setRoleBadges] = useState({})
  const [mentions, setMentions] = useState({})

  useEffect(() => {
    if (!game?.id) return
    let alive = true
    getGamePosts(game.id)
      .then(list => {
        if (!alive) return
        setPosts(orderGamePosts(list))
        const ids = list.map(p => p.id)
        if (!ids.length) return
        getRoleBadges(list.map(p => p.author_id)).then(b => alive && setRoleBadges(b)).catch(() => {})
        getMentions(MENTION_KIND.post, ids).then(m => alive && setMentions(m || {})).catch(() => {})
      })
      .catch(() => alive && setPosts([]))
    return () => { alive = false }
  }, [game?.id])

  useEffect(() => {
    if (!user) { setLiked(new Set()); setBlocked(new Set()); return }
    getMyLikes().then(ids => setLiked(new Set(ids))).catch(() => {})
    getMyBlocks().then(ids => setBlocked(new Set(ids))).catch(() => {})
  }, [user])

  // The feed item shape lib/feed.js builds for a human / news post.
  const items = useMemo(() => (posts || [])
    .filter(p => !blocked.has(p.author_id))
    .map(p => {
      const isExternal = !!p.source_name && !birthdayPlayerId(p)
      return {
        id: `post-${p.id}`,
        type: isExternal ? "external" : "post",
        date: p.created_at,
        data: { post: p, author: p.author || null, team: p.team_id ? teamsMap?.[p.team_id] : null, game },
      }
    }), [posts, blocked, teamsMap, game])

  if (!items.length) return null

  return (
    <section aria-labelledby="game-posts-title" className="space-y-3">
      <h2 id="game-posts-title" className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
        <Clapperboard className="w-5 h-5 text-brand" /> היילייטס ופוסטים מהמשחק
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">({items.length})</span>
      </h2>
      <div className="space-y-4">
        {items.slice(0, shown).map(item => (
          <FeedPost
            key={item.id}
            post={item}
            playersMap={playersMap}
            teamsMap={teamsMap}
            roleBadges={roleBadges}
            likedPostIds={liked}
            blockedIds={blocked}
            mentions={mentions[item.data.post.id]}
            hideGameChip
          />
        ))}
      </div>
      {items.length > shown && (
        <button type="button" onClick={() => setShown(n => n + PAGE)}
          className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
          הצג עוד ({items.length - shown})
        </button>
      )}
    </section>
  )
}
