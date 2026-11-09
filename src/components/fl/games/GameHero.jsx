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
 *  players standing face to face; their names fade in once they stop. Reduced motion → the
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
    <div className="relative -mx-3 sm:-mx-6 -mt-3 lg:rounded-t-[28px] overflow-hidden aspect-video max-h-[440px] w-[calc(100%+1.5rem)] sm:w-[calc(100%+3rem)] bg-black">
      {still ? (
        <img src={preview.endFrame} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <video ref={ref} src={preview.src} poster={preview.poster} muted playsInline preload="auto"
          aria-label={`${preview.away?.name || ""} מול ${preview.home?.name || ""}`}
          onTimeUpdate={e => { if (e.currentTarget.currentTime >= preview.standAt) setStood(true) }}
          onEnded={() => setStood(true)}
          className="absolute inset-0 size-full object-cover" />
      )}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-b from-transparent to-[rgba(5,7,12,0.8)]" />
      <div className="absolute inset-x-3 sm:inset-x-6 top-3 z-10">{topRow}</div>
      {tag(preview.away, "left")}
      {tag(preview.home, "right")}
      {!still && (
        <button type="button" onClick={replay} aria-label="להפעיל שוב את הסרטון"
          className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full ${glass} text-[11.5px] font-bold px-3 py-1 transition-opacity ${stood ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
          <RotateCcw className="size-3" /> שוב
        </button>
      )}
    </div>
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
