import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { GoalIcon as Ball, BlueCard, RedCard, HatTrick } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { CrestDisc, FLScore, RinkDrawing } from "@/components/fl/Floodlight"
import { teamBlend, onColor } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"
import { wideImage } from "@/lib/imageSize"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { getGameMarketOdds } from "@/lib/gameMarket"
import { gameSlides, gameCover, gameCaption, predictionLine, dayMonth, clipPoster } from "@/lib/feedGamePost"
import ExperimentalVideo from "@/components/feed/ExperimentalVideo"
import { streamPoster } from "@/components/feed/FeedVideo"
import ReactionBar from "@/components/feed/ReactionBar"

export const LEAGUE_NAME = "ליגת הוקי גלגיליות"
export const LEAGUE_MARK = "/logos/mark-256.png"

/** The league account's avatar (GamePost header): the interim mark in a round frame. */
export function LeagueAvatar({ size = 36 }) {
  return (
    <img src={LEAGUE_MARK} alt="" width={size} height={size} loading="lazy" decoding="async"
      className="shrink-0 rounded-full bg-surface-sunken object-contain" style={{ width: size, height: size }} />
  )
}

/**
 * ONE post per game (GamePost board, Ariel 10-27): a carousel whose first slide is the
 * result over a real frame of the game in the two teams' colours (home RIGHT), then the
 * game's photo, clips and milestones; a thumb strip; ♥ 💬 ↗ + "צפייה במשחק המלא"; the
 * game story as the caption; "פרטי המשחק" (box score); the predictions strip in player and
 * coach feeds. Port of iOS GameCarouselPost (FLFeedKit.swift).
 *
 * The carousel is a native scroll-snap row: a vertical drag still scrolls the page (no
 * touch handlers), a horizontal one turns the slide. Off-screen slides are clipped by it,
 * so FeedVideo's on-screen autoplay only ever plays the slide in view.
 */
export default function GamePost({ post, teamsMap = {}, playersMap = {}, large = false, chip = null, showPredict = false,
  priority = false, adminPhoto = null, likedItems, itemLikeCounts, itemCommentCounts, blockedIds, share }) {
  const { game } = post.data
  const home = post.data.home || teamsMap[game.home_team_id] || { name: "בית" }
  const away = post.data.away || teamsMap[game.away_team_id] || { name: "חוץ" }
  const stats = post.data.stats || []
  const slides = gameSlides(post)
  const many = slides.length > 1
  const cover = gameCover(post)
  const gamePath = entityPath("games", game)
  const fullGame = post.data.fullGame
  const caption = gameCaption(post, home.name, away.name)
  const h = large ? 440 : 300
  const scroller = useRef(null)
  const refs = useRef([])
  const [active, setActive] = useState(0)
  const [captionOpen, setCaptionOpen] = useState(false)
  const [showBox, setShowBox] = useState(false)
  const { isAdmin, isContentEditor } = useAuth()

  // Which slide is in view — one observer rooted on the scroller (RTL-safe: no scrollLeft maths).
  useEffect(() => {
    const root = scroller.current
    if (!root || !many) return
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) setActive(Number(e.target.dataset.i))
    }, { root, threshold: 0.6 })
    refs.current.forEach(el => el && obs.observe(el))
    return () => obs.disconnect()
  }, [slides.length, many])

  const go = (i) => {
    const el = refs.current[Math.max(0, Math.min(slides.length - 1, i))]
    // block "nearest": turning a slide never scrolls the page.
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }

  const meta = [dayMonth(game.game_date || post.date)]
  if (game.game_type === "פלייאוף") meta.push("פלייאוף")
  if (game.game_type === FRIENDLY_GAME_TYPE) meta.push("ידידותי")
  if (game.series_game) meta.push(`משחק ${game.series_game}`)
  if (game.venue) meta.push(game.venue)

  const band = (
    <ResultBand game={game} home={home} away={away} cover={cover} large={large} priority={priority}
      label={`סיום · ${dayMonth(game.game_date || post.date)}`} to={gamePath} />
  )

  return (
    <article className="bg-surface text-fg -mx-4 sm:mx-0 pb-3.5 sm:rounded-card sm:border sm:border-line sm:overflow-hidden"
      aria-label={`${home.name} ${game.home_score ?? ""}, ${away.name} ${game.away_score ?? ""}`}>
      {/* header: the league account · date (· venue) · chip */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <LeagueAvatar />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-fg-strong truncate">{LEAGUE_NAME}</p>
          <p className="text-[12px] text-fg-muted truncate">{meta.join(" · ")}</p>
        </div>
        {chip === "mine" && <span className="shrink-0 text-[11px] font-extrabold rounded-lg px-2 py-1 bg-fl-accent text-[#11161D]">הקבוצה שלך</span>}
        {chip === "refereed" && <span className="shrink-0 text-[11px] font-extrabold rounded-lg px-2 py-1 bg-surface-sunken text-fg-strong">שפטת</span>}
      </div>

      {/* the carousel */}
      {!many ? <div style={{ height: h }}>{band}</div> : (
        <div className="relative">
          <div ref={scroller} role="region" aria-roledescription="קרוסלה" aria-label={`${home.name} נגד ${away.name}`}
            className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ height: h }}>
            {slides.map((s, i) => (
              <div key={s.key} ref={el => { refs.current[i] = el }} data-i={i}
                className="w-full h-full shrink-0 snap-center snap-always overflow-hidden"
                aria-roledescription="שקופית" aria-label={`${i + 1} מתוך ${slides.length}: ${s.label}`}>
                {s.kind === "band" && band}
                {s.kind === "photo" && <PhotoSlide photo={s.photo} />}
                {s.kind === "clip" && <ClipSlide item={s.item} />}
                {s.kind === "milestone" && <MilestoneSlide m={s.milestone} teamsMap={teamsMap} playersMap={playersMap} />}
              </div>
            ))}
          </div>
          <span className="pointer-events-none absolute top-4 left-4 rounded-full bg-[rgba(10,14,20,0.5)] px-2.5 py-1 text-[12px] font-bold text-white tabular-nums" dir="ltr">
            {active + 1}/{slides.length}
          </span>
          {/* Arrows for mouse users (RTL: "next" is to the left); touch swipes. */}
          {active > 0 && (
            <button type="button" onClick={() => go(active - 1)} aria-label="השקופית הקודמת"
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 size-11 items-center justify-center rounded-full bg-surface/90 text-fg-strong shadow hover:bg-surface">
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          {active < slides.length - 1 && (
            <button type="button" onClick={() => go(active + 1)} aria-label="השקופית הבאה"
              className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 size-11 items-center justify-center rounded-full bg-surface/90 text-fg-strong shadow hover:bg-surface">
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      {/* thumb strip — every slide, the current one ringed amber */}
      {many && (
        <div className="flex gap-1.5 px-4 pt-2.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {slides.map((s, i) => (
            <button key={s.key} type="button" onClick={() => go(i)} aria-label={s.label} aria-current={i === active}
              className="relative shrink-0 w-[54px] h-[70px] rounded-[10px] overflow-hidden bg-[#1B2532]">
              <Thumb s={s} game={game} home={home} away={away} cover={cover} />
              {i === active && <span aria-hidden="true" className="absolute inset-0 rounded-[10px] ring-2 ring-inset ring-fl-accent" />}
              <span className="absolute bottom-1 right-1.5 left-1 text-[10.5px] font-extrabold text-white text-right truncate [text-shadow:0_1px_4px_rgba(0,0,0,.6)]">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ♥ 💬 ↗ · צפייה במשחק המלא */}
      <div className="px-4 pt-1.5 cursor-auto">
        <ReactionBar itemKey={post.id} liked={likedItems?.has?.(post.id)} likeCount={itemLikeCounts?.[post.id] || 0}
          commentCount={itemCommentCounts?.[post.id] || 0} blockedIds={blockedIds} share={share}
          accessory={
            <Link to={fullGame ? `/posts/${fullGame.data.post.id}` : gamePath}
              className="h-11 px-3.5 rounded-[10px] bg-brand text-brand-fg inline-flex items-center gap-1.5 text-[12.5px] font-bold hover:bg-brand-hover transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" /></svg>
              צפייה במשחק המלא
            </Link>
          } />
      </div>

      {/* the caption: the game story, else one line */}
      {caption && (
        <p className={`px-4 mt-1 text-[14px] leading-[1.5] text-fg-strong whitespace-pre-line ${captionOpen ? "" : "line-clamp-3"}`}
          onClick={() => setCaptionOpen(o => !o)}>
          <b>{LEAGUE_NAME}</b> {caption}
        </p>
      )}

      {stats.length > 0 && (
        <button type="button" onClick={() => setShowBox(o => !o)} aria-expanded={showBox}
          className="mx-4 min-h-[44px] inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted hover:text-fg-strong">
          {showBox ? "סגור פרטים" : "פרטי המשחק"}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBox ? "rotate-180" : ""}`} />
        </button>
      )}
      {showBox && <div className="px-4 pt-1"><BoxScore game={game} stats={stats} teamsMap={teamsMap} playersMap={playersMap} /></div>}

      {/* Admins / content editors keep the "another photo" tool for the game's picture. */}
      {(isAdmin || isContentEditor) && adminPhoto && post.data.photo && (
        <details className="mx-4 mt-1 group">
          <summary className="min-h-[44px] inline-flex items-center gap-1 text-[13px] font-semibold text-fg-muted cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            תמונת המשחק (עריכה) <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="-mx-4 sm:mx-0">{adminPhoto}</div>
        </details>
      )}

      {showPredict && <PredictionStrip game={game} homeName={home.name} awayName={away.name} />}
    </article>
  )
}

/** The result slide: blend + real frame + rink + crests in discs + score + names. */
function ResultBand({ game, home, away, cover, large, label, to, priority }) {
  const img = cover ? wideImage(cover, 800) : null
  const crest = large ? 84 : 72
  const score = large ? 72 : 60
  return (
    <Link to={to} aria-label={`לעמוד המשחק: ${home.name} ${game.home_score ?? ""}, ${away.name} ${game.away_score ?? ""}`}
      className="relative isolate block h-full w-full overflow-hidden text-white" style={{ backgroundImage: teamBlend(home, away, { angle: 110 }) }}>
      {img && (
        <>
          <img {...img} sizes="(min-width: 640px) 600px, 100vw" alt="" decoding="async"
            {...(priority ? { loading: "eager", fetchpriority: "high" } : { loading: "lazy" })}
            className="absolute inset-0 -z-20 size-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0 -z-10 opacity-75" style={{ backgroundImage: teamBlend(home, away, { angle: 110 }) }} />
        </>
      )}
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={{ backgroundImage: "linear-gradient(180deg, rgba(10,14,20,0) 40%, rgba(10,14,20,0.55) 100%)" }} />
      <RinkDrawing strength={0.45} className="absolute inset-x-0 mx-auto -z-10 w-[calc(100%-20px)] max-w-[440px]" style={{ top: large ? 110 : 58, height: 185 }} />
      <span className="absolute top-[18px] inset-x-0 flex justify-center">
        <span className="text-[12px] font-bold px-3 py-1 rounded-full bg-white/15 backdrop-blur-sm">{label}</span>
      </span>
      <span dir="rtl" className="absolute inset-x-0 mx-auto max-w-[440px] grid grid-cols-3 items-center" style={{ top: large ? 160 : 90 }}>
        <span className="flex justify-center"><CrestDisc team={home} size={crest} shadow /></span>
        <span className="flex justify-center"><FLScore home={game.home_score} away={game.away_score} size={score} dimLoser /></span>
        <span className="flex justify-center"><CrestDisc team={away} size={crest} shadow /></span>
      </span>
      <span dir="rtl" className="absolute bottom-[18px] right-5 left-5 flex justify-between items-end gap-3 [text-shadow:0_1px_8px_rgba(0,0,0,.45)]">
        <span className="min-w-0 text-[24px] font-extrabold leading-[1.05] line-clamp-2">{home.name}</span>
        <span className="min-w-0 text-[18px] font-extrabold leading-[1.05] opacity-85 text-left line-clamp-2">{away.name}</span>
      </span>
    </Link>
  )
}

function PhotoSlide({ photo }) {
  const img = wideImage(photo.image_url, 800)
  return (
    <div className="relative h-full w-full bg-black">
      <img {...img} sizes="(min-width: 640px) 600px, 100vw" alt={photo.album_title || "תמונה מהמשחק"} loading="lazy" decoding="async"
        className="size-full object-cover" />
    </div>
  )
}

function ClipSlide({ item }) {
  const p = item.data?.post || {}
  return (
    <div className="h-full w-full bg-black flex items-center justify-center" data-no-card-nav>
      <div className="w-full max-h-full">
        <ExperimentalVideo postId={p.id} provider="cloudflare" videoId={p.video_uid} cfCode={p.video_cf_code} ratio={p.video_ratio}
          poster={streamPoster(p.video_cf_code, p.video_uid)} title={(p.body || "").split("\n")[0]} />
      </div>
    </div>
  )
}

function MilestoneSlide({ m, teamsMap, playersMap }) {
  const team = m.team || teamsMap[playersMap[m.playerId]?.team_id] || null
  const label = m.kind === "big_game" ? "משחק ענק" : "שלושער"
  const inner = (
    <span className="relative isolate flex h-full w-full flex-col items-center justify-center gap-2.5 p-5"
      style={{ backgroundImage: teamBlend(team, team, { angle: 110 }), color: onColor(team) }}>
      <RinkDrawing strength={0.3} className="absolute inset-x-2.5 top-1/2 -translate-y-1/2 -z-10 w-[calc(100%-20px)]" />
      {team && <CrestDisc team={team} size={64} shadow />}
      <span className="text-[14px] font-bold opacity-85 inline-flex items-center gap-1"><HatTrick className="w-5 h-5" />{label}</span>
      <span className="text-[26px] font-extrabold leading-tight text-center line-clamp-2">{m.name}</span>
      <span className="inline-flex items-baseline gap-1.5"><span className="fl-num text-[34px]">{m.goals}</span><span className="text-[14px] font-bold">שערים</span></span>
    </span>
  )
  return m.playerId ? <Link to={entityPath("players", m.playerId)} className="block h-full" aria-label={`${label}: ${m.name}, ${m.goals} שערים`}>{inner}</Link> : inner
}

function Thumb({ s, game, home, away, cover }) {
  if (s.kind === "band") return (
    <span className="absolute inset-0 flex items-center justify-center text-white" style={{ backgroundImage: teamBlend(home, away) }}>
      {cover && <img src={cover} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-55" />}
      <FLScore home={game.home_score} away={game.away_score} size={15} className="relative" />
    </span>
  )
  if (s.kind === "photo") return <img src={wideImage(s.photo.image_url, 480).src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
  if (s.kind === "clip") return (
    <>
      <img src={clipPoster(s.item, 240) || ""} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      <span aria-hidden="true" className="absolute top-1.5 left-1.5 text-white"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg></span>
    </>
  )
  const team = s.milestone.team
  return (
    <span className="absolute inset-0 flex items-center justify-center text-white" style={{ backgroundImage: teamBlend(team, team) }}>
      <span className="fl-num text-[20px]">{s.milestone.goals}</span>
    </span>
  )
}

/** "פרטי המשחק": goals and cards per player, guests apart (the old result card's box score). */
export function BoxScore({ game, stats, teamsMap, playersMap }) {
  const pill = (stat) => (
    <span className="flex gap-1.5">
      {stat.goals > 0 && <span className="stat-pill bg-surface-sunken text-fg-strong !py-0 !px-1.5 inline-flex items-center gap-1"><Ball className="w-5 h-5 -my-1" /><span className="fl-num">{stat.goals}</span></span>}
      {stat.blue_cards > 0 && <span className="stat-pill bg-surface-sunken text-fg-strong !py-0 !px-1.5"><BlueCard className="w-5 h-5 -my-1" />{stat.blue_cards}</span>}
      {stat.red_cards > 0 && <span className="stat-pill bg-surface-sunken text-fg-strong !py-0 !px-1.5"><RedCard className="w-5 h-5 -my-1" />{stat.red_cards}</span>}
    </span>
  )
  const guests = stats.filter(s => s.is_guest_player)
  return (
    <div className="p-4 rounded-2xl bg-surface-inset border border-line">
      <h4 className="font-bold text-[14px] text-fg-strong mb-3">סטטיסטיקות שחקנים</h4>
      <div className="grid grid-cols-2 gap-6">
        {[game.home_team_id, game.away_team_id].map(tid => (
          <div key={tid} className="min-w-0">
            <h5 className="text-[12px] font-semibold text-fg-muted mb-2 truncate">{teamsMap[tid]?.name || "—"}</h5>
            <div className="space-y-1">
              {stats.filter(s => playersMap[s.player_id]?.team_id === tid).map(stat => {
                const p = playersMap[stat.player_id]
                return (
                  <div key={stat.id} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                    <Link to={entityPath("players", stat.player_id)} className="min-w-0 truncate text-fg hover:underline">{p?.first_name} {p?.last_name}</Link>
                    {pill(stat)}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {guests.length > 0 && (
        <div className="mt-4 pt-3 border-t border-line">
          <h5 className="text-[12px] font-semibold text-fg-muted mb-2">אורחים</h5>
          {guests.map(stat => (
            <div key={stat.id} className="flex items-center justify-between py-1 text-[12px]">
              <span className="text-fg">{stat.guest_player_name}{stat.guest_player_original_team && <span className="text-fg-muted"> ({stat.guest_player_original_team})</span>}</span>
              {pill(stat)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The predictions strip (player + coach feeds only). The RPC decides what exists; an
 *  under-18 / blocked viewer still sees the crowd's pick only if the server returned it. */
function PredictionStrip({ game, homeName, awayName }) {
  const { user } = useAuth()
  const [line, setLine] = useState(null)
  useEffect(() => {
    let alive = true
    if (!user) { setLine(null); return }
    getGameMarketOdds(game.id).then(o => { if (alive) setLine(predictionLine(o, homeName, awayName)) }).catch(() => {})
    return () => { alive = false }
  }, [game.id, user, homeName, awayName])
  if (!line) return null
  return (
    <Link to={`/market`} className="mx-4 mt-2.5 min-h-[44px] rounded-xl bg-[#11161D] dark:bg-[#1E2630] text-[#F4F2EC] flex items-center gap-2 px-3 py-1.5">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--fl-accent))" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
      <span className="flex-1 min-w-0 text-[13px] font-bold">{line.crowd}</span>
      {line.mine != null && (
        <span className="shrink-0 text-[12px] text-[#C9D0D8]">התחזית שלך: <bdi dir="ltr">{line.mine >= 0 ? "+" : "−"}{Math.abs(line.mine)}</bdi> סטופרים</span>
      )}
    </Link>
  )
}
