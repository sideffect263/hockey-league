import { useState, useEffect, useRef } from "react"
import { useParams } from "react-router-dom"
import { getGameById, getTeams, getGames } from "@/lib/api"
import { getLiveGame, subscribeLiveGame, liveFouls, liveTimeouts } from "@/lib/live"
import { useSlugId } from "@/lib/slugs"
import { clockString } from "@/lib/game/format"
import { teamBlend } from "@/lib/flTeam"
import TeamLogo from "@/components/TeamLogo"
import { RinkDrawing } from "@/components/fl/Floodlight"
import {
  blueTimers, liveRemaining, liveIsBreak, liveIsTimeout, liveIsOver, roundsOf, timeOf, dayAndDate, buildTimeline,
} from "@/components/fl/games/flGamesKit"

/**
 * /games/:id/tv — the fan scoreboard for a TV across the hall (FanTV board): no nav, no
 * menus. Home on the RIGHT, big names, the score, the half + clock, blue-card timers
 * stacked under the clock on each team's side, fouls at 96 px and timeout dots per side,
 * a goal splash, timeout / half-time / final states.
 *
 * Drawn on a fixed 1280×720 stage scaled to fit whatever panel is plugged in (letterboxed
 * on the team blend), so the board's sizes hold on any TV.
 *
 * The clock is never streamed tick-by-tick: a running clock arrives as an absolute
 * deadline (`clock_ends_at`) and is counted down locally; a paused one arrives frozen.
 * The 45 s passive counter shows only when the board broadcasts it (`state.passive`):
 * the live row is sent on significant changes, so it cannot be rebuilt here.
 */
const W = 1280, H = 720
const GOAL_MS = 4500

function useStageScale() {
  const [s, setS] = useState(1)
  useEffect(() => {
    const on = () => setS(Math.min(window.innerWidth / W, window.innerHeight / H))
    on()
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return s
}

function Side({ team, score, dim, order }) {
  const name = team?.name || "—"
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0" style={{ order, opacity: dim ? 0.5 : 1 }}>
      <TeamLogo team={team} px={132} />
      <span className="font-extrabold whitespace-nowrap leading-[1.1] max-w-full overflow-hidden text-ellipsis" style={{ fontSize: name.length > 10 ? 50 : 66 }}>{name}</span>
      <span className="fl-num" style={{ fontSize: 230, lineHeight: 0.88 }}>{score}</span>
    </div>
  )
}

function Bottom({ fouls, timeouts, order }) {
  return (
    <div className="flex items-center justify-center gap-[30px]" style={{ order }}>
      {fouls != null && (
        <span className="flex items-baseline gap-3">
          <span className="text-[30px] font-extrabold text-[#C9D0D8]">עבירות</span>
          <span dir="ltr" className="fl-num text-[96px] leading-none text-[#FF9F43]">{fouls}</span>
        </span>
      )}
      {timeouts && (
        <span className="flex flex-col items-center gap-2">
          <span className="flex gap-2.5">
            {Array.from({ length: Math.min(5, Math.max(0, timeouts.max)) }, (_, i) => (
              <span key={i} className="size-6 rounded-full border-[3px] border-white" style={{ background: i < timeouts.used ? "#FFFFFF" : "transparent" }} />
            ))}
          </span>
          <span className="text-[20px] font-bold text-[#C9D0D8]">פסקי זמן</span>
        </span>
      )}
    </div>
  )
}

export default function GameTv() {
  const { id: routeKey } = useParams()
  const { id } = useSlugId('games', routeKey)
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [round, setRound] = useState(null)
  const [live, setLive] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [goal, setGoal] = useState(null)   // { home, who, score:[h,a], minute }
  const prev = useRef(null)
  const scale = useStageScale()

  useEffect(() => {
    if (!id) return // still resolving a slug into the game's UUID
    let alive = true
    Promise.all([getGameById(id), getTeams(), getLiveGame(id), getGames().catch(() => [])]).then(([g, t, l, all]) => {
      if (!alive) return
      setGame(g); setTeams(t); setLive(l); setRound(roundsOf(all)[g?.id] || null)
    }).catch(() => {})
    const unsub = subscribeLiveGame(id, row => setLive(row))
    return () => { alive = false; unsub?.() }
  }, [id])

  // Local tick for the countdown (250 ms keeps a TV left on all evening light).
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

  // Goal splash: a score that went UP since the last row (never on the first read).
  useEffect(() => {
    if (!live) return
    const p = prev.current
    prev.current = { h: live.home_score ?? 0, a: live.away_score ?? 0 }
    if (!p) return
    const homeUp = (live.home_score ?? 0) > p.h, awayUp = (live.away_score ?? 0) > p.a
    if (!homeUp && !awayUp) return
    const goals = buildTimeline(live.state?.events || [], live.state?.periodMS).filter(e => e.kind === "goal")
    const last = [...goals].reverse().find(e => e.home === homeUp) || null
    setGoal({ home: homeUp, who: last ? (last.ownGoal ? "שער עצמי" : last.player) : null, minute: last?.minute, score: [live.home_score ?? 0, live.away_score ?? 0] })
    const t = setTimeout(() => setGoal(null), GOAL_MS)
    return () => clearTimeout(t)
  }, [live?.home_score, live?.away_score])

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const home = game ? teamsMap[game.home_team_id] : null
  const away = game ? teamsMap[game.away_team_id] : null
  const blend = teamBlend(home, away, { angle: 100 })

  if (!game) {
    return <div className="fixed inset-0 z-[100] bg-[#0B0F14] flex items-center justify-center text-white/60 text-2xl">טוען…</div>
  }

  const over = liveIsOver(live) || game.status === "completed"
  const brk = liveIsBreak(live), timeout = liveIsTimeout(live)
  const remaining = over ? 0 : liveRemaining(live, now)
  const hs = live?.home_score ?? game.home_score ?? 0
  const as = live?.away_score ?? game.away_score ?? 0
  const fouls = live ? liveFouls(live) : null
  const to = live && !over ? liveTimeouts(live) : null
  const period = over ? "סיום" : timeout ? "פסק זמן" : brk ? "הפסקה" : live?.period || ""
  const note = over ? (hs === as ? "תיקו" : `${(hs > as ? home : away)?.name || ""} ניצחה`)
    : brk && !timeout ? "המחצית הבאה בסוף ההפסקה" : live && !live.is_running ? "עצור" : ""
  const accent = timeout || (brk && !timeout)
  const blues = (h) => (live && !over ? blueTimers(live, h, remaining) : [])
  const passive = live?.state?.passive && Number.isFinite(live.state.passive.remainingMS) && !over && !brk ? Math.ceil(live.state.passive.remainingMS / 1000) : null
  const showLive = !!live && !over
  const scorer = goal ? (goal.home ? home : away) : null

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden select-none flex items-center justify-center" style={{ backgroundImage: blend, backgroundColor: "#0B0F14" }} dir="rtl">
      <div className="relative shrink-0 text-white overflow-hidden" style={{ width: W, height: H, transform: `scale(${scale})`, backgroundImage: blend }}>
        <span aria-hidden="true" className="absolute inset-0" style={{ background: "radial-gradient(70% 70% at 50% 50%, rgba(7,11,16,0.55), rgba(7,11,16,0.15))" }} />
        <RinkDrawing strength={0.25} className="absolute inset-x-[140px] top-[90px] bottom-[60px] opacity-40" />

        {/* top: league + round (right) · LIVE / סיום (left) */}
        <div className="absolute top-[22px] inset-x-10 flex items-center justify-between">
          <span className="flex items-center gap-3.5">
            <img src="/logos/mark-256.png" alt="" className="size-11 rounded-xl" />
            <span className="text-[24px] font-extrabold opacity-85">ליגת הוקי גלגיליות{round ? ` · מחזור ${round}` : ""}</span>
          </span>
          {(live || over) && (
            <span className="flex items-center gap-2.5 text-[22px] font-extrabold px-[18px] py-2 rounded-full" style={{ background: showLive ? "#E0362C" : "rgba(255,255,255,0.18)" }}>
              <span className="size-3 rounded-full bg-white" />{showLive ? "LIVE" : "סיום"}
            </span>
          )}
        </div>

        {/* middle: home (right) · clock · away (left) */}
        <div className="absolute top-[84px] inset-x-[30px] grid grid-cols-[minmax(0,1fr)_460px_minmax(0,1fr)] items-start">
          <Side team={home} score={hs} dim={over && hs < as} order={0} />
          <div className="flex flex-col items-center gap-1 pt-1.5" style={{ order: 1 }}>
            <span className="text-[68px] font-extrabold leading-[1.05] whitespace-nowrap" style={{ color: over || accent ? "#F2B233" : "#E4E8EE" }}>{period || " "}</span>
            {live || over ? (
              <span dir="ltr" className="fl-num text-[168px] leading-none" style={{ color: accent ? "#F2B233" : "#FFFFFF" }}>{clockString(remaining)}</span>
            ) : (
              <span dir="ltr" className="fl-num text-[140px] leading-none">{timeOf(game.game_date)}</span>
            )}
            <span className="text-[30px] font-extrabold min-h-[34px] whitespace-nowrap" style={{ color: over ? "#FFFFFF" : "#C9D0D8" }}>
              {live || over ? note : `${dayAndDate(game.game_date)} · המשחק אינו משודר כרגע`}
            </span>
            {/* blue-card timers: home's under the clock on the RIGHT, away's on the LEFT */}
            <div className="w-full grid grid-cols-2 gap-3 mt-1.5">
              {[true, false].map(h => (
                <div key={String(h)} className="flex flex-col gap-2">
                  {blues(h).map(c => (
                    <span key={c.id} className="h-[58px] flex items-center justify-between gap-2.5 px-4 rounded-[14px] bg-[#2F6FD6]">
                      <span className="text-[24px] font-extrabold whitespace-nowrap overflow-hidden text-ellipsis min-w-0">{c.who}</span>
                      <span dir="ltr" className="fl-num text-[38px]">{clockString(c.remaining).replace(/^0/, "")}</span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <Side team={away} score={as} dim={over && as < hs} order={2} />
        </div>

        {/* bottom: fouls + timeouts per side, the passive counter in the centre */}
        {live && !over && (
          <div className="absolute bottom-3.5 inset-x-[30px] grid grid-cols-[minmax(0,1fr)_460px_minmax(0,1fr)] items-end">
            <Bottom fouls={fouls?.home} timeouts={to ? { used: to.home, max: to.max } : null} order={0} />
            <div className="flex justify-center" style={{ order: 1 }}>
              {passive != null && (
                <span dir="ltr" className="fl-num text-[96px] leading-none" style={{ color: passive <= 10 ? "#FF6B60" : "#7EE08F" }} aria-label={`משחק פסיבי ${passive}`}>{passive}</span>
              )}
            </div>
            <Bottom fouls={fouls?.away} timeouts={to ? { used: to.away, max: to.max } : null} order={2} />
          </div>
        )}

        {over && (
          <div className="absolute inset-x-0 bottom-10 flex justify-center">
            <span className="text-[26px] font-extrabold px-5 py-2 rounded-xl bg-[rgba(7,11,16,0.55)]">התקצירים והגולים באפליקציה · rinkhockeyil.com</span>
          </div>
        )}

        {/* goal splash */}
        {goal && (
          <div className="absolute inset-0 flex items-center justify-center fl-fade-in" style={{ backgroundImage: teamBlend(scorer, scorer, { angle: 100 }) }}>
            <span aria-hidden="true" className="absolute inset-0 bg-[rgba(7,11,16,0.35)]" />
            <div className="relative flex items-center gap-[60px]">
              <div className="flex flex-col items-center gap-2.5">
                <TeamLogo team={scorer} px={220} />
                <span dir="rtl" className="fl-num text-[80px] flex gap-[18px]"><span>{goal.score[0]}</span><span>:</span><span>{goal.score[1]}</span></span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[210px] font-black leading-[0.9] tracking-[-4px]">גול!</span>
                {goal.who && <span className="text-[60px] font-extrabold">{goal.who}</span>}
                <span className="text-[32px] font-bold opacity-85">{scorer?.name}{goal.minute ? ` · דקה ${goal.minute}` : ""}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
