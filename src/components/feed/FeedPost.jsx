import { useState, useEffect, useRef, createContext, useContext } from "react"
import { GoalIcon as Ball, BlueCard, RedCard, Flame, HatTrick, Crown, Trophy, MapPin, DocumentIcon as FileText, Comment as MessageCircle, Verified as BadgeCheck, Birthday as Cake, Share as Share2, LikeOn, LikeOff, BrandIcon, Birthday } from "@/components/icons/BrandIcons"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { format } from "date-fns"
import { ChevronDown, Send, Loader2, Camera, ExternalLink, Check, RefreshCw, ArrowLeft, Globe, Link2, Unlink } from "lucide-react"
import TeamLogo from "@/components/TeamLogo"
import { useAuth } from "@/lib/AuthContext"
import { likePost, unlikePost, getComments, createComment, editPost, deletePost, editComment, deleteComment, setPostGame } from "@/lib/api"
import { setPhotoOverride } from "@/lib/photoOverrides"
import { parseYouTubeId, youTubeInText, withoutUrl } from "@/lib/video"
import FeedVideo, { streamPoster } from "@/components/feed/FeedVideo"
import ExperimentalVideo from "@/components/feed/ExperimentalVideo"
import ReactionBar from "@/components/feed/ReactionBar"
import MarketFeedCard from "@/components/feed/MarketFeedCard"
import ModerationMenu from "@/components/feed/ModerationMenu"
import GameChip from "@/components/feed/GameChip"
import GamePicker, { GamePickerModal } from "@/components/feed/GamePicker"
import { RoleBadge, OgBadge, deriveRoleItems } from "@/components/RoleBadges"
import CommentAuthorBadges, { useCommentBadges } from "@/components/feed/CommentAuthorBadges"
import { TARGET_POST, TARGET_COMMENT } from "@/lib/moderation"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { entityPath } from "@/lib/slugs"
import { birthdayPlayerId } from "@/lib/feed"
import { buildShare } from "@/lib/shareLinks"
import { shareTarget } from "@/lib/shareItem"
import MentionInput from "@/components/feed/MentionInput"
import MentionText, { useMentionViewer, untagItems } from "@/components/feed/MentionText"
import { getMentions, setMentions, removeMention, MENTION_KIND } from "@/lib/mentionsApi"
import { FeedCard, FeedCardHeader, FeedIcon, INSET, fade } from "@/components/feed/FeedCardShell"
import { sizedImage, wideImage } from "@/lib/imageSize"

function Avatar({ url, name, className = "w-9 h-9" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?"
  return url
    ? <img src={sizedImage(url, 48)} alt="" className={`${className} rounded-full object-cover shrink-0`} />
    : <div className={`${className} rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold shrink-0`}>{initial}</div>
}

/* Wrap children in a link to a team page when the team exists, else render inert. */
function TeamLink({ team, className = "", children }) {
  if (!team?.id) return <span className={className}>{children}</span>
  return <Link to={entityPath('teams', team)} className={className}>{children}</Link>
}

/* Wrap children in a link to a player page when a playerId is known, else render inert.
   Guest scorers and unpaired posters have no player page, so they stay non-clickable. */
function PlayerLink({ playerId, className = "", children }) {
  if (!playerId) return <span className={className}>{children}</span>
  return <Link to={entityPath('players', playerId)} className={className}>{children}</Link>
}

const fmtDate = (d) => format(new Date(d), "d/M/yyyy")

/* Like/comment/share row for automatic cards, inset like PostCard's. */
function ItemReactions({ post, likedItems, itemLikeCounts, itemCommentCounts, blockedIds, share }) {
  return (
    <div className={`${INSET} cursor-auto`} data-no-card-nav>
      <ReactionBar itemKey={post.id} liked={likedItems?.has?.(post.id)} likeCount={itemLikeCounts?.[post.id] || 0} commentCount={itemCommentCounts?.[post.id] || 0} blockedIds={blockedIds} share={share} />
    </div>
  )
}

/* ---- Auto-matched game photo (players' faces) attached to an event ---- */
// Feed thumbnails render in a ~360–750px column and are height-cropped (max-h-80),
// so a 1000px-wide source stays crisp on retina while shedding ~40% of the bytes a
// full 1280px source cost (Google Photos oversizing was the page's biggest payload).
const sizedUrl = (url, w = 1000) => (url ? url.replace(/=w\d+(-h\d+)?.*$/, `=w${w}`) : url)
// Our own Storage stills (1920px) get resized copies + srcSet; Google Photos keeps its =w trick.
const feedPhoto = (url) => { const w = wideImage(url); return w.srcSet ? w : { src: sizedUrl(url) } }
// Feed column: full width on phones, ~700px from sm up.
const FEED_SIZES = "(min-width: 640px) 700px, 100vw"

// The first cards on the feed hold the page's largest image (LCP): load those eagerly and first
// instead of lazily after layout. Feed.jsx sets it for the top posts only.
const ImagePriority = createContext(false)
const imgLoading = (priority) => priority ? { loading: "eager", fetchpriority: "high" } : { loading: "lazy" }

function EventPhoto({ photo, itemKey, candidates = [], onRefreshed, game }) {
  const priority = useContext(ImagePriority)
  const { isAdmin, isContentEditor } = useAuth()
  const [current, setCurrent] = useState(photo)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [imgError, setImgError] = useState(false)   // the current photo's URL 404'd (e.g. an expired Google Photos link)
  const imgRef = useRef(null)
  const [beamLeft, setBeamLeft] = useState(null)   // 0–1 horizontal center of the spotlight in the displayed image
  const [objPosY, setObjPosY] = useState(null)     // 0–100 % object-position-y that keeps the face in frame

  // Re-sync when the parent re-resolves this card (e.g. after the overrides map updates).
  useEffect(() => { setCurrent(photo); setImgError(false) }, [photo])

  // Only single-player achievement photos get the spotlight, and only when we know where
  // the player's face is (faceCx/faceCy are 0–1 fractions of the original image w/h).
  const faceCx = current?.mode === "solo" && typeof current?.faceCx === "number" ? current.faceCx : null
  const faceCy = current?.mode === "solo" && typeof current?.faceCy === "number" ? current.faceCy : null

  // Map the face from image space into the displayed (object-cover cropped) box, so the beam
  // lands on the player horizontally and the vertical crop keeps the face in frame instead of
  // slicing it off with the default center crop.
  useEffect(() => {
    if (faceCx == null && faceCy == null) { setBeamLeft(null); setObjPosY(null); return }
    const el = imgRef.current
    if (!el) return
    const measure = () => {
      const cW = el.clientWidth, cH = el.clientHeight
      const nW = el.naturalWidth, nH = el.naturalHeight
      if (!cW || !cH || !nW || !nH) return
      const scale = Math.max(cW / nW, cH / nH)   // object-cover fills the box
      const dW = nW * scale                       // displayed image width (may exceed cW)
      const dH = nH * scale                        // displayed image height (may exceed cH)
      if (faceCx != null) {
        const offX = (cW - dW) / 2                 // object-position-x stays center (50%)
        setBeamLeft(Math.max(0, Math.min(1, (offX + faceCx * dW) / cW)))
      }
      if (faceCy != null) {
        // r = fraction of the image height that survives the crop. Choose the object-position-y
        // that centers the face in that visible band: p = (faceCy − r/2) / (1 − r), clamped.
        // r ≥ 1 means no vertical crop (e.g. narrow/mobile boxes) → leave it centered.
        const r = cH / dH
        const p = r >= 1 ? 0.5 : (faceCy - r / 2) / (1 - r)
        setObjPosY(Math.max(0, Math.min(1, p)) * 100)
      }
    }
    if (el.complete) measure()
    el.addEventListener("load", measure)
    window.addEventListener("resize", measure)
    return () => { el.removeEventListener("load", measure); window.removeEventListener("resize", measure) }
  }, [faceCx, faceCy, current?.photo_id])

  if (!current || !current.image_url) return null

  const caption = [current.album_title, current.album_date && fmtDate(current.album_date)]
    .filter(Boolean).join(" · ")
  const canCycle = candidates.length >= 2
  const cx100 = beamLeft == null ? null : beamLeft * 100
  const beamId = `beam-${String(itemKey || current.photo_id || "x").replace(/[^a-zA-Z0-9_-]/g, "")}`
  const canEdit = isAdmin || isContentEditor

  // Reserve the photo's box from its known pixel dims so the lazily-loaded image (which
  // arrives seconds after the text) can't shove the whole feed down when it lands — the
  // homepage's dominant layout shift. max-h-80 still caps the height and object-cover
  // crops exactly as before; a 16/10 fallback covers any photo row missing width/height.
  const hasDims = current.width > 0 && current.height > 0

  // Advance to the NEXT candidate (wrapping to 0 at the end; an unknown current → 0),
  // pin it for everyone, and update the displayed photo optimistically.
  const cycle = async () => {
    if (!canCycle || busy) return
    const idx = candidates.findIndex(c => c.photo_id === current.photo_id)
    const next = candidates[(idx + 1) % candidates.length]
    if (!next || next.photo_id === current.photo_id) return
    const prev = current
    setFailed(false); setImgError(false); setBusy(true); setCurrent(next)
    try {
      await setPhotoOverride(itemKey, next.photo_id)
      onRefreshed?.(itemKey, next)
    } catch {
      setCurrent(prev); setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  // A dead image URL (expired share link) would otherwise render as a big broken-image box.
  // Collapse it for everyone; admins/editors keep a compact swap control to pick a live photo.
  if (imgError) {
    if (!canEdit) return null
    return (
      <div className="relative mt-3 mx-4 sm:mx-0 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-4 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">התמונה אינה זמינה</span>
        <button
          type="button"
          onClick={cycle}
          disabled={!canCycle || busy}
          title={canCycle ? "החלף תמונה" : "אין תמונה חלופית"}
          aria-label="החלף תמונה"
          className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative mt-3">
      {/* A game's photo opens that game (Ariel 2026-10-25: same on web and both apps; the
          Google Photos page it used to open is gone). Season cards' photos open nothing. */}
      <PhotoFrame to={game ? entityPath('games', game) : null}>
        <img ref={imgRef} {...feedPhoto(current.image_url)} sizes={FEED_SIZES} alt="" {...imgLoading(priority)}
             onError={() => setImgError(true)}
             width={hasDims ? current.width : undefined}
             height={hasDims ? current.height : undefined}
             style={{
               ...(hasDims ? {} : { aspectRatio: "16 / 10" }),
               ...(objPosY != null ? { objectPosition: `50% ${objPosY}%` } : {}),
             }}
             className="w-full max-h-80 object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
        {cx100 != null && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100"
               preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <filter id={`${beamId}-soft`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.4" />
              </filter>
              <mask id={beamId}>
                <rect width="100" height="100" fill="white" />
                <polygon points={`${cx100 - 8},0 ${cx100 + 8},0 ${cx100 + 18},100 ${cx100 - 18},100`}
                         fill="black" filter={`url(#${beamId}-soft)`} />
              </mask>
            </defs>
            <rect width="100" height="100" fill="rgba(8,12,22,0.5)" mask={`url(#${beamId})`} />
          </svg>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pt-6 pb-2">
          <Camera className="w-3.5 h-3.5 text-white/80 shrink-0" />
          <span className="text-[11px] font-medium text-white/90 truncate">{caption}</span>
        </div>
      </PhotoFrame>

      {/* Admins + content editors: swap the auto-matched photo for the next candidate. */}
      {canEdit && (
        <div className="absolute top-2 left-4 sm:left-2 flex items-center gap-2">
          <button
            type="button"
            onClick={cycle}
            disabled={!canCycle || busy}
            title={canCycle ? "החלף תמונה" : "אין תמונה חלופית"}
            aria-label="החלף תמונה"
            className="w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-black/75 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          </button>
          {failed && (
            <span className="text-[11px] font-medium text-white bg-red-600/90 rounded-md px-2 py-1">
              השמירה נכשלה
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function PhotoFrame({ to, children }) {
  const cls = "group block relative sm:rounded-xl overflow-hidden bg-slate-900"
  return to ? <Link to={to} className={cls}>{children}</Link> : <div className={cls}>{children}</div>
}

/* ---- Score (respects RTL gotcha: away first, home last) ---- */
function ScoreBlock({ away, home, awayWin, homeWin }) {
  const decisive = awayWin || homeWin
  const cls = (win) => win
    ? "text-emerald-600 dark:text-emerald-400"
    : decisive ? "text-slate-500 dark:text-slate-400" : "text-slate-900 dark:text-white"
  return (
    <div className="text-4xl sm:text-5xl font-black tracking-tighter tabular-nums leading-none">
      <span className={cls(awayWin)}>{away}</span>
      <span className="mx-1.5 align-middle text-2xl sm:text-3xl font-bold text-slate-300 dark:text-slate-600">:</span>
      <span className={cls(homeWin)}>{home}</span>
    </div>
  )
}

/* One team on the result row. side="home" flows normally (right in RTL);
   side="away" mirrors to the left. Winner is emerald + trophy, loser muted.
   Not a team link: the whole result card opens the game, and a team name that
   went somewhere else was the thing people tapped and landed on the wrong page. */
function ResultTeam({ team, side, isWin, isLoss, label }) {
  const reverse = side === "away"
  return (
    <div className={`group flex items-center gap-2.5 flex-1 min-w-0 rounded-xl px-2 py-1.5 transition-colors ${reverse ? "flex-row-reverse" : ""} ${isWin ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
      <TeamLogo team={team} size={12} />
      <div className={`min-w-0 ${reverse ? "text-left" : ""}`}>
        <p className={`text-sm sm:text-[15px] truncate flex items-center gap-1 group-hover:text-brand transition-colors ${reverse ? "flex-row-reverse" : ""} ${isWin ? "font-extrabold text-emerald-700 dark:text-emerald-300" : isLoss ? "font-semibold text-slate-500 dark:text-slate-400" : "font-bold text-slate-900 dark:text-white"}`}>
          {isWin && <Trophy className="w-4 h-4 text-amber-500 shrink-0" />}
          <span className="truncate">{team?.name}</span>
        </p>
        <p className={`text-[11px] ${isWin ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-slate-500 dark:text-slate-400"}`}>{label}</p>
      </div>
    </div>
  )
}

/* ============ CHAMPION ============ */
function ChampionPost({ post, onPhotoRefreshed, ...rx }) {
  const { team, seasonName } = post.data
  return (
    <FeedCard>
      <FeedCardHeader
        avatar={<FeedIcon tone="bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"><Crown className="w-5 h-5" /></FeedIcon>}
        title="אלופת העונה"
        meta={<span>סיכום עונה{seasonName ? ` ${seasonName}` : ""}</span>}
      />
      <div className={`flex items-center gap-3 ${INSET}`}>
        <TeamLink team={team} className="shrink-0"><TeamLogo team={team} size={12} /></TeamLink>
        <TeamLink team={team} className="min-w-0">
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white truncate hover:text-brand transition-colors">{team?.name}</h2>
        </TeamLink>
        <Trophy className="w-6 h-6 text-amber-500 shrink-0 ms-auto" />
      </div>
      <EventPhoto photo={post.data.photo} itemKey={post.id} candidates={post.data.photoCandidates} onRefreshed={onPhotoRefreshed} />
      <ItemReactions post={post} {...rx} />
    </FeedCard>
  )
}

/* ============ TOP SCORER ============ */
function TopScorerPost({ post, onPhotoRefreshed, ...rx }) {
  const { player, team, goals } = post.data
  return (
    <FeedCard>
      <FeedCardHeader
        avatar={<FeedIcon tone="bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"><Flame className="w-5 h-5" /></FeedIcon>}
        title="מלך השערים של העונה"
        meta={<span>סיכום עונה</span>}
      />
      <div className={`flex items-center gap-3 ${INSET}`}>
        <div className="flex-1 min-w-0">
          <PlayerLink playerId={player?.id} className="block w-fit max-w-full">
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white truncate hover:text-brand transition-colors">{player?.first_name} {player?.last_name}</h2>
          </PlayerLink>
          <TeamLink team={team} className="block w-fit max-w-full">
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate hover:text-brand transition-colors">{team?.name || ''}</p>
          </TeamLink>
        </div>
        <div className="text-center shrink-0">
          <p className="text-2xl font-extrabold text-red-500 tabular-nums leading-none">{goals}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">שערים</p>
        </div>
      </div>
      <EventPhoto photo={post.data.photo} itemKey={post.id} candidates={post.data.photoCandidates} onRefreshed={onPhotoRefreshed} />
      <ItemReactions post={post} {...rx} />
    </FeedCard>
  )
}

/* ============ GAME RESULT ============ */
function GameResultPost({ post, playersMap, teamsMap, onPhotoRefreshed, ...rx }) {
  const [open, setOpen] = useState(false)
  const { game, home, away, stats } = post.data
  const teamName = (id) => teamsMap[id]?.name || '—'
  const homeWin = game.home_score > game.away_score
  const awayWin = game.away_score > game.home_score
  const tie = game.home_score === game.away_score
  const navigate = useNavigate()
  const gamePath = entityPath('games', game)
  // Tap anywhere on the card → the game page. Its own controls (details, likes,
  // comments, player links, photo tools) keep their behaviour, and a text
  // selection isn't a tap. The "לעמוד המשחק" link stays as the keyboard path.
  const openGame = (e) => {
    if (e.target.closest('a, button, input, textarea, select, label, [role="button"], [data-no-card-nav]')) return
    if (window.getSelection?.()?.toString()) return
    navigate(gamePath)
  }

  return (
    <FeedCard layout onClick={openGame} className="cursor-pointer">
      <FeedCardHeader
        avatar={<FeedIcon tone="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"><Trophy className="w-5 h-5" /></FeedIcon>}
        title={<>
          <span>תוצאת משחק</span>
          {game.game_type === 'פלייאוף' && <span className="stat-pill badge-warning !py-0.5">פלייאוף</span>}
          {game.game_type === FRIENDLY_GAME_TYPE && <span className="stat-pill badge-neutral !py-0.5">ידידותי</span>}
          {game.series_game && <span className="stat-pill badge-info !py-0.5">משחק {game.series_game}</span>}
        </>}
        meta={<><span>{fmtDate(post.date)}</span>{game.venue && <><span>·</span><span className="inline-flex items-center gap-0.5"><MapPin className="w-4 h-4" />{game.venue}</span></>}</>}
      />

      {/* Match row — the score is the hero; winning side tinted + trophy-marked.
         RTL gotcha: home team renders first (right); ScoreBlock stays away:home. */}
      <div className={`flex items-center gap-1 sm:gap-2 ${INSET}`}>
        <ResultTeam team={home} side="home" isWin={homeWin} isLoss={awayWin}
          label={tie ? 'תיקו' : homeWin ? 'מנצחת' : 'בית'} />
        <div className="px-1 sm:px-2 text-center shrink-0">
          <ScoreBlock away={game.away_score} home={game.home_score} awayWin={awayWin} homeWin={homeWin} />
        </div>
        <ResultTeam team={away} side="away" isWin={awayWin} isLoss={homeWin}
          label={tie ? 'תיקו' : awayWin ? 'מנצחת' : 'חוץ'} />
      </div>

      <EventPhoto photo={post.data.photo} itemKey={post.id} candidates={post.data.photoCandidates} onRefreshed={onPhotoRefreshed} game={game} />

      {/* Links — one small line, like "למשחק המלא" under a video post. */}
      <div className={`mt-2 flex items-center gap-4 text-xs font-semibold ${INSET}`}>
        <Link to={gamePath} className="inline-flex items-center gap-1 text-brand dark:text-brand-light hover:text-brand-hover">
          לעמוד המשחק <ArrowLeft className="w-3 h-3" />
        </Link>
        {stats.length > 0 && (
          <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-brand transition-colors">
            <FileText className="w-4 h-4" />
            {open ? 'סגור פרטים' : 'פרטים'}
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Expanded box score */}
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className={`pt-3 cursor-auto ${INSET}`} data-no-card-nav>
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-3">סטטיסטיקות שחקנים</h4>
                {stats.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-4">לא הוזנו סטטיסטיקות למשחק זה</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-6">
                      {[game.home_team_id, game.away_team_id].map(tid => (
                        <div key={tid}>
                          <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">{teamName(tid)}</h5>
                          <div className="space-y-1">
                            {stats.filter(s => playersMap[s.player_id]?.team_id === tid).map(stat => {
                              const p = playersMap[stat.player_id]
                              return (
                                <div key={stat.id} className="flex items-center justify-between py-1 text-xs">
                                  <PlayerLink playerId={stat.player_id} className="text-slate-700 dark:text-slate-300 hover:text-brand transition-colors">{p?.first_name} {p?.last_name}</PlayerLink>
                                  <div className="flex gap-1.5">
                                    {stat.goals > 0 && <span className="stat-pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 !py-0 !px-1.5 inline-flex items-center gap-1"><Ball className="w-5 h-5 -my-1" />{stat.goals}</span>}
                                    {stat.blue_cards > 0 && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 !py-0 !px-1.5"><BlueCard className="w-5 h-5 -my-1" />{stat.blue_cards}</span>}
                                    {stat.red_cards > 0 && <span className="stat-pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 !py-0 !px-1.5"><RedCard className="w-5 h-5 -my-1" />{stat.red_cards}</span>}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {stats.some(s => s.is_guest_player) && (
                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
                        <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">אורחים</h5>
                        <div className="space-y-1">
                          {stats.filter(s => s.is_guest_player).map(stat => (
                            <div key={stat.id} className="flex items-center justify-between py-1 text-xs">
                              <span className="text-slate-700 dark:text-slate-300">
                                {stat.guest_player_name}
                                {stat.guest_player_original_team && <span className="text-slate-500 dark:text-slate-400"> ({stat.guest_player_original_team})</span>}
                              </span>
                              <div className="flex gap-1.5">
                                {stat.goals > 0 && <span className="stat-pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 !py-0 !px-1.5 inline-flex items-center gap-1"><Ball className="w-5 h-5 -my-1" />{stat.goals}</span>}
                                {stat.blue_cards > 0 && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 !py-0 !px-1.5"><BlueCard className="w-5 h-5 -my-1" />{stat.blue_cards}</span>}
                                {stat.red_cards > 0 && <span className="stat-pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 !py-0 !px-1.5"><RedCard className="w-5 h-5 -my-1" />{stat.red_cards}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ItemReactions post={post} {...rx} />
    </FeedCard>
  )
}

/* ============ MILESTONE ============ */
function MilestonePost({ post, onPhotoRefreshed, ...rx }) {
  const { kind, name, playerId, teamName, goals, home, away, game } = post.data
  const bigGame = kind === 'big_game'
  const emoji = bigGame ? <Flame className="w-5 h-5" /> : <HatTrick className="w-5 h-5" />
  const label = bigGame ? 'משחק ענק' : 'שלושער'

  return (
    <FeedCard>
      <FeedCardHeader
        avatar={<FeedIcon tone={bigGame ? "bg-orange-100 dark:bg-orange-900/30" : "bg-emerald-100 dark:bg-emerald-900/30"}>{emoji}</FeedIcon>}
        title={label}
        meta={<><span>{fmtDate(post.date)}</span>{teamName && <><span>·</span><span>{teamName}</span></>}</>}
      />
      <div className={INSET}>
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <PlayerLink playerId={playerId} className="font-bold text-slate-900 dark:text-white hover:text-brand transition-colors">{name}</PlayerLink> כבש {goals} שערים
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          <TeamLink team={home} className="hover:text-brand transition-colors">{home?.name}</TeamLink>{' '}
          {/* dir="ltr" bidi-isolates the score so RTL doesn't split "away:home" and
              mispair each digit with the wrong team (see hockey-league-rtl-score-gotcha). */}
          <span dir="ltr" className="tabular-nums">{game.away_score} : {game.home_score}</span>{' '}
          <TeamLink team={away} className="hover:text-brand transition-colors">{away?.name}</TeamLink>
        </p>
      </div>
      <EventPhoto photo={post.data.photo} itemKey={post.id} candidates={post.data.photoCandidates} onRefreshed={onPhotoRefreshed} game={game} />
      <ItemReactions post={post} {...rx} />
    </FeedCard>
  )
}

/* ============ BIRTHDAY (post_birthdays, supabase/birthday-celebrations.sql) ============
   Only "today" — never a date or an age. Text only unless league_settings.feed_ranking
   turns birthday_photo on (off since 2026-10-19, Ariel). Falls back to the post's own
   text/photo when the player isn't in playersMap (e.g. archived). */
function BirthdayBody({ player, team, body, showPhoto = false, fallbackPhoto }) {
  const fullName = [player.first_name, player.last_name].filter(Boolean).join(" ")
  const photo = showPhoto ? (player.photo_url || fallbackPhoto) : null
  const [imgError, setImgError] = useState(false)
  return (
    <>
      <div className={INSET}>
        {fullName ? (
          <>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              יום הולדת שמח ל<PlayerLink playerId={player.id} className="font-bold text-slate-900 dark:text-white hover:text-brand transition-colors">{fullName}</PlayerLink>! <Birthday className="w-5 h-5 inline-block align-[-4px]" />
            </p>
            {(player.jersey_number != null || team?.name) && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {[player.jersey_number != null && `#${player.jersey_number}`, team?.name].filter(Boolean).join(" · ")}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{body}</p>
        )}
        <p className="text-sm text-slate-700 dark:text-slate-200 mt-1">כל הליגה מאחלת מזל טוב — כתבו ברכה בתגובות</p>
      </div>
      {photo && !imgError && (
        <PlayerLink playerId={player.id} className="block mt-3">
          <div className="relative sm:rounded-xl overflow-hidden bg-slate-900 aspect-[4/5] sm:aspect-[4/3]">
            <img src={photo} alt="" loading="lazy" onError={() => setImgError(true)}
                 className="absolute inset-0 w-full h-full object-cover object-top" />
          </div>
        </PlayerLink>
      )}
    </>
  )
}

/* ============ HUMAN POST (Stage B2 + likes/comments) ============ */
function PostCard({ post, likedPostIds, blockedIds, roleBadges, playersMap, teamsMap, share, mentions, initialShowComments = false, hideGameChip = false, startAt }) {
  const { user, openAuth } = useAuth()
  const viewer = useMentionViewer()
  const { post: p, author, team } = post.data
  const name = birthdayPlayerId(p) ? "ליגת הוקי גלגיליות" : (author?.display_name || "חבר/ת הליגה")
  const linkedPlayerId = author?.player_id || null   // paired → has a player page
  // Author's public league role(s). No teamsMap here → coach shows as "מאמן"
  // (compact) rather than "מאמן · team", keeping the inline header short.
  const authorBadge = roleBadges?.[p.author_id] || null
  const authorRoleItems = authorBadge
    ? deriveRoleItems({ isAdmin: authorBadge.isAdmin, roles: authorBadge.roles })
    : []

  const [liked, setLiked] = useState(() => likedPostIds?.has?.(p.id) || false)
  // The permalink page learns the viewer's likes after the card mounts.
  useEffect(() => { if (likedPostIds?.has?.(p.id)) setLiked(true) }, [likedPostIds, p.id])
  const [likeCount, setLikeCount] = useState(p.like_count || 0)
  const [commentCount, setCommentCount] = useState(p.comment_count || 0)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState([])
  const [loadedComments, setLoadedComments] = useState(false)
  const [loadingComments, setLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [posting, setPosting] = useState(false)

  // ---- @player tags (lib/mentions.js). Saved AFTER the post/comment, so a failed
  // set_mentions never loses what was written — it only says so. ----
  const [postMentions, setPostMentions] = useState(mentions || [])
  useEffect(() => { setPostMentions(mentions || []) }, [mentions])
  const [commentMentions, setCommentMentions] = useState({})   // comment id → tags
  const [postPicks, setPostPicks] = useState([])
  const [commentPicks, setCommentPicks] = useState([])
  const [newPicks, setNewPicks] = useState([])
  const [tagError, setTagError] = useState(null)
  const tagFailed = (what) => setTagError(`${what === "הפוסט" ? "הפוסט נשמר" : "התגובה נשמרה"}, אבל התיוג נכשל`)
  const untagPost = async (m) => {
    try { await removeMention(m.id); setPostMentions(ms => ms.filter(x => x.id !== m.id)) }
    catch { setTagError("הסרת התיוג נכשלה") }
  }
  const untagComment = async (m) => {
    try {
      await removeMention(m.id)
      setCommentMentions(map => ({ ...map, [m.comment_id]: (map[m.comment_id] || []).filter(x => x.id !== m.id) }))
    } catch { setTagError("הסרת התיוג נכשלה") }
  }

  // ---- Moderation (edit / soft-delete) for this post ----
  // An ingested news item (supabase/functions/ingest-rink-hockey-news) carries a
  // source, a link and usually a thumbnail. It reuses this card so external news
  // gets likes, comments and moderation for free.
  // A daily birthday post (post_birthdays) is sourced too, but renders as its own card.
  const bdayId = birthdayPlayerId(p)
  const bday = bdayId ? (playersMap?.[bdayId] || { id: bdayId }) : null
  const ext = p.source_name && !bday ? { source: p.source_name, link: p.link_url, image: p.image_url } : null
  // The card's photo: a news item's lead image, or a photo posted from the composer / synced
  // from Instagram (creator-posting.sql). Same frame either way.
  const photo = ext ? ext.image : (!bday ? p.image_url : null)
  const [extImgError, setExtImgError] = useState(false)
  // Full-width redesign (2026-10-08): the photo keeps its own shape, clamped between
  // 4:5 portrait and 1.91:1 landscape (Instagram's bounds) — 16:9 until it loads.
  const [mediaRatio, setMediaRatio] = useState(16 / 9)
  const [expanded, setExpanded] = useState(false)
  const [heartPop, setHeartPop] = useState(false)
  // Two of the three sources are YouTube channels, so most news items are videos.
  // They play HERE (muted, while on screen) rather than sending the reader to
  // youtube.com — see FeedVideo.
  const extVideoId = ext?.link ? parseYouTubeId(ext.link) : null

  const [postBody, setPostBody] = useState(p.body)
  // ---- The game this post is attached to (posts.game_id) — chip + "שייך למשחק" ----
  const [gameId, setGameId] = useState(p.game_id || null)
  const [game, setGame] = useState(post.data.game || null)
  const [gameModal, setGameModal] = useState(false)
  // The permalink page learns the game row after the card mounts.
  useEffect(() => { if (post.data.game && post.data.game.id === gameId) setGame(post.data.game) }, [post.data.game]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draftGame, setDraftGame] = useState({ id: "", game: null })
  const applyGame = async (id, option) => {
    await setPostGame(p.id, id)
    setGameId(id || null); setGame(option?.game || null)
  }
  const unlinkGame = async () => {
    setRowError(null)
    try { await applyGame(null) } catch { setRowError("הסרת השיוך נכשלה, נסו שוב") }
  }
  const [editingPost, setEditingPost] = useState(false)
  const [postDraft, setPostDraft] = useState(p.body)
  const [savingPost, setSavingPost] = useState(false)
  const [removed, setRemoved] = useState(false)   // optimistic delete → hide the whole card
  const [rowError, setRowError] = useState(null)
  // "עוד" only when the clamp actually hides something. A character-count guess showed
  // it under news cards whose summary fitted in the 5 lines, so tapping it did nothing.
  const bodyRef = useRef(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || expanded) { setClipped(false); return }
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [postBody, expanded, editingPost])

  // ---- Moderation for comments ----
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [commentDraft, setCommentDraft] = useState("")
  const [savingComment, setSavingComment] = useState(false)

  const startEditPost = () => { setPostDraft(postBody); setRowError(null); setPostPicks([]); setDraftGame({ id: gameId || "", game }); setEditingPost(true) }
  const saveEditPost = async () => {
    const text = postDraft.trim()
    if (!text || savingPost) return
    setSavingPost(true); setRowError(null)
    try {
      await editPost(p.id, text)
      setPostBody(text)
      if ((draftGame.id || null) !== gameId) {
        try { await applyGame(draftGame.id || null, draftGame.game ? { game: draftGame.game } : null) }
        catch { setRowError("הפוסט נשמר, אבל שיוך המשחק נכשל") }
      }
      setEditingPost(false)
      const picks = [...postMentions, ...postPicks]
      if (picks.length) {
        setMentions(MENTION_KIND.post, p.id, text, picks).then(setPostMentions).catch(() => tagFailed("הפוסט"))
      }
    } catch { setRowError("עריכה נכשלה, נסו שוב") }
    finally { setSavingPost(false) }
  }
  const handleDeletePost = async () => {
    setRemoved(true); setRowError(null)
    try { await deletePost(p.id) }
    catch { setRemoved(false); setRowError("מחיקה נכשלה, נסו שוב") }
  }

  const saveEditComment = async (c) => {
    const text = commentDraft.trim()
    if (!text || savingComment) return
    setSavingComment(true)
    try {
      await editComment(c.id, text)
      setComments(cs => cs.map(x => x.id === c.id ? { ...x, body: text } : x))
      setEditingCommentId(null)
      const picks = [...(commentMentions[c.id] || []), ...commentPicks]
      if (picks.length) {
        setMentions(MENTION_KIND.comment, c.id, text, picks)
          .then(list => setCommentMentions(map => ({ ...map, [c.id]: list })))
          .catch(() => tagFailed("התגובה"))
      }
    } catch { /* keep the editor open on failure */ }
    finally { setSavingComment(false) }
  }
  const handleDeleteComment = async (c) => {
    const prev = comments
    setComments(cs => cs.filter(x => x.id !== c.id))
    setCommentCount(n => Math.max(0, n - 1))
    try { await deleteComment(c.id) }
    catch { setComments(prev); setCommentCount(n => n + 1) }
  }

  const visibleComments = comments.filter(c => !blockedIds?.has?.(c.author_id))
  useCommentBadges(visibleComments)

  const toggleLike = async () => {
    if (!user) { openAuth(); return }
    const next = !liked
    setLiked(next); setLikeCount(c => c + (next ? 1 : -1))
    try {
      next ? await likePost(p.id) : await unlikePost(p.id)
    } catch {
      setLiked(!next); setLikeCount(c => c + (next ? -1 : 1)) // revert
    }
  }

  const toggleComments = async () => {
    const opening = !showComments
    setShowComments(opening)
    if (opening && !loadedComments) {
      setLoadingComments(true)
      try {
        const list = await getComments(p.id)
        setComments(list); setLoadedComments(true)
        getMentions(MENTION_KIND.comment, (list || []).map(c => c.id)).then(setCommentMentions)
      } catch { /* ignore */ }
      finally { setLoadingComments(false) }
    }
  }
  // The permalink page (/posts/:id) opens with the comments showing.
  useEffect(() => { if (initialShowComments) toggleComments() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submitComment = async (e) => {
    e.preventDefault()
    if (!user) { openAuth(); return }
    const text = newComment.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const c = await createComment(p.id, text)
      setComments(prev => [...prev, c])
      setCommentCount(n => n + 1)
      setNewComment("")
      const picks = newPicks
      setNewPicks([]); setTagError(null)
      if (picks.length) {
        setMentions(MENTION_KIND.comment, c.id, text, picks)
          .then(list => setCommentMentions(map => ({ ...map, [c.id]: list })))
          .catch(() => tagFailed("התגובה"))
      }
    } catch { /* ignore */ }
    finally { setPosting(false) }
  }

  // Double-tap the photo to like (never un-likes, like Instagram).
  const likeFromMedia = () => {
    setHeartPop(true); setTimeout(() => setHeartPop(false), 700)
    if (!liked) toggleLike()
  }
  // The permalink (/posts/<id>) — or the player's page for a birthday — never the
  // source link: the share should bring people HERE (lib/shareLinks.js).
  const sharePost = () => shareTarget(share)

  if (removed) return null

  // A staff post that just pastes a YouTube link plays it like a news video (the link
  // itself is hidden — the card IS the video). An uploaded clip takes precedence.
  const bodyYt = !ext && !bday && !p.video_uid ? youTubeInText(postBody) : null
  const textBody = ext ? (postBody || "").split("\n\n")[0] : withoutUrl(postBody || "", bodyYt?.url)

  return (
    <FeedCard>
      {/* Author header */}
      <div className={`flex items-center gap-3 mb-3 ${INSET}`}>
        <PlayerLink playerId={linkedPlayerId} className="shrink-0">
          <Avatar url={author?.avatar_url} name={name} className="w-9 h-9" />
        </PlayerLink>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <PlayerLink playerId={linkedPlayerId} className="min-w-0">
              <p className={`text-sm font-bold text-slate-900 dark:text-white truncate ${linkedPlayerId ? "hover:text-brand transition-colors" : ""}`}>{name}</p>
            </PlayerLink>
            {linkedPlayerId ? (
              <span title="מקושר לשחקן — לחצו לעמוד השחקן" className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
                <BadgeCheck className="w-4 h-4" /> שחקן
              </span>
            ) : bday ? (
              <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                <Cake className="w-4 h-4" /> יום הולדת
              </span>
            ) : ext ? null : (
              <span title="חשבון שאינו מקושר לשחקן" className="shrink-0 text-[10px] font-medium text-slate-500 dark:text-slate-400">אורח/ת</span>
            )}
            <OgBadge number={linkedPlayerId && playersMap?.[linkedPlayerId]?.og_number} size="sm" />
            {authorRoleItems.map(it => <RoleBadge key={it.role} role={it.role} size="sm" />)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            {ext && <><span className="inline-flex items-center gap-0.5"><Globe className="w-3 h-3" />{ext.source}</span>·</>}
            <Link to={`/posts/${p.id}`} className="hover:text-brand hover:underline transition-colors">{fmtDate(post.date)}</Link>
            {team && <>·<TeamLink team={team} className="hover:text-brand transition-colors">{team.name}</TeamLink></>}
          </p>
        </div>
        <ModerationMenu
          targetType={TARGET_POST}
          targetId={p.id}
          authorId={p.author_id}
          onEdit={startEditPost}
          onDelete={handleDeletePost}
          manageItems={gameId ? [
            { key: "game-change", label: "שנה משחק", icon: Link2, onClick: () => setGameModal(true) },
            { key: "game-unlink", label: "הסר שיוך למשחק", icon: Unlink, onClick: unlinkGame },
          ] : [
            { key: "game-link", label: "שייך למשחק", icon: Link2, onClick: () => setGameModal(true) },
          ]}
          extraItems={untagItems(postMentions, viewer, untagPost)}
        />
      </div>

      {/* Body (inline-editable for the author / admins) */}
      {editingPost ? (
        <div>
          <MentionInput
            value={postDraft}
            onChange={setPostDraft}
            onPick={pk => setPostPicks(ps => [...ps, pk])}
            maxLength={2000}
            rows={3}
            autoFocus
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
          />
          <div className={`mt-2 ${INSET}`}>
            <GamePicker value={draftGame.id} disabled={savingPost}
              onChange={(id, o) => setDraftGame({ id, game: o?.game || null })} />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={saveEditPost} disabled={savingPost || !postDraft.trim()}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
              {savingPost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שמירה
            </button>
            <button onClick={() => setEditingPost(false)} disabled={savingPost}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
              ביטול
            </button>
          </div>
        </div>
      ) : bday ? (
        <BirthdayBody player={bday} team={bday.team_id ? teamsMap?.[bday.team_id] : null} body={postBody} showPhoto={!!post.data?.showPhoto} fallbackPhoto={p.image_url} />
      ) : (
        <div className="px-4 sm:px-0">
          {/* News: the headline is the first line, the summary (ingest, 2026-10-08) the rest. */}
          <p ref={bodyRef} className={`text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed ${!expanded ? (ext ? "line-clamp-5" : "line-clamp-3") : ""}`}>
            {ext && textBody.includes("\n") ? (
              <><span className="font-bold text-slate-900 dark:text-white">{textBody.split("\n")[0]}</span>{"\n" + textBody.split("\n").slice(1).join("\n")}</>
            ) : <MentionText text={textBody} mentions={postMentions} />}
          </p>
          {clipped && !expanded && (
            <button onClick={() => setExpanded(true)} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-brand">עוד</button>
          )}
        </div>
      )}
      {rowError && <p className="text-xs text-red-500 mt-2 px-4 sm:px-0">{rowError}</p>}
      {tagError && <p className="text-xs text-red-500 mt-2 px-4 sm:px-0">{tagError}</p>}

      {/* External news media, edge to edge on a phone. The photo is no longer a link —
          a tap would fight the double-tap like; "צפייה במקור" sits in the counts line.
          onError collapses the image rather than leaving a broken-image box. */}
      {(extVideoId || (photo && !extImgError)) && (
        <div className="mt-3">
          {extVideoId ? (
            <FeedVideo videoId={extVideoId} poster={photo}
                       title={postBody.split("\n")[0] || ext.source} />
          ) : (
            <div className="relative bg-slate-900 sm:rounded-xl overflow-hidden select-none" onDoubleClick={likeFromMedia}
                 style={{ aspectRatio: String(mediaRatio) }}>
              <img src={ext ? photo : sizedImage(photo, 540, "contain")} alt="" loading="lazy" draggable={false} onError={() => setExtImgError(true)}
                   onLoad={e => {
                     const { naturalWidth: w, naturalHeight: h } = e.currentTarget
                     if (w && h) setMediaRatio(Math.min(1.91, Math.max(0.8, w / h)))
                   }}
                   className="absolute inset-0 w-full h-full object-cover" />
              <AnimatePresence>
                {heartPop && (
                  <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.3, opacity: 0 }}
                    transition={{ duration: 0.25 }} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <BrandIcon name="like" variant="large" className="w-20 h-20 drop-shadow-lg" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* A clip uploaded straight to the feed (our Cloudflare Stream, feed-video-posts.sql),
          or a YouTube link pasted into the post. */}
      {((p.video_uid && p.video_cf_code) || bodyYt) && (
        <div className="mt-3">
          {bodyYt ? (
            <FeedVideo videoId={bodyYt.id} poster={`https://i.ytimg.com/vi/${bodyYt.id}/hqdefault.jpg`} title={textBody.split("\n")[0]} />
          ) : (
            <ExperimentalVideo postId={p.id} provider="cloudflare" videoId={p.video_uid} cfCode={p.video_cf_code} ratio={p.video_ratio}
                       poster={streamPoster(p.video_cf_code, p.video_uid)} title={postBody.split("\n")[0]} startAt={startAt} />
          )}
        </div>
      )}

      {/* The game this post belongs to (שייך למשחק). Not on the game page itself. */}
      {gameId && !hideGameChip && !editingPost && (
        <div className={`mt-2 ${INSET}`}>
          <GameChip gameId={gameId} game={game} teamsMap={teamsMap} />
        </div>
      )}
      {gameModal && (
        <GamePickerModal value={gameId} onSave={applyGame} onClose={() => setGameModal(false)} />
      )}

      {/* Actions: icons, then the counts on their own line (and the link out). */}
      <div data-reactions className={`mt-2 ${INSET}`}>
        <div className="flex items-center gap-4 py-1">
          <button onClick={toggleLike} aria-label={liked ? "ביטול אהבתי" : "אהבתי"}
            className={`transition-colors ${liked ? "text-red-500" : "text-slate-700 dark:text-slate-200 hover:text-red-500"}`}>
            {liked ? <LikeOn className="w-6 h-6" /> : <LikeOff className="w-6 h-6" />}
          </button>
          <button onClick={toggleComments} aria-label="תגובות" className="text-slate-700 dark:text-slate-200 hover:text-brand transition-colors">
            <MessageCircle className="w-6 h-6" />
          </button>
          <button onClick={sharePost} disabled={!share} aria-label="שיתוף" className="ms-auto text-slate-700 dark:text-slate-200 hover:text-brand transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
        </div>
        {(likeCount > 0 || commentCount > 0 || ext?.link) && (
          <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
            {likeCount > 0 && <span className="font-bold text-slate-900 dark:text-white">{likeCount} אהבו</span>}
            {commentCount > 0 && <>{likeCount > 0 && <span>·</span>}<button onClick={toggleComments} className="hover:text-brand">{commentCount} תגובות</button></>}
            {ext?.link && <>{(likeCount > 0 || commentCount > 0) && <span>·</span>}
              <a href={ext.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:text-brand-hover">
                <ExternalLink className="w-3 h-3" /> {extVideoId ? "פתיחה ביוטיוב" : "צפייה במקור"}
              </a></>}
          </p>
        )}
      </div>

      {/* Comments */}
      <AnimatePresence>
        {showComments && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} data-reactions className={`overflow-hidden ${INSET}`}>
            <div className="mt-3 space-y-3">
              {loadingComments ? (
                <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
              ) : (
                <>
                  {visibleComments.map(c => (
                    <div key={c.id} className="flex items-start gap-2.5">
                      <PlayerLink playerId={c.author?.player_id} className="shrink-0">
                        <Avatar url={c.author?.avatar_url} name={c.author?.display_name} className="w-8 h-8" />
                      </PlayerLink>
                      <div className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <PlayerLink playerId={c.author?.player_id} className="w-fit max-w-full min-w-0">
                            <p className={`text-xs font-bold text-slate-900 dark:text-white truncate ${c.author?.player_id ? "hover:text-brand transition-colors" : ""}`}>{c.author?.display_name || "חבר/ת הליגה"}</p>
                          </PlayerLink>
                          <CommentAuthorBadges authorId={c.author_id} playerId={c.author?.player_id} />
                        </div>
                        {editingCommentId === c.id ? (
                          <div className="mt-1">
                            <MentionInput
                              value={commentDraft}
                              onChange={setCommentDraft}
                              onPick={pk => setCommentPicks(ps => [...ps, pk])}
                              maxLength={1000}
                              rows={2}
                              autoFocus
                              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
                            />
                            <div className="flex items-center gap-2 mt-1.5">
                              <button onClick={() => saveEditComment(c)} disabled={savingComment || !commentDraft.trim()}
                                className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
                                {savingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : null} שמירה
                              </button>
                              <button onClick={() => setEditingCommentId(null)} disabled={savingComment}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                                ביטול
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words"><MentionText text={c.body} mentions={commentMentions[c.id]} /></p>
                        )}
                      </div>
                      <ModerationMenu
                        targetType={TARGET_COMMENT}
                        targetId={c.id}
                        authorId={c.author_id}
                        onEdit={() => { setEditingCommentId(c.id); setCommentDraft(c.body); setCommentPicks([]) }}
                        onDelete={() => handleDeleteComment(c)}
                        extraItems={untagItems(commentMentions[c.id], viewer, untagComment)}
                      />
                    </div>
                  ))}
                  {visibleComments.length === 0 && <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-1">היו הראשונים להגיב</p>}

                  {user ? (
                    <form onSubmit={submitComment} className="flex items-center gap-2 pt-1">
                      <MentionInput
                        as="input"
                        wrapperClassName="flex-1 min-w-0"
                        value={newComment}
                        onChange={setNewComment}
                        onPick={pk => setNewPicks(ps => [...ps, pk])}
                        maxLength={1000}
                        placeholder="כתבו תגובה… (@ לתיוג שחקן)"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                      />
                      <button type="submit" disabled={posting || !newComment.trim()} className="shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center disabled:opacity-50">
                        {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </button>
                    </form>
                  ) : (
                    <button onClick={openAuth} className="text-xs text-brand dark:text-brand-light font-semibold hover:underline pt-1">התחברו כדי להגיב</button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </FeedCard>
  )
}

/* ============ Dispatcher ============ */
export default function FeedPost({ priority = false, ...props }) {
  return <ImagePriority.Provider value={priority}><FeedPostCard {...props} /></ImagePriority.Provider>
}

function FeedPostCard({ post, playersMap, teamsMap, roleBadges, likedPostIds, likedItems, itemLikeCounts, itemCommentCounts, blockedIds, onPhotoRefreshed, mentions, initialShowComments, hideGameChip, startAt }) {
  // Every card but הוקי מרקט (18+) gets a share target — see lib/shareLinks.js.
  const share = buildShare(post, { playersMap })
  const rx = { likedItems, itemLikeCounts, itemCommentCounts, blockedIds, onPhotoRefreshed, share }
  switch (post.type) {
    case 'champion':
      return <ChampionPost post={post} {...rx} />
    case 'top_scorer':
      return <TopScorerPost post={post} {...rx} />
    case 'game_result':
      return <GameResultPost post={post} playersMap={playersMap} teamsMap={teamsMap} {...rx} />
    case 'milestone':
      return <MilestonePost post={post} {...rx} />
    case 'market':
      return <MarketFeedCard post={post} teamsMap={teamsMap} />
    case 'post':
    case 'external':
      return <PostCard post={post} likedPostIds={likedPostIds} blockedIds={blockedIds} roleBadges={roleBadges} playersMap={playersMap} teamsMap={teamsMap}
        share={share} mentions={mentions} initialShowComments={initialShowComments} hideGameChip={hideGameChip} startAt={startAt} />
    default:
      return null
  }
}
