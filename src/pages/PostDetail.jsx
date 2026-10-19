import { useState, useEffect, useMemo } from "react"
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowRight, MessageSquareOff } from "lucide-react"
import { getPost, getMyLikes, getRoleBadges, getTeams, getPlayers, getGameById, getGamePosts } from "@/lib/api"
import { getMyBlocks } from "@/lib/moderation"
import { getMentions, MENTION_KIND } from "@/lib/mentionsApi"
import { birthdayPlayerId } from "@/lib/feed"
import { firstLine, postTitle } from "@/lib/shareLinks"
import { isUuid, leadingUuid } from "@/lib/slugs"
import { useSeo } from "@/lib/seo"
import { useAuth } from "@/lib/AuthContext"
import FeedPost from "@/components/feed/FeedPost"
import { streamPoster } from "@/components/feed/FeedVideo"
import { SkeletonFeedPosts } from "@/components/skeletons/PageSkeletons"

/**
 * Post permalink — https://rinkhockeyil.com/posts/<uuid>. The same card as in the feed,
 * full width, with its likes and comments open. What the share button, the bell
 * (post_like / post_comment / tagged) and old /#post-<id> links all land on.
 * Link previews for bots come from api/og.js (vercel.json routes /posts/:id there); search
 * bots get api/seo.js, a text copy of THIS page — title, video, game, the game's other
 * clips — so keep the two in step. ?t=<seconds> starts the video there (Google key moments).
 */
export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [post, setPost] = useState(null)
  const [state, setState] = useState("loading") // loading | ready | missing | error
  const [liked, setLiked] = useState(() => new Set())
  const [roleBadges, setRoleBadges] = useState({})
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [mentions, setMentions] = useState(undefined)
  const [blocked, setBlocked] = useState(() => new Set())
  const [game, setGame] = useState(null)   // the game it is attached to → GameChip
  const [related, setRelated] = useState([]) // the game's other video posts → "עוד סרטונים מהמשחק"
  const [params] = useSearchParams()
  const startAt = Math.max(0, Math.floor(Number(params.get("t")) || 0))

  useEffect(() => {
    let alive = true
    if (!isUuid(id)) {
      // Share text glued onto the link (/posts/<uuid> ⚪ גול…) → the clean permalink.
      const clean = leadingUuid(id)
      if (clean) navigate(`/posts/${clean}`, { replace: true })
      else setState("missing")
      return
    }
    setState("loading")
    Promise.all([getPost(id), getTeams().catch(() => [])])
      .then(([p, t]) => {
        if (!alive) return
        setTeams(t || [])
        if (!p) { setState("missing"); return }
        setPost(p); setState("ready")
        getRoleBadges([p.author_id]).then(b => alive && setRoleBadges(b)).catch(() => {})
        getMentions(MENTION_KIND.post, [p.id]).then(m => alive && setMentions(m[p.id] || []))
        // Players decorate only (birthday banner, OG badge) — never hold the page up.
        getPlayers().then(pl => alive && setPlayers(pl || [])).catch(() => {})
        if (p.game_id) getGameById(p.game_id).then(g => alive && setGame(g)).catch(() => {})
        if (p.game_id) getGamePosts(p.game_id)
          .then(ps => alive && setRelated((ps || []).filter(r => r.id !== p.id && r.video_uid && r.video_cf_code)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).slice(0, 12)))
          .catch(() => {})
      })
      .catch(() => alive && setState("error"))
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    if (!user) { setLiked(new Set()); setBlocked(new Set()); return }
    getMyLikes().then(ids => setLiked(new Set(ids))).catch(() => {})
    getMyBlocks().then(ids => setBlocked(new Set(ids))).catch(() => {})
  }, [user])

  const teamsMap = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])
  const playersMap = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players])

  const isBirthday = !!birthdayPlayerId(post)
  const authorName = isBirthday ? "ליגת הוקי גלגיליות" : (post?.source_name || post?.author?.display_name || "חבר/ת הליגה")
  useSeo({
    title: post ? (postTitle(post.body) || `${authorName} · פוסט`) : "פוסט",
    description: post ? firstLine(post.body, 160) : undefined,
    path: `/posts/${id}`,
  })

  // The feed item shape lib/feed.js builds for a human / news post.
  const item = useMemo(() => post && ({
    id: `post-${post.id}`,
    type: post.source_name && !isBirthday ? "external" : "post",
    date: post.created_at,
    data: { post, author: post.author || null, team: post.team_id ? teamsMap[post.team_id] : null, game },
  }), [post, teamsMap, isBirthday, game])

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8 space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> לפיד
      </Link>

      {state === "loading" && <SkeletonFeedPosts count={1} />}

      {(state === "missing" || state === "error" || (state === "ready" && blocked.has(post?.author_id))) && (
        <div className="card p-10 text-center">
          <MessageSquareOff className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h1 className="text-lg font-bold text-slate-700 dark:text-slate-200">
            {state === "error" ? "שגיאה בטעינת הפוסט" : "הפוסט לא נמצא"}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {state === "error" ? "נסו לרענן את הדף" : "ייתכן שהפוסט נמחק"}
          </p>
          <Link to="/" className="inline-block mt-4 px-4 py-2 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors">
            לפיד הליגה
          </Link>
        </div>
      )}

      {state === "ready" && item && !blocked.has(post.author_id) && (
        <FeedPost
          key={post.id}
          post={item}
          playersMap={playersMap}
          teamsMap={teamsMap}
          roleBadges={roleBadges}
          likedPostIds={liked}
          blockedIds={blocked}
          mentions={mentions}
          initialShowComments
          startAt={startAt}
        />
      )}

      {state === "ready" && related.length > 0 && (
        <section className="card p-4">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-3">עוד סרטונים מהמשחק</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {related.map(r => (
              <li key={r.id}>
                <Link to={`/posts/${r.id}`} className="block group">
                  <img src={streamPoster(r.video_cf_code, r.video_uid)} alt={postTitle(r.body, 60)} loading="lazy"
                       className="w-full aspect-video object-cover rounded-lg bg-slate-200 dark:bg-slate-800" />
                  <span className="mt-1 block text-xs font-semibold text-slate-600 dark:text-slate-300 group-hover:text-brand line-clamp-2">
                    {postTitle(r.body, 60)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
