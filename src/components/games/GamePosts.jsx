import { useState, useEffect, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import { Film as Clapperboard } from "@/components/icons/BrandIcons"
import { getGamePosts, getMyLikes, getRoleBadges } from "@/lib/api"
import { getMyBlocks } from "@/lib/moderation"
import { getMentions, MENTION_KIND } from "@/lib/mentionsApi"
import { orderGamePosts } from "@/lib/gamePosts"
import { birthdayPlayerId } from "@/lib/feed"
import { useAuth } from "@/lib/AuthContext"
import FeedPost from "@/components/feed/FeedPost"

const PAGE = 10
// The viewer's last open/closed choice, shared by every game page. Storage can be
// missing (private mode) — then the section simply starts open.
const OPEN_KEY = "gamePosts.open"
const readOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== "0" } catch { return true } }
const writeOpen = (v) => { try { localStorage.setItem(OPEN_KEY, v ? "1" : "0") } catch { /* ignore */ } }

/**
 * "היילייטס ופוסטים מהמשחק" — the posts attached to this game (posts.game_id, the
 * "שייך למשחק" picker). Video posts first; each is the feed's own card, so clips play
 * inline and likes / comments / share work as in the feed. Renders NOTHING when the
 * game has no attached posts (or the read fails).
 *
 * Collapsible: the header toggles it, and the choice is remembered. Collapsing unmounts
 * the cards, so a playing clip stops rather than keeping on under a closed section.
 */
export default function GamePosts({ game, teamsMap, playersMap }) {
  const { user } = useAuth()
  const [posts, setPosts] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const [liked, setLiked] = useState(() => new Set())
  const [blocked, setBlocked] = useState(() => new Set())
  const [roleBadges, setRoleBadges] = useState({})
  const [mentions, setMentions] = useState({})
  const [open, setOpen] = useState(readOpen)
  const toggle = () => setOpen(v => { writeOpen(!v); return !v })

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
      <h2 id="game-posts-title" className="text-[20px] font-extrabold leading-tight text-fg-strong">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="game-posts-list"
          className="w-full flex items-center gap-2 text-right rounded-lg -mx-1 px-1 py-1 hover:bg-surface-sunken transition-colors">
          <Clapperboard className="w-5 h-5 text-brand shrink-0" /> היילייטס ופוסטים מהמשחק
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">({items.length})</span>
          <ChevronDown className={`w-5 h-5 text-slate-400 mr-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </h2>
      {open && <>
      <div id="game-posts-list" className="space-y-4">
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
      </>}
    </section>
  )
}
