/**
 * The live part of the game page (GameLive board; iOS LiveGameView), drawn from the
 * live_game_state row the judge broadcasts (the page subscribes and hands it in):
 * - the score band in the two teams' blend (home RIGHT): crests + names (→ team page),
 *   score, status · clock, half progress, per side fouls x/10 (9th–10th red), timeout
 *   dots and running blue-card timers;
 * - at half-time a break countdown card;
 * - the two-sided timeline (GameTimeline) is exported separately so the page can put the
 *   player and quick actions between the band and it.
 * The clock is reconstructed locally from the deadline (never streamed per tick); a
 * judge whose heartbeat goes stale freezes it ("ממתין לשופט"), like LiveGame.jsx.
 */
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { GoalIcon, Timeout } from "@/components/icons/BrandIcons"
import { CrestDisc, FLScore, TeamBlend, LiveChip } from "@/components/fl/Floodlight"
import { liveFouls, liveTimeouts } from "@/lib/live"
import { clockString } from "@/lib/game/format"
import { GameRules } from "@/lib/game/rules"
import {
  blueTimers, buildTimeline, timelineRows, liveRemaining, liveIsBreak, liveIsTimeout, liveIsOver, minuteMark,
} from "./flGamesKit"

const STALE_MS = 25000
const judgeGone = (live, now) => !!live?.is_running && !!live?.updated_at && live.phase !== "breakTime"
  && now - new Date(live.updated_at).getTime() > STALE_MS

/** Re-render on a timer while the clock runs (500 ms), once a minute otherwise. */
export function useLiveNow(live) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const iv = setInterval(() => setNow(Date.now()), live?.is_running ? 500 : 60000)
    return () => clearInterval(iv)
  }, [live])
  return now
}

function SideHeader({ team, role, crestFirst }) {
  const body = (
    <span className={`flex items-center gap-2 min-w-0 ${crestFirst ? "" : "flex-row-reverse"}`}>
      <CrestDisc team={team} size={50} />
      <span dir="rtl" className={`flex flex-col gap-0.5 min-w-0 ${crestFirst ? "items-start text-left" : "items-end text-right"}`}>
        <span className="text-[15px] sm:text-[17px] font-extrabold leading-tight line-clamp-2">{team?.name || role}</span>
        <span className="text-[11.5px] opacity-75">{role}</span>
      </span>
    </span>
  )
  const cls = `flex min-w-0 ${crestFirst ? "justify-start" : "justify-end"} pt-3.5 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-white`
  return team?.id
    ? <Link to={`/teams/${team.slug || team.id}`} className={cls} aria-label={`${team.name} — לעמוד הקבוצה`}>{body}</Link>
    : <div className={cls}>{body}</div>
}

function FoulsBlock({ fouls, timeouts, blues }) {
  const n = Math.max(0, fouls ?? 0)
  return (
    <div dir="rtl" className="rounded-[14px] bg-[rgba(8,12,18,0.45)] p-2.5 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between text-[12px]">
        <span className="opacity-80">עבירות</span>
        <span dir="ltr" className="fl-num text-[18px]">{n}<span className="text-[12px] opacity-60">/10</span></span>
      </div>
      <div dir="rtl" className="flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="flex-1 h-[5px] rounded-full" style={{ background: i < n ? (i >= 8 ? "#F2574D" : "#FFFFFF") : "rgba(255,255,255,.22)" }} />
        ))}
      </div>
      {timeouts && (
        <div className="flex items-center justify-between text-[12px]">
          <span className="opacity-80">פסק זמן</span>
          <span className="flex gap-1" aria-label={`פסקי זמן: ${timeouts.used} מתוך ${timeouts.max}`}>
            {Array.from({ length: Math.min(5, Math.max(0, timeouts.max)) }, (_, i) => (
              <span key={i} className={`size-3 rounded-full border-2 border-white ${i < timeouts.used ? "bg-white" : ""}`} />
            ))}
          </span>
        </div>
      )}
      {blues.map(b => (
        <div key={b.id} className="flex items-center gap-1.5 rounded-[9px] bg-fl-blue px-2 py-1 text-[12px] font-bold min-w-0">
          <span aria-hidden="true" className="w-[9px] h-[13px] rounded-[2px] bg-white shrink-0" />
          <span className="truncate">{b.who}</span>
          <span dir="ltr" className="fl-num text-[14px] ms-auto">{clockString(b.remaining).replace(/^0/, "")}</span>
        </div>
      ))}
    </div>
  )
}

/** The score band + (at half-time) the break card. Nothing once the board says it's over. */
export default function GameLiveBand({ home, away, live }) {
  const now = useLiveNow(live)
  if (!live || liveIsOver(live)) return null
  const stale = judgeGone(live, now)
  const remaining = liveRemaining(live, stale ? new Date(live.updated_at).getTime() + 0 : now)
  const brk = liveIsBreak(live)
  const timeout = liveIsTimeout(live)
  const status = stale ? "ממתין לשופט" : timeout ? "פסק זמן" : brk ? "הפסקה" : live.period || (live.is_running ? "רץ" : "מושהה")
  const periodMS = live.state?.periodMS || GameRules.defaultPeriodMS
  const progress = brk ? null : Math.min(1, Math.max(0, 1 - remaining / periodMS))
  const fouls = liveFouls(live)
  const to = liveTimeouts(live)

  return (
    <div className="flex flex-col gap-3">
      <TeamBlend as="section" aria-label="תוצאה חיה" home={home} away={away} className="rounded-[26px] px-3.5 sm:px-5 pt-3.5 pb-4">
        <div dir="ltr" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
          <SideHeader team={away} role="חוץ" crestFirst />
          <div className="flex flex-col items-center gap-1.5 px-1">
            <LiveChip />
            <FLScore home={live.home_score ?? 0} away={live.away_score ?? 0} size={52} />
            <span dir="rtl" className="text-[13px] font-bold text-fl-accent whitespace-nowrap">
              {status} · <span dir="ltr" className="tabular-nums">{clockString(remaining)}</span>
            </span>
          </div>
          <SideHeader team={home} role="בית" crestFirst={false} />
        </div>
        {progress != null && (
          <div dir="rtl" className="mt-3 h-1 rounded-full bg-white/20 overflow-hidden" role="progressbar" aria-label="התקדמות המחצית"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span className="block h-full rounded-full bg-fl-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div dir="ltr" className="mt-3 grid grid-cols-2 gap-2.5">
          <FoulsBlock fouls={fouls?.away} timeouts={to ? { used: to.away, max: to.max } : null} blues={blueTimers(live, false, remaining)} />
          <FoulsBlock fouls={fouls?.home} timeouts={to ? { used: to.home, max: to.max } : null} blues={blueTimers(live, true, remaining)} />
        </div>
      </TeamBlend>

      {brk && !timeout && (
        <section aria-label="הפסקת מחצית" className="rounded-[18px] bg-[#11161D] text-white min-h-[150px] flex flex-col items-center justify-center gap-1.5 p-4">
          <span className="text-[14px] font-bold">הפסקת מחצית · השידור ממשיך</span>
          <span className="text-[12.5px] opacity-80">חוזרים בעוד</span>
          <span dir="ltr" className="fl-num text-[40px] text-fl-accent">{clockString(remaining)}</span>
        </section>
      )}
    </div>
  )
}

function EventMark({ kind }) {
  if (kind === "goal") return <GoalIcon className="size-[26px]" aria-label="שער" />
  if (kind === "timeout") return <Timeout className="size-6" aria-label="פסק זמן" />
  const c = { blue: "bg-fl-blue", yellow: "bg-fl-yellow", red: "bg-fl-red" }[kind]
  const n = { blue: "כרטיס כחול", yellow: "כרטיס צהוב", red: "כרטיס אדום" }[kind]
  return <span role="img" aria-label={n} className={`w-[13px] h-[18px] rounded-[3px] ${c}`} />
}

const SUB = { blue: "2 דק׳ בחוץ", red: "הרחקה", yellow: "אזהרה" }

/**
 * "מהלך המשחק": the two-sided timeline (home rows RIGHT, away LEFT, minute in the
 * middle), newest first, half dividers with the score. Fouls are left out (counted in
 * the band). `events` = the judge board's play-by-play.
 */
export function GameTimeline({ events, periodMS, home, away, over = false }) {
  const tl = buildTimeline(events, periodMS || GameRules.defaultPeriodMS).filter(e => e.kind !== "foul")
  if (!tl.length && over) return null
  const rows = timelineRows(tl)
  return (
    <section aria-label="מהלך המשחק" className="fl-card px-3 pt-3.5 pb-2">
      <div className="flex items-baseline justify-between px-1.5 pb-2">
        <h2 className="text-[22px] font-extrabold text-fg-strong">מהלך המשחק</h2>
        {!over && <span className="text-[12px] text-fg-muted">מתעדכן מלוח השופט</span>}
      </div>
      {!rows.length ? (
        <p className="text-center text-[13.5px] text-fg-muted py-4">אין עדיין אירועים</p>
      ) : (
        <div className="relative">
          <span aria-hidden="true" className="absolute top-1 bottom-1 left-1/2 -ml-px w-0.5 bg-line" />
          <ul>
            {rows.map(r => r.divider ? (
              <li key={r.id} className="relative flex justify-center py-2">
                <span className="text-[12px] font-extrabold px-3 py-1 rounded-[10px] bg-fg-strong text-surface flex gap-1"
                  aria-label={`סוף ${r.divider}: בית ${r.h}, חוץ ${r.a}`}>
                  <span>{r.divider}</span><span aria-hidden="true">·</span>
                  <span dir="ltr" className="flex gap-0.5"><span>{r.a}</span><span>:</span><span>{r.h}</span></span>
                </span>
              </li>
            ) : (
              <TimelineRow key={r.id} e={r} home={home} away={away} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function TimelineRow({ e, home, away }) {
  const teamName = e.home ? home?.name : away?.name
  const who = e.kind === "goal" ? (e.ownGoal ? "שער עצמי" : e.player || "שער")
    : e.kind === "timeout" ? "פסק זמן" : e.player || ({ blue: "כרטיס כחול", yellow: "כרטיס צהוב", red: "כרטיס אדום" }[e.kind])
  const sub = e.kind === "goal" ? null : e.kind === "timeout" ? teamName : SUB[e.kind]
  const detail = (
    <span dir="rtl" className={`flex items-center gap-2 min-w-0 ${e.home ? "" : "flex-row-reverse text-left"}`}>
      <span className="size-7 shrink-0 flex items-center justify-center"><EventMark kind={e.kind} /></span>
      <span className={`flex flex-col min-w-0 ${e.home ? "items-start" : "items-end"}`}>
        <span className="text-[13.5px] font-bold text-fg-strong truncate max-w-full">{who}</span>
        {e.kind === "goal" && e.scoreAfter ? (
          <span dir="ltr" className="text-[11.5px] text-fg-muted flex gap-0.5"><span>{e.scoreAfter[1]}</span><span>:</span><span>{e.scoreAfter[0]}</span></span>
        ) : sub ? <span className="text-[11.5px] text-fg-muted truncate max-w-full">{sub}</span> : null}
      </span>
    </span>
  )
  return (
    <li dir="ltr" className="relative grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] items-center min-h-12"
      aria-label={[who, teamName, e.minute ? `דקה ${e.minute}` : null].filter(Boolean).join(", ")}>
      <span className="min-w-0 flex justify-start ps-1">{!e.home && detail}</span>
      <span dir="ltr" className="fl-num text-[14px] text-fg-muted text-center bg-surface py-0.5 relative">{minuteMark(e.minute)}</span>
      <span className="min-w-0 flex justify-end pe-1">{e.home && detail}</span>
    </li>
  )
}
