/**
 * The game page hero (Game / GameStage boards; iOS GameHero): the two-team blend
 * (away LEFT, home RIGHT) with the rink drawn behind, or a real wide frame from this
 * game, crests WITHOUT the disc, the score — or the kick-off time before the game, struck
 * through when postponed — and a meta line (round · rink · referee) + the rink address.
 * The top row: back to /games, the stage chip, share. Crest and name open the team page.
 */
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, RotateCcw } from "lucide-react"
import { Share } from "@/components/icons/BrandIcons"
import { CrestDisc, FLScore, RinkDrawing, TeamBlend } from "@/components/fl/Floodlight"
import { teamBlend } from "@/lib/flTeam"
import { STAGE, isPlayedStage, timeOf, dayAndDate } from "./flGamesKit"
import { usePreviewSides } from "./PreviewStatCards"
import { PlayerStatCard } from "@/components/fl/cards/PlayerStatCard"

const glass = "bg-[rgba(8,12,18,0.35)] text-white"

export function HeroIconButton({ label, onClick, to, children }) {
  const cls = `size-11 shrink-0 rounded-full ${glass} flex items-center justify-center hover:bg-[rgba(8,12,18,0.55)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white`
  if (to) return <Link to={to} aria-label={label} className={cls}>{children}</Link>
  return <button type="button" onClick={onClick} aria-label={label} className={cls}>{children}</button>
}

function TeamColumn({ team, role, crest, lost, played }) {
  const inner = (
    <>
      <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]"><CrestDisc team={team} size={crest} disc={false} /></span>
      <span className={`flex flex-col items-center gap-0.5 ${lost ? "opacity-[0.62]" : ""}`}>
        <span className={`font-extrabold leading-tight text-center line-clamp-2 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.4)] ${played ? "text-[20px] sm:text-[24px]" : "text-[16px] sm:text-[20px]"}`}>
          {team?.name || "—"}
        </span>
        <span className="text-[12px] text-white/75">{role}</span>
      </span>
    </>
  )
  const cls = "min-w-0 flex flex-col items-center gap-2 rounded-2xl px-1 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
  if (!team?.id) return <div className={cls}>{inner}</div>
  return (
    <Link to={`/teams/${team.slug || team.id}`} className={`${cls} hover:bg-white/5 transition-colors`} aria-label={`${team.name}, ${role} — לעמוד הקבוצה`}>
      {inner}
    </Link>
  )
}

/** Pre-game face-off clip (gamePreviewVideo.js): plays once, muted, and holds on the two
 *  players standing face to face; their names fade in once they stop. `preview.loop` → loops
 *  forever (ping-pong baked into the file), no replay button. Reduced motion → the
 *  last frame as a still. The top row (back · chip · share) floats over the clip. */
function PreviewVideo({ preview, topRow }) {
  const ref = useRef(null)
  const [stood, setStood] = useState(false)
  const [still, setStill] = useState(false)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setStill(true); setStood(true); return }
    const p = v.play()
    if (p?.catch) p.catch(() => { setStill(true); setStood(true) })
  }, [])

  const replay = () => {
    const v = ref.current
    if (!v) return
    setStill(false); setStood(false)
    try { v.currentTime = 0 } catch { /* not seekable yet */ }
    v.play()?.catch?.(() => {})
  }

  const tag = (p, side) => p && (
    <span className={`absolute bottom-2.5 ${side === "left" ? "left-3 text-left" : "right-3 text-right"} z-10 text-white leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.6)] transition-all duration-500 ${stood ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1.5"}`}>
      <span className="block text-[13px] sm:text-[15px] font-extrabold">{p.name}</span>
      {p.number != null && <span className="block text-[11.5px] text-white/80" dir="ltr">#{p.number}</span>}
    </span>
  )

  return (
    <div className={`relative -mx-3 sm:-mx-6 -mt-3 lg:rounded-t-[28px] overflow-hidden aspect-video max-h-[440px] w-[calc(100%+1.5rem)] sm:w-[calc(100%+3rem)] bg-black`}>
      {still ? (
        <img src={preview.endFrame} alt="" className="absolute inset-0 size-full object-cover object-[50%_18%]" />
      ) : (
        <video ref={ref} src={preview.src} poster={preview.poster} muted playsInline preload="auto" loop={!!preview.loop}
          aria-label={`${preview.away?.name || ""} מול ${preview.home?.name || ""}`}
          onTimeUpdate={e => { if (e.currentTarget.currentTime >= preview.standAt) setStood(true) }}
          onEnded={() => setStood(true)}
          className="absolute inset-0 size-full object-cover object-[50%_18%]" />
      )}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-[rgba(5,7,12,0.8)]" />
      <div className="absolute inset-x-3 sm:inset-x-6 top-3 z-10">{topRow}</div>
      {tag(preview.away, "left")}
      {tag(preview.home, "right")}
      {!still && !preview.loop && (
        <button type="button" onClick={replay} aria-label="להפעיל שוב את הסרטון"
          className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full ${glass} text-[11.5px] font-bold px-3 py-1 transition-opacity ${stood ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <RotateCcw className="size-3" /> שוב
        </button>
      )}
    </div>
  )
}

/** Hex → rgba, for the team-colour wash. */
const tint = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return `rgba(20,26,38,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * The whole pre-game hero as one stage on the line-up clip (preview.cards), EA FC style:
 * the looping clip fills it, the kick-off time + both crests sit in the gap between the two
 * heads, the players' stat cards stand on it (phone: a row under the faces; wide: either side
 * of the players), and the team colours wash up from the bottom, split down the middle —
 * away LEFT, home RIGHT — with a slanted seam like a centre line.
 */
function PreviewStage({ game, home, away, preview, topRow, meta, address, postponed }) {
  const ref = useRef(null)
  const awayRef = useRef(null), homeRef = useRef(null)
  const [still, setStill] = useState(false)
  const sides = usePreviewSides(preview) // [away, home] = { who, card }
  const split = preview.split // { away, home }: one solo clip per player, side by side
  useEffect(() => {
    const vids = (split ? [awayRef.current, homeRef.current] : [ref.current]).filter(Boolean)
    if (!vids.length) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setStill(true); return }
    // start together so the two halves breathe in step
    vids.forEach(v => { try { v.currentTime = 0 } catch { /* not seekable yet */ } })
    vids.forEach(v => v.play()?.catch?.(() => setStill(true)))
  }, [split])
  // one solo clip in its half, cut on the same slanted seam as the colour wash. Every solo
  // clip is made from the same arena plate, so the frame's horizontal centre is the goal: each
  // clip is full height with its centre pinned on the seam (where it crosses goal height,
  // ~49.6% of the stage), so the two half-goals meet as one goal at any screen size.
  const SEAM_IN_LEFT = "95.4%", SEAM_IN_RIGHT = "3.1%" // 49.6% of the stage, inside each 52% box
  const half = (side, clip, r) => {
    const style = { position: "absolute", top: 0, height: "100%", width: "auto", maxWidth: "none",
      left: side === "left" ? SEAM_IN_LEFT : SEAM_IN_RIGHT, transform: "translateX(-50%)" }
    return (
      <div className={`absolute inset-y-0 overflow-hidden ${side === "left" ? "left-0" : "right-0"} w-[52%]`}
        style={{ clipPath: side === "left" ? "polygon(0 0, 100% 0, 92.3% 100%, 0 100%)" : "polygon(7.7% 0, 100% 0, 100% 100%, 0 100%)" }}>
        {still || !clip.src // no clip (a team without a face player) → the empty arena still
          ? <img src={clip.poster} alt="" style={style} />
          : <video ref={r} src={clip.src} poster={clip.poster} muted playsInline preload="auto" loop style={style} />}
      </div>
    )
  }
  const awayC = away?.primary_color, homeC = home?.primary_color
  // a crest with the team name under it; the whole block opens the team page
  const crestLink = (team, role, size) => {
    const inner = (
      <>
        <span className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]"><CrestDisc team={team} size={size} disc={false} /></span>
        <span dir="rtl" className="mt-1 text-[13px] sm:text-[16px] font-extrabold leading-tight text-center line-clamp-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">{team?.name || "—"}</span>
      </>
    )
    const cls = "flex flex-col items-center w-[88px] sm:w-[130px] rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    return team?.id
      ? <Link to={`/teams/${team.slug || team.id}`} aria-label={`${team.name}, ${role} — לעמוד הקבוצה`} className={cls}>{inner}</Link>
      : <span className={cls}>{inner}</span>
  }
  // top of the stage, between the heads: the date, then round · rink
  const dateLine = (
    <div dir="rtl" className="flex flex-col items-center text-center [text-shadow:0_2px_8px_rgba(0,0,0,0.65)]">
      <span className="text-[16px] sm:text-[20px] font-extrabold">{dayAndDate(game.game_date)}</span>
      {meta.length > 0 && (
        <p className="mt-0.5 text-[14px] sm:text-[16px] font-bold text-white/95 leading-snug">
          {meta.map((m, i) => (
            <span key={i} className="whitespace-nowrap">{i > 0 && <span aria-hidden="true" className="mx-1.5 opacity-70">·</span>}{m}</span>
          )).reduce((acc, el) => acc.concat(el, " "), [])}
        </p>
      )}
    </div>
  )
  // mid-stage, under the faces: crest · time · crest
  const centre = (
    <div dir="rtl" className="flex flex-col items-center text-center [text-shadow:0_2px_8px_rgba(0,0,0,0.65)]">
      <div dir="ltr" className="flex items-start gap-1 sm:gap-4">
        <span className="sm:hidden">{crestLink(away, "חוץ", 72)}</span>
        <span className="hidden sm:inline">{crestLink(away, "חוץ", 100)}</span>
        <span className={`self-start mt-[12px] sm:mt-[16px] fl-num text-[48px] sm:text-[68px] leading-none ${postponed ? "line-through opacity-60" : ""}`} aria-label={`שעת פתיחה ${timeOf(game.game_date)}`}>{timeOf(game.game_date)}</span>
        <span className="sm:hidden">{crestLink(home, "בית", 72)}</span>
        <span className="hidden sm:inline">{crestLink(home, "בית", 100)}</span>
      </div>
      <span className="sr-only">{away?.name} (חוץ) נגד {home?.name} (בית)</span>
    </div>
  )
  return (
    <section aria-label="המשחק" className={`relative isolate overflow-hidden rounded-b-[30px] lg:rounded-[28px] bg-[#0b0f15] text-white ${postponed ? "grayscale-[1] opacity-[0.92]" : ""}`}>
      {/* the clip: top 500px on a phone (faces stay in frame), the whole stage when wide */}
      <div aria-hidden={still ? "true" : undefined} className="absolute inset-x-0 top-0 h-[500px] sm:h-full -z-20">
        {split ? (
          <div role="img" aria-label={`${preview.away?.name || ""} מול ${preview.home?.name || ""}`} className="absolute inset-0">
            {half("left", split.away, awayRef)}
            {half("right", split.home, homeRef)}
          </div>
        ) : still
          ? <img src={preview.endFrame} alt="" className="size-full object-cover object-[50%_15%]" />
          : <video ref={ref} src={preview.src} poster={preview.poster} muted playsInline preload="auto" loop={!!preview.loop}
              aria-label={`${preview.away?.name || ""} מול ${preview.home?.name || ""}`}
              className="size-full object-cover object-[50%_15%]" />}
        <span className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#0b0f15] sm:hidden" />
      </div>
      {/* split wash: away colour LEFT, home colour RIGHT, slanted seam in the middle */}
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={{
        clipPath: "polygon(0 0, 52% 0, 48% 100%, 0 100%)",
        backgroundImage: `linear-gradient(180deg, ${tint(awayC, 0)} 28%, ${tint(awayC, 0.55)} 62%, ${tint(awayC, 0.9)} 100%)`,
      }} />
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={{
        clipPath: "polygon(52% 0, 100% 0, 100% 100%, 48% 100%)",
        backgroundImage: `linear-gradient(180deg, ${tint(homeC, 0)} 28%, ${tint(homeC, 0.55)} 62%, ${tint(homeC, 0.9)} 100%)`,
      }} />
      <svg aria-hidden="true" className="absolute inset-0 -z-10 size-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="52" y1="38" x2="48" y2="100" stroke="rgba(255,255,255,0.35)" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-28 -z-10 bg-gradient-to-b from-[rgba(5,7,12,0.55)] to-transparent" />

      <div className="relative px-3 sm:px-6 pt-3 pb-5 sm:pb-6 sm:min-h-[640px] lg:min-h-[680px] flex flex-col">
        {topRow}
        <div className="mt-2">{dateLine}</div>
        {/* time + crests sit mid-stage, over the chests, under the faces */}
        <div className="h-[110px] sm:h-[140px] lg:h-[155px]" />
        <div className="mt-3 sm:mt-0">{centre}</div>
        <div className="flex-1 min-h-[24px] sm:min-h-[40px]" />
        {/* the two cards stand at the bottom: away LEFT, home RIGHT */}
        <div dir="ltr" className="grid grid-cols-2 gap-2 sm:flex sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:w-[300px]">{sides?.[0] ? <PlayerStatCard who={sides[0].who} team={away} card={sides[0].card} /> : <PlayerStatCard who={{ name: "" }} team={away} card={null} />}</div>
          <div className="min-w-0 sm:w-[300px]">{sides?.[1] ? <PlayerStatCard who={sides[1].who} team={home} card={sides[1].card} /> : <PlayerStatCard who={{ name: "" }} team={home} card={null} />}</div>
        </div>
        {address && <p className="mt-2 text-center text-[11.5px] text-white/75">{address}</p>}
      </div>
    </section>
  )
}

export default function GameHero({ game, home, away, stage, chip, round, judges = [], address, photoUrl, onShare, scores, typeLabel, preview }) {
  const played = isPlayedStage(stage)
  const postponed = stage === STAGE.postponed
  const s = scores
  const homeLost = played && s && s[0] < s[1]
  const awayLost = played && s && s[1] < s[0]
  const crest = played ? 96 : 84

  const sub = (() => {
    switch (stage) {
      case STAGE.before: return dayAndDate(game.game_date)
      case STAGE.postponed: return `היה אמור להתקיים ב${dayAndDate(game.game_date)}`
      case STAGE.gameDay: return null // the chip carries the countdown
      case STAGE.justEnded: case STAGE.after:
        if (!s) return game.status === "waiting_result" ? "ממתין לתוצאה" : null
        if (s[0] === s[1]) return "תיקו"
        return `ניצחון ל${s[0] > s[1] ? home?.name || "בית" : away?.name || "חוץ"}`
      default: return null
    }
  })()

  const meta = []
  if (played || postponed) meta.push(`${dayAndDate(game.game_date)} · ${timeOf(game.game_date)}`)
  else if (round) meta.push(`מחזור ${round}`)
  if (typeLabel) meta.push(typeLabel)
  if (game.venue?.trim()) meta.push(`מגרש ${game.venue.trim()}`)
  if (judges.length) meta.push(`${judges.length > 1 ? "שופטים" : "שופט"}: ${judges.join(", ")}`)

  const chipTone = stage === STAGE.gameDay ? "bg-fl-accent text-[#11161D]" : postponed ? "bg-fl-disc text-[#11161D]" : glass

  if (preview?.cards && !played) {
    const topRow = (
      <div className="relative flex items-center justify-between gap-2">
        <HeroIconButton to="/games" label="חזרה למשחקים"><ArrowRight className="size-5" /></HeroIconButton>
        {chip && <span className={`text-[12px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${chipTone}`}>{chip}</span>}
        <HeroIconButton onClick={onShare} label="שיתוף המשחק"><Share className="size-6" /></HeroIconButton>
      </div>
    )
    return <PreviewStage game={game} home={home} away={away} preview={preview} topRow={topRow} meta={meta} address={address} postponed={postponed} />
  }

  return (
    <TeamBlend as="section" aria-label="המשחק" home={home} away={away}
      className={`rounded-b-[30px] lg:rounded-[28px] px-3 sm:px-6 pt-3 pb-6 ${postponed ? "grayscale-[1] opacity-[0.92]" : ""}`}>
      {photoUrl && (
        <>
          <img src={photoUrl} alt="" decoding="async" fetchpriority="high" className="absolute inset-0 -z-20 size-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0 -z-10 opacity-[0.72]" style={{ backgroundImage: teamBlend(home, away) }} />
        </>
      )}
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={{ backgroundImage: "linear-gradient(180deg, rgba(10,13,20,0) 45%, rgba(10,13,20,0.5) 100%)" }} />

      {(() => {
        const topRow = (
          <div className="relative flex items-center justify-between gap-2">
            <HeroIconButton to="/games" label="חזרה למשחקים"><ArrowRight className="size-5" /></HeroIconButton>
            {chip && <span className={`text-[12px] font-bold px-3 py-1.5 rounded-full whitespace-nowrap ${chipTone}`}>{chip}</span>}
            <HeroIconButton onClick={onShare} label="שיתוף המשחק"><Share className="size-6" /></HeroIconButton>
          </div>
        )
        return preview ? <PreviewVideo preview={preview} topRow={topRow} /> : topRow
      })()}

      <div className={`relative ${preview ? "mt-2 sm:mt-3" : "mt-5 sm:mt-6"} py-3.5`}>
        {!photoUrl && !preview && <RinkDrawing strength={0.3} className="absolute inset-0 -z-10 size-full opacity-50" />}
        {/* Physical left → right: away, centre, home (home on the RIGHT). */}
        <div dir="ltr" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 sm:gap-6 max-w-3xl mx-auto">
          <div dir="rtl" className="min-w-0 flex justify-center"><TeamColumn team={away} role="חוץ" crest={crest} lost={awayLost} played={played} /></div>
          <div dir="rtl" className="flex flex-col items-center gap-1.5 min-w-[6.5rem] sm:min-w-[9rem]">
            {s && played ? (
              <FLScore home={s[0]} away={s[1]} size={72} className="max-sm:!text-[60px]" />
            ) : (
              <span dir="ltr" className={`fl-num text-[44px] sm:text-[52px] ${postponed ? "line-through opacity-60" : ""}`} aria-label={`שעת פתיחה ${timeOf(game.game_date)}`}>
                {timeOf(game.game_date)}
              </span>
            )}
            {sub && <span className="text-[12.5px] font-bold text-white text-center leading-snug line-clamp-2">{sub}</span>}
          </div>
          <div dir="rtl" className="min-w-0 flex justify-center"><TeamColumn team={home} role="בית" crest={crest} lost={homeLost} played={played} /></div>
        </div>
      </div>

      {meta.length > 0 && (
        <p className="relative mt-3 text-center text-[13px] text-white/85 leading-relaxed">
          {meta.map((m, i) => (
            <span key={i} className="whitespace-nowrap">{i > 0 && <span aria-hidden="true" className="mx-2 opacity-70">·</span>}{m}</span>
          )).reduce((acc, el) => acc.concat(el, " "), [])}
        </p>
      )}
      {address && <p className="relative mt-1 text-center text-[11.5px] text-white/65">{address}</p>}
    </TeamBlend>
  )
}
