import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { GameForm, CalendarClock, PersonAdd, Verified, Gavel, Medical } from "@/components/icons/BrandIcons"
import { CrestDisc, RinkDrawing } from "@/components/fl/Floodlight"
import { teamBlend } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"
import { useAuth } from "@/lib/AuthContext"
import { getMySignRoles, getGameSignatures } from "@/lib/gameFormData"
import { getGameAvailability, getAvailabilityForOfficialBatch, nudgeNonResponders } from "@/lib/availability"
import { getPendingTeamJoins } from "@/lib/teamMembership"
import { getPendingGameChangeRequests, getOpponentGameChangeRequests } from "@/lib/gameRequests"
import { getPendingClaims } from "@/lib/claims"
import { getPendingCoachRequests } from "@/lib/coachRequests"
import { getPendingOfficialRoleRequests } from "@/lib/roleRequests"
import { getPendingManagerMedical } from "@/lib/medical"
import { dayMonth } from "@/lib/feedGamePost"
import { feedDemoOn, demoSignGame } from "@/components/feed/feedHarnessDemo"

/**
 * The role action cards (FeedCoach / FeedLM / FeedRef / FeedPlayerRef boards; iOS HomeView
 * roleCards). Ariel 10-27: guest, fan and player feeds are CLEAN; coach, league manager and
 * referee keep their cards, most urgent first ("מחכה לך"). A player who also referees gets
 * the referee cards only. Every card is built from a read the site already makes; a card
 * with no data is left out (no fake numbers), and a failed read hides it.
 */

const TZ = "Asia/Jerusalem"
const time = (d) => new Date(d).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: TZ })
const weekday = (d) => new Date(d).toLocaleDateString("he-IL", { weekday: "long", timeZone: TZ }).replace(/^יום /, "")
const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ })
const whenLabel = (g) => (g.status === "postponed" ? "נדחה" : `${weekday(g.game_date)} ${dayMonth(g.game_date)} · ${time(g.game_date)}`)
const alive = (g) => !g.is_test

/** The next game among `games` (not played, kick-off within the last 3 h or later). */
function nextOf(games, now = Date.now()) {
  return games
    .filter(g => alive(g) && g.status !== "completed" && new Date(g.game_date).getTime() > now - 3 * 3600e3)
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))[0] || null
}

/** Today's games, else the next day with games (Israel time). */
export function nextGameDay(games, now = Date.now()) {
  const today = day(now)
  const up = games.filter(g => alive(g) && (g.status === "live" || (day(g.game_date) >= today && g.status !== "completed")))
  if (!up.length) return []
  const first = up.map(g => day(g.game_date)).sort()[0]
  return up.filter(g => day(g.game_date) === first).sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
}

/** The most recent completed game (last 10 days) with a slot this viewer signs still empty. */
async function findPendingSignature(games, { teamIds, anyGame }) {
  const now = Date.now()
  const cands = games
    .filter(g => g.status === "completed" && new Date(g.game_date).getTime() <= now && new Date(g.game_date).getTime() > now - 10 * 864e5)
    .filter(g => anyGame || teamIds.has(g.home_team_id) || teamIds.has(g.away_team_id))
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    .slice(0, 5)
  for (const g of cands) {
    const roles = await getMySignRoles(g.id)
    if (!roles.length) continue
    const sigs = await getGameSignatures(g.id)
    if (sigs && roles.some(r => !sigs[r])) return g
  }
  return null
}

/** What the cards need, read once per viewer. Each read fails quietly to "no card". */
function useRoleData({ games, isRef, isCoach, isLM, coachTeamIds, playerTeamId }) {
  const [d, setD] = useState({})
  const key = `${isRef}|${isCoach}|${isLM}|${coachTeamIds.join(",")}|${games.length}`
  useEffect(() => {
    if (!games.length || !(isRef || isCoach || isLM)) return
    let on = true
    const put = (patch) => on && setD(prev => ({ ...prev, ...patch }))
    const quiet = (p) => Promise.resolve().then(() => p).catch(() => null)
    if (isRef || isCoach) {
      const teamIds = new Set([...coachTeamIds, playerTeamId].filter(Boolean))
      quiet(findPendingSignature(games, { teamIds, anyGame: isRef })).then(g => put({ signGame: g || (feedDemoOn() ? demoSignGame(games) : null) }))
    }
    if (isCoach) {
      quiet(getPendingTeamJoins()).then(rows => put({ joins: (rows || []).filter(r => coachTeamIds.includes(r.team_id || r.teams?.id)) }))
      quiet(getOpponentGameChangeRequests(coachTeamIds)).then(rows => put({ changes: rows || [] }))
    }
    if (isLM) {
      Promise.all([
        quiet(getPendingGameChangeRequests()), quiet(getPendingClaims()), quiet(getPendingTeamJoins()),
        quiet(getPendingCoachRequests()), quiet(getPendingOfficialRoleRequests()), quiet(getPendingManagerMedical()),
      ]).then(([gc, cl, tj, co, ro, me]) => put({ queues: { gc, cl, tj, co, ro, me } }))
    }
    return () => { on = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return d
}

export default function FeedRoleCards({ games = [], teamsMap = {}, players = [], liveGames = [], judgeIds = null }) {
  const { user, isAdmin, isJudgeRole, isLeagueManager, coachTeamIds = [], profile } = useAuth()
  const isRef = !!user && !!isJudgeRole
  const isCoach = !!user && coachTeamIds.length > 0
  const isLM = !!user && (isLeagueManager || isAdmin)
  const playerTeamId = profile?.player?.team_id || null
  const d = { ...useRoleData({ games, isRef, isCoach, isLM, coachTeamIds, playerTeamId }), judgeIds }
  const gamesById = useMemo(() => Object.fromEntries(games.map(g => [g.id, g])), [games])
  if (!isRef && !isCoach && !isLM) return null

  const judgeNext = isRef && d.judgeIds ? nextOf(games.filter(g => d.judgeIds.has(g.id))) : null
  const coachNext = isCoach ? nextOf(games.filter(g => coachTeamIds.includes(g.home_team_id) || coachTeamIds.includes(g.away_team_id))) : null
  const liveIds = new Set(liveGames.filter(l => l.phase !== "over").map(l => l.game_id))

  // "מחכה לך" (coach): the most urgent first — a form to sign, then requests to answer.
  const tasks = []
  if (isCoach && !isRef && d.signGame) tasks.push(signTask(d.signGame, teamsMap))
  if (isCoach) for (const c of d.changes || []) {
    const g = gamesById[c.game_id] || c.games
    tasks.push({ key: `gc-${c.id}`, kind: "שינוי מועד", Icon: CalendarClock, tone: "bg-[#F6EBD3]",
      title: g ? `בקשת שינוי מועד: ${teamsMap[g.home_team_id]?.name || ""} – ${teamsMap[g.away_team_id]?.name || ""}` : "בקשת שינוי מועד ממתינה לתשובה",
      cta: "לתשובה", to: g ? entityPath("games", g) : "/games" })
  }
  if (isCoach) for (const j of d.joins || []) {
    const p = j.players
    tasks.push({ key: `tj-${j.id}`, kind: "שיוך לקבוצה", Icon: PersonAdd, tone: "bg-[#DDE9DF]",
      title: `${p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() : j.profiles?.display_name || "שחקן"} ביקש להצטרף ל${j.teams?.name || teamsMap[j.team_id]?.name || "קבוצה"}`,
      cta: "לבדיקה", to: "/admin?tab=claims" })
  }

  return (
    <div className="space-y-3 pb-1">
      {isRef && judgeNext && <RefereeNextGameCard game={judgeNext} teamsMap={teamsMap} players={players} />}
      {isRef && d.signGame && <SignFormCard task={signTask(d.signGame, teamsMap)} />}
      {isRef && d.judgeIds && d.judgeIds.size > 0 && <RefereeSeasonTiles games={games.filter(g => d.judgeIds.has(g.id))} />}

      {tasks.length > 0 && <TasksRow tasks={tasks} />}
      {isCoach && coachNext && <CoachWeekendCard game={coachNext} teamsMap={teamsMap} players={players}
        teamId={coachTeamIds.find(t => t === coachNext.home_team_id || t === coachNext.away_team_id)} />}

      {isLM && d.queues && <LeagueQueues q={d.queues} />}
      {isLM && <LeagueGameDayCard games={nextGameDay(games)} teamsMap={teamsMap} liveIds={liveIds} />}
    </div>
  )
}

function signTask(g, teamsMap) {
  return { key: `sign-${g.id}`, kind: "טופס שיפוט", Icon: GameForm, tone: "bg-[rgb(var(--fl-red)/.14)]",
    title: "טופס שיפוט מחכה לחתימה",
    sub: `${teamsMap[g.home_team_id]?.name || ""} – ${teamsMap[g.away_team_id]?.name || ""} · ${dayMonth(g.game_date)}`,
    cta: "חתימה", to: entityPath("games", g) }
}

/* ---------- shared pieces ---------- */

function DarkCard({ background, children, label }) {
  return (
    <section aria-label={label} className="relative isolate overflow-hidden rounded-[22px] p-[18px] text-white" style={{ background }}>
      <RinkDrawing strength={0.12} className="pointer-events-none absolute inset-x-2.5 top-1/2 -translate-y-1/2 -z-10 w-[calc(100%-20px)] opacity-40" />
      {children}
    </section>
  )
}

function Side({ team, size = 58 }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <CrestDisc team={team} size={size} />
      <span className="max-w-full truncate text-[13px] font-bold">{team?.name}</span>
    </span>
  )
}

function SectionHead({ title, count, note }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-1 pb-2.5">
      <h2 className="text-[22px] font-extrabold text-fg-strong">{title} {count != null && <span className="fl-num text-[20px] text-fg-muted">{count}</span>}</h2>
      {note && <span className="text-[12px] text-fg-muted">{note}</span>}
    </div>
  )
}

/** Attendance of one team for a game: { coming, notComing, unanswered } from availability rows. */
function countsFor(rows, teamId, players) {
  const roster = new Set(players.filter(p => p.team_id === teamId).map(p => p.id))
  const answered = new Set()
  const c = { coming: 0, notComing: 0, unanswered: 0 }
  for (const r of rows) {
    if (!(r.team_id === teamId || roster.has(r.player_id))) continue
    if (r.needs_reconfirm) continue
    answered.add(r.player_id)
    if (r.status === "available") c.coming++
    else if (r.status === "unavailable") c.notComing++
  }
  c.unanswered = [...roster].filter(id => !answered.has(id)).length
  return c
}

/* ---------- referee ---------- */

function RefereeNextGameCard({ game, teamsMap, players }) {
  const home = teamsMap[game.home_team_id], away = teamsMap[game.away_team_id]
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    getAvailabilityForOfficialBatch([game.id]).then(r => { if (on && r?.length) setRows(r) }).catch(() => {})
    return () => { on = false }
  }, [game.id])
  return (
    <DarkCard background="#0E151F" label="המשחק הבא שלך לשפוט">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-fl-accent">המשחק הבא שלך לשפוט</span>
        <span className="text-[13px] opacity-80 truncate">{whenLabel(game)}</span>
      </div>
      <Link to={entityPath("games", game)} dir="rtl" className="mt-3.5 flex items-center gap-2">
        <Side team={home} /><span className="text-[18px] font-extrabold opacity-80">נגד</span><Side team={away} />
      </Link>
      {rows && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[["הרכב בית", home], ["הרכב חוץ", away]].map(([t, team]) => (
            <div key={t} className="rounded-xl bg-white/[.08] p-2.5">
              <p className="text-[11px] opacity-70 truncate">{t} · {team?.name}</p>
              <p className="text-[14px] font-bold"><span className="fl-num text-[16px]">{countsFor(rows, team?.id, players).coming}</span> אישרו הגעה</p>
            </div>
          ))}
        </div>
      )}
      <Link to={`/judge/${game.id}`} className="mt-3 flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] bg-fl-accent text-[15px] font-extrabold text-[#11161D]">
        <GameForm className="h-6 w-6" /> פתח לוח שיפוט
      </Link>
    </DarkCard>
  )
}

function SignFormCard({ task: { title, sub, cta, to, Icon } }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgb(var(--fl-red)/.14)]"><Icon className="h-8 w-8" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-fg-strong">{title}</span>
        {sub && <span className="block truncate text-[12px] text-fg-muted">{sub}</span>}
      </span>
      <Link to={to} className="flex min-h-[44px] shrink-0 items-center rounded-xl bg-brand px-4 text-[13px] font-bold text-brand-fg">{cta}</Link>
    </div>
  )
}

function RefereeSeasonTiles({ games }) {
  const now = Date.now()
  const judged = games.filter(g => g.status === "completed").length
  const ahead = games.filter(g => g.status !== "completed" && new Date(g.game_date).getTime() > now).length
  return (
    <div className="grid grid-cols-2 gap-2">
      {[[judged, "משחקים ששפטת"], [ahead, "משובצים קדימה"]].map(([n, l]) => (
        <div key={l} className="rounded-2xl bg-surface p-3">
          <p className="fl-num text-[32px] text-fg-strong">{n}</p>
          <p className="mt-1.5 text-[12px] text-fg-muted">{l}</p>
        </div>
      ))}
    </div>
  )
}

/* ---------- coach ---------- */

function TasksRow({ tasks }) {
  return (
    <section aria-label="מחכה לך">
      <SectionHead title="מחכה לך" count={tasks.length} note="נעלם כשהכל מטופל" />
      <ul className="-mx-4 flex gap-2 overflow-x-auto overscroll-x-contain px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tasks.map(({ key, kind, Icon, tone, title, sub, cta, to }) => (
          <li key={key} className="flex w-[228px] shrink-0 flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-3.5">
            <span className="flex items-center gap-2">
              <span className={`flex size-[38px] items-center justify-center rounded-[11px] ${tone}`}><Icon className="h-7 w-7" /></span>
              <span className="text-[12px] font-semibold text-fg-muted">{kind}</span>
            </span>
            <span className="min-h-[40px] text-[15px] font-bold leading-[1.3] text-fg-strong line-clamp-2">{title}</span>
            {sub && <span className="-mt-1.5 truncate text-[12px] text-fg-muted">{sub}</span>}
            <Link to={to} className="mt-auto flex h-11 items-center justify-center rounded-xl bg-brand text-[14px] font-semibold text-brand-fg">{cta}</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CoachWeekendCard({ game, teamId, teamsMap, players }) {
  const home = teamsMap[game.home_team_id], away = teamsMap[game.away_team_id]
  const [counts, setCounts] = useState(null)
  const [nudge, setNudge] = useState({ busy: false, msg: null })
  useEffect(() => {
    let on = true
    getGameAvailability(game.id).then(rows => { if (on && rows?.length) setCounts(countsFor(rows, teamId, players)) }).catch(() => {})
    return () => { on = false }
  }, [game.id, teamId, players])
  const send = async () => {
    setNudge({ busy: true, msg: null })
    try {
      const n = await nudgeNonResponders(game.id, teamId)
      setNudge({ busy: false, msg: n > 0 ? `נשלחה תזכורת ל־${n}` : "כולם כבר קיבלו תזכורת היום" })
    } catch { setNudge({ busy: false, msg: "התזכורת לא נשלחה" }) }
  }
  const total = counts ? Math.max(1, counts.coming + counts.notComing + counts.unanswered) : 1
  return (
    <DarkCard background={teamBlend(home, away, { angle: 115 })} label="השבת של הקבוצה">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-fl-accent">השבת של הקבוצה</span>
        <span className="truncate text-[13px] opacity-85">{whenLabel(game)}{game.venue ? ` · ${game.venue}` : ""}</span>
      </div>
      <Link to={entityPath("games", game)} dir="rtl" aria-label={`${home?.name} נגד ${away?.name}`} className="mt-3.5 flex items-center justify-center gap-[18px]">
        <CrestDisc team={home} size={56} /><span className="text-[18px] font-extrabold opacity-80">נגד</span><CrestDisc team={away} size={56} />
      </Link>
      <div className="mt-4 rounded-2xl bg-[rgba(8,12,18,.5)] p-3.5">
        {counts && (
          <>
            <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full" aria-hidden="true">
              <span className="bg-fl-accent" style={{ flex: counts.coming / total }} />
              <span className="bg-[#8A93A0]" style={{ flex: counts.notComing / total }} />
              <span className="bg-white/20" style={{ flex: counts.unanswered / total }} />
            </div>
            <div className="mt-3 grid grid-cols-3">
              {[[counts.coming, "מגיעים"], [counts.notComing, "לא מגיעים"], [counts.unanswered, "לא ענו"]].map(([n, l]) => (
                <div key={l}><p className="fl-num text-[28px]">{n}</p><p className="text-[12px] opacity-80">{l}</p></div>
              ))}
            </div>
          </>
        )}
        <div className={`flex gap-2 ${counts ? "mt-3.5" : ""}`}>
          {counts?.unanswered > 0 && (
            <button type="button" onClick={send} disabled={nudge.busy || !!nudge.msg}
              className="h-11 flex-1 rounded-xl bg-fl-accent text-[14px] font-bold text-[#11161D] disabled:opacity-80">
              {nudge.msg || "תזכורת למי שלא ענה"}
            </button>
          )}
          <Link to={`${entityPath("games", game)}#availability`}
            className={`flex h-11 items-center justify-center rounded-xl border border-white/35 px-3.5 text-[14px] font-medium ${counts?.unanswered > 0 ? "" : "flex-1"}`}>הרכב</Link>
        </div>
      </div>
    </DarkCard>
  )
}

/* ---------- league manager ---------- */

function LeagueQueues({ q }) {
  const items = [
    { n: q.gc?.length, label: "בקשות שינוי מועד", Icon: CalendarClock, bg: "bg-[#F6EBD3]", to: "/admin?tab=game_requests" },
    { n: q.cl?.length, label: "בקשות בעלות על כרטיס", Icon: Verified, bg: "bg-[#E4ECFB]", to: "/admin?tab=claims" },
    { n: q.tj?.length, label: "שיוך שחקנים לקבוצות", Icon: PersonAdd, bg: "bg-[#DDE9DF]", to: "/admin?tab=claims" },
    { n: q.co?.length, label: "בקשות מאמנים", Icon: PersonAdd, bg: "bg-[#DDE9DF]", to: "/admin?tab=coaches" },
    { n: q.ro?.length, label: "בקשות שיפוט ומזכירות", Icon: Gavel, bg: "bg-[#F3E3E3]", to: "/admin?tab=officials" },
    { n: q.me?.length, label: "אישורים רפואיים", Icon: Medical, bg: "bg-[#F3E3E3]", to: "/admin?tab=medical" },
  ].filter(i => i.n > 0)
  if (!items.length) return null
  return (
    <section aria-label="מחכה לאישור שלך">
      <SectionHead title="מחכה לאישור שלך" count={items.reduce((s, i) => s + i.n, 0)} note="נעלם כשהכל מטופל" />
      <ul className="grid grid-cols-2 gap-2">
        {items.map(({ n, label, Icon, bg, to }) => (
          <li key={label}>
            <Link to={to} className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-line bg-surface p-3">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${bg}`}><Icon className="h-7 w-7" /></span>
              <span className="min-w-0">
                <span className="block fl-num text-[22px] text-fg-strong">{n}</span>
                <span className="block text-[12px] leading-tight text-fg-muted line-clamp-2">{label}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LeagueGameDayCard({ games, teamsMap, liveIds }) {
  if (!games.length) return null
  const first = games[0]
  const venues = [...new Set(games.map(g => g.venue).filter(Boolean))].sort()
  const n = games.length === 1 ? "משחק אחד" : `${games.length} משחקים`
  return (
    <DarkCard background="#0E151F" label="יום המשחקים הבא">
      <div className="mb-3 flex items-end gap-2.5">
        <span className="fl-num text-[40px]">{dayMonth(first.game_date)}</span>
        <span className="min-w-0 pb-0.5">
          <span className="block text-[14px] font-bold">יום משחקים · {weekday(first.game_date)}</span>
          <span className="block truncate text-[12px] opacity-70">{[venues.join(" + "), n].filter(Boolean).join(" · ")}</span>
        </span>
      </div>
      <ul className="space-y-1.5">
        {games.map(g => {
          const home = teamsMap[g.home_team_id], away = teamsMap[g.away_team_id]
          return (
            <li key={g.id}>
              <Link to={entityPath("games", g)} dir="rtl" className="flex min-h-[58px] items-center gap-2 rounded-[14px] bg-[#1B2532] px-2.5">
                <span className="fl-num w-[52px] shrink-0 text-[16px]">{g.status === "postponed" ? "נדחה" : time(g.game_date)}</span>
                <CrestDisc team={home} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{home?.name} – {away?.name}</span>
                <CrestDisc team={away} size={28} />
                {(liveIds.has(g.id) || g.status === "live") && <span className="rounded-md bg-fl-live px-2 py-0.5 text-[11px] font-extrabold">LIVE</span>}
              </Link>
            </li>
          )
        })}
      </ul>
    </DarkCard>
  )
}
