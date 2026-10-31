import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getGames, getTeams, getPlayers } from "@/lib/api"
import { getAvailabilityForOfficialBatch } from "@/lib/availability"
import { getMyApprovedGameIds } from "@/lib/officials"
import { useAuth } from "@/lib/AuthContext"
import { RefreshCw, ChevronLeft } from "lucide-react"
import { Warning as AlertTriangle, Calendar, MapPin, Squad, Gavel } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { CrestDisc, TeamBlend, FLChip } from "@/components/fl/Floodlight"
import JudgeGate from "@/components/judge/JudgeGate"
import { JudgeSkeleton } from "@/components/skeletons/PageSkeletons"
import { ilDate } from "@/lib/ilTime"

const OFFICIABLE = ["scheduled", "in_progress", "waiting_result"]
const statusCfg = {
  scheduled: { label: "מתוכנן", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  in_progress: { label: "משחק חי", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  waiting_result: { label: "ממתין לתוצאה", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
}

function JudgePicker() {
  const { isAdmin } = useAuth()
  const [games, setGames] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [availByGame, setAvailByGame] = useState({})
  // Games this judge was APPROVED for. Previously every judge saw every fixture.
  const [myGameIds, setMyGameIds] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [g, t, p, mine] = await Promise.all([
        getGames(), getTeams(), getPlayers(), getMyApprovedGameIds('judge'),
      ])
      setGames(g); setTeams(t); setPlayers(p); setMyGameIds(mine)
      const upcomingIds = g.filter(x => OFFICIABLE.includes(x.status)).map(x => x.id)
      const rows = await getAvailabilityForOfficialBatch(upcomingIds)
      const map = {}
      rows.forEach(r => { (map[r.game_id] ||= {})[r.player_id] = { status: r.status, side: r.team_id } })
      setAvailByGame(map)
    } catch (e) { console.error(e); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  if (loading) return <JudgeSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <AlertTriangle className="w-10 h-10" />
          <span className="text-fg-strong text-base font-bold">{error}</span>
          <button onClick={loadData} className="btn-primary min-h-[44px] inline-flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  // A judge sees only the games he was approved for; an admin still sees everything.
  // myGameIds === null means the assignments are still loading — show nothing rather
  // than briefly flashing the full fixture list.
  const officiable = games
    .filter(g => OFFICIABLE.includes(g.status))
    .filter(g => isAdmin || (myGameIds ? myGameIds.has(g.id) : false))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))

  // C3: attendance readiness per team, for the referee's upcoming games.
  const teamAtt = (game, tid) => {
    const avail = availByGame[game.id] || {}
    // A player counts for the side he was MANUALLY added for (a loan / youth call-up —
    // availability.team_id), else for his own team. By players.team_id alone a בלג נוער
    // junior added to בלג אריות was counted for the wrong side (7/5 instead of 6/6).
    const sideOf = p => avail[p.id]?.side || p.team_id
    const coming = players.filter(p => sideOf(p) === tid && avail[p.id]?.status === "available")
    return { count: coming.length, gk: coming.some(p => p.position === "Goalkeeper"), tooFew: coming.length < 4 }
  }

  // Board JudgeGames: games grouped by game day (big date, day name, venues), the next
  // game as a team-colour hero, the rest as rows.
  const days = []
  for (const g of officiable) {
    const key = format(ilDate(g.game_date), "yyyy-MM-dd")
    let d = days.find(x => x.key === key)
    if (!d) { d = { key, date: ilDate(g.game_date), games: [] }; days.push(d) }
    d.games.push(g)
  }
  const nextId = officiable[0]?.id

  return (
    <div className="px-4 py-5 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-none text-fg-strong">שיפוט משחק</h1>
        <p className="text-[14px] text-fg-muted mt-2">יופיעו כאן רק משחקים שאושרת לשפוט בהם{isAdmin ? " · מנהל רואה את כל המשחקים" : ""}</p>
      </header>

      {officiable.length === 0 ? (
        <div className="card p-10 text-center">
          <Calendar className="w-10 h-10 mx-auto mb-2 opacity-60" />
          <p className="text-[15px] font-bold text-fg-strong">אין משחקים זמינים לשיפוט</p>
          <p className="text-[13px] text-fg-muted mt-1">משחקים שאושרת לשפוט בהם יופיעו כאן</p>
        </div>
      ) : days.map(day => {
        const venues = [...new Set(day.games.map(g => g.venue).filter(Boolean))]
        return (
          <section key={day.key} className="space-y-3" aria-label={format(day.date, "d.M")}>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-extrabold text-fg-strong">{dayName(day.date)}</div>
                {venues.length > 0 && <div className="text-[13px] text-fg-muted truncate">{venues.join(" + ")}</div>}
              </div>
              <span dir="ltr" className="fl-num text-[34px] leading-none text-fg-strong shrink-0">{format(day.date, "d.M")}</span>
            </div>
            {day.games.map(game => {
              const home = teamsMap[game.home_team_id]
              const away = teamsMap[game.away_team_id]
              const st = statusCfg[game.status] || statusCfg.scheduled
              const time = format(ilDate(game.game_date), "HH:mm")
              const homeAtt = game.status === "scheduled" ? teamAtt(game, game.home_team_id) : null
              const awayAtt = game.status === "scheduled" ? teamAtt(game, game.away_team_id) : null
              if (game.id === nextId) {
                return (
                  <TeamBlend key={game.id} as={Link} to={`/judge/${game.id}`} home={home} away={away}
                    className="block rounded-card p-4 sm:p-5 fl-fade-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-accent">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <FLChip tone="glass">הבא שלך · {st.label}</FLChip>
                        {game.game_type && game.game_type !== 'ליגה' && <FLChip tone="glass">{game.game_type}</FLChip>}
                      </span>
                      <span dir="ltr" className="fl-num text-[30px] leading-none">{time}</span>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 mt-4">
                      <HeroSide team={home} att={homeAtt} />
                      <span className="text-[15px] font-bold text-white/70">נגד</span>
                      <HeroSide team={away} att={awayAtt} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                      <span className="flex items-center gap-1.5 text-[13px] text-white/80 min-w-0"><MapPin className="w-4 h-4" /><span className="truncate">{game.venue || '—'}</span></span>
                      <span className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-control bg-[#FAF9F6] text-[#11161D] text-[15px] font-extrabold">
                        <Gavel className="w-5 h-5" /> פתח לוח שיפוט
                      </span>
                    </div>
                  </TeamBlend>
                )
              }
              return (
                <Link key={game.id} to={`/judge/${game.id}`} className="card-hover flex items-center gap-3 p-3.5 sm:p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-fl-accent">
                  <span className="flex flex-col items-start gap-1.5 shrink-0 w-[3.9rem] sm:w-[4.4rem]">
                    <span dir="ltr" className="fl-num text-[20px] sm:text-[22px] leading-none text-fg-strong">{time}</span>
                    <span className={`stat-pill !px-1.5 ${st.cls}`}>{st.label}</span>
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <RowSide team={home} att={homeAtt} />
                    <RowSide team={away} att={awayAtt} />
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {game.game_type && game.game_type !== 'ליגה' && <span className="stat-pill bg-surface-sunken text-fg-muted">{game.game_type}</span>}
                    <span className="inline-flex items-center justify-center gap-0.5 min-h-[32px] min-w-[32px] px-2 sm:px-3 rounded-full bg-brand text-brand-fg text-[12px] font-extrabold"><span className="hidden sm:inline">לוח שיפוט</span> <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /></span>
                  </div>
                </Link>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

const DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
function dayName(d) {
  const today = ilDate(new Date())
  const key = (x) => format(x, "yyyy-MM-dd")
  const tomorrow = new Date(today.getTime() + 86400000)
  const prefix = key(d) === key(today) ? "היום · " : key(d) === key(tomorrow) ? "מחר · " : "יום "
  return `${prefix}${DAYS_HE[d.getDay()]}`
}

/** Attendance readiness: how many said "מגיע", amber under 4, a warning when no goalkeeper. */
function AttChip({ att, onBlend = false, compact = false }) {
  if (!att) return null
  const cls = onBlend
    ? (att.tooFew ? "bg-amber-300/90 text-[#3A2A00]" : "bg-white/15 text-white")
    : (att.tooFew ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300")
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}
      aria-label={`מגיעים ${att.count}${att.gk ? "" : ", אין שוער"}`}>
      <Squad className="w-4 h-4" /> {!compact && "מגיעים "}<span className="fl-num">{att.count}</span>{!att.gk && <AlertTriangle className="w-4 h-4" />}
    </span>
  )
}

function HeroSide({ team, att }) {
  return (
    <div className="flex flex-col items-center gap-1.5 min-w-0 text-center">
      <CrestDisc team={team} size={56} />
      <span className="text-[15px] font-extrabold leading-tight line-clamp-2">{team?.name || '—'}</span>
      <AttChip att={att} onBlend />
    </div>
  )
}

function RowSide({ team, att }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <CrestDisc team={team} size={28} />
      <span className="text-[14px] font-bold text-fg-strong truncate min-w-0 flex-1">{team?.name || '—'}</span>
      <AttChip att={att} compact />
    </div>
  )
}

export default function Judge() {
  return <JudgeGate skeleton={<JudgeSkeleton />}><JudgePicker /></JudgeGate>
}
