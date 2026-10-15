import { useState, useEffect } from "react"
import { useParams } from "react-router-dom"
import { getGameById, getTeams } from "@/lib/api"
import { getLiveGame, subscribeLiveGame } from "@/lib/live"
import { useSlugId } from "@/lib/slugs"
import { sizedImage } from "@/lib/imageSize"

/**
 * Sheet row 21 — אפשר לחבר לטלוויזיה עם כבל ולשדר בטלוויזיה.
 *
 * A screen built for a TV across the hall, not a phone in your hand: no nav, no menus,
 * no chrome — just the two crests, the score and the clock, sized in viewport units so
 * they scale to whatever panel is plugged in. Reached at /games/:id/tv.
 *
 * The clock is never streamed tick-by-tick. A running clock arrives as an absolute
 * deadline (`clock_ends_at`) and is counted down locally; a paused one arrives as a
 * frozen `clock_remaining_ms`. So this stays exact even on a flaky hall connection.
 */
/* Sizes track the SMALLER of the two axes. Sizing purely in vh works on a landscape TV,
 * where height is the constraint, but on a portrait phone width is — two big score digits
 * plus the clock simply run off the sides. min(vw,vh) makes whichever dimension is
 * tighter govern, and the rem clamps bound the extremes. Mirrors SB in GameScoreboard. */
const TV = {
  crest: "clamp(3rem, min(16vh, 18vw), 12rem)",
  name:  "clamp(0.9rem, min(4vh, 4.5vw), 3rem)",
  score: "clamp(3rem, min(22vh, 20vw), 18rem)",
  clock: "clamp(2.5rem, min(14vh, 15vw), 13rem)",
  period:"clamp(0.9rem, min(4vh, 4vw), 2.5rem)",
  note:  "clamp(0.75rem, min(3vh, 3vw), 1.5rem)",
}

/* Each side is its own element, so the digits never reorder against the RTL layout.
 * Declared at module scope on purpose: the clock re-renders this page 4x a second, and
 * a component defined inside the render body is a new type every tick — React would
 * remount the crest each frame and never let the load-error state below stick. */
function Side({ team, score }) {
  // A crest URL can go dead (team re-uploads, storage object removed). Without onError
  // the TV shows a broken-image glyph on a hall wall; fall back to the empty spacer.
  const [imgError, setImgError] = useState(false)
  useEffect(() => { setImgError(false) }, [team?.logo_url])

  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-[2vh]">
      {team?.logo_url && !imgError
        ? <img src={sizedImage(team.logo_url, 256, 'contain')} alt="" onError={() => setImgError(true)} style={{ height: TV.crest, width: TV.crest }} className="object-contain" />
        : <div style={{ height: TV.crest }} />}
      <p style={{ fontSize: TV.name }} className="font-bold text-white/80 truncate max-w-full px-2">{team?.name || "—"}</p>
      <p style={{ fontSize: TV.score }} className="leading-none font-extrabold text-white tabular-nums">{score}</p>
    </div>
  )
}

export default function GameTv() {
  const { id: routeKey } = useParams()
  const { id } = useSlugId('games', routeKey)
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [live, setLive] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!id) return // still resolving a slug into the game's UUID
    let alive = true
    Promise.all([getGameById(id), getTeams(), getLiveGame(id)]).then(([g, t, l]) => {
      if (!alive) return
      setGame(g); setTeams(t); setLive(l)
    }).catch(() => {})
    const unsub = subscribeLiveGame(id, row => setLive(row))
    return () => { alive = false; unsub?.() }
  }, [id])

  // Local tick for the countdown. 250ms is plenty for a seconds display and keeps a
  // TV that may be left on all evening from doing needless work.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  // Keep the panel awake — a scoreboard that sleeps mid-game is useless.
  useEffect(() => {
    let lock = null
    navigator.wakeLock?.request("screen").then(l => { lock = l }).catch(() => {})
    return () => { lock?.release?.().catch(() => {}) }
  }, [])

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const home = game ? teamsMap[game.home_team_id] : null
  const away = game ? teamsMap[game.away_team_id] : null

  const remainingMS = live?.is_running && live?.clock_ends_at
    ? Math.max(0, new Date(live.clock_ends_at).getTime() - now)
    : Math.max(0, live?.clock_remaining_ms ?? 0)
  const mm = String(Math.floor(remainingMS / 60000)).padStart(2, "0")
  const ss = String(Math.floor((remainingMS % 60000) / 1000)).padStart(2, "0")

  const homeScore = live?.home_score ?? game?.home_score ?? 0
  const awayScore = live?.away_score ?? game?.away_score ?? 0

  if (!game) {
    return <div className="fixed inset-0 z-[100] bg-[#0E2350] flex items-center justify-center text-white/60 text-2xl">טוען…</div>
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#0E2350] flex flex-col items-center justify-center select-none overflow-hidden">
      <div className="w-full flex items-center justify-center gap-[min(4vw,3vh)] px-[3vw]">
        <Side team={home} score={homeScore} />
        <div className="flex flex-col items-center gap-[1vh] shrink-0">
          <p style={{ fontSize: TV.clock }} className="leading-none font-extrabold text-white tabular-nums" dir="ltr">
            {mm}:{ss}
          </p>
          {live?.period && (
            <p style={{ fontSize: TV.period }} className="font-bold text-white/70">{live.period}</p>
          )}
          {live && !live.is_running && (
            <p style={{ fontSize: TV.note }} className="font-bold text-amber-400">עצור</p>
          )}
        </div>
        <Side team={away} score={awayScore} />
      </div>

      {!live && (
        <p style={{ fontSize: TV.note }} className="absolute bottom-[4vh] text-white/40">המשחק אינו משודר כרגע</p>
      )}
    </div>
  )
}
