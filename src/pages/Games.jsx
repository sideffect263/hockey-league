import { useState, useEffect, useMemo } from "react"
import { GoalIcon as Ball, BlueCard, RedCard, Calendar, Referee, Squad, Warning as AlertTriangle, ApprovedStatus as CheckCircle2, Rejected as XCircle, CalendarPlus } from "@/components/icons/BrandIcons"
import { getGames, getTeams, getPlayers, getReferees, getGameStats } from "@/lib/api"
import { X, RefreshCw, Utensils, ChevronDown } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { getAvailabilityForGames } from "@/lib/availability"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { DEFAULT_AGE, ageGroupsOf } from "@/lib/ageGroups"
import LiveGameBanner from "@/components/LiveGameBanner"
import { useLiveGames } from "@/lib/useLiveGames"
import { useSeasonName } from "@/App"
import GamesCalendar, { CalendarSheet } from "@/components/games/GamesCalendar"
import { RinkDrawing } from "@/components/fl/Floodlight"
import FixtureRow, { DayHeader } from "@/components/fl/games/FixtureRow"
import { GamesSkeletonFL } from "@/components/fl/games/GamesSkeletons"
import { useIsDesktop } from "@/components/fl/games/useIsDesktop"
import { dayKey, daysUntil, roundsOf, weekday, dayMonth } from "@/components/fl/games/flGamesKit"

const VIEW_KEY = "games-view"
const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const writePref = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** Games grouped by Israel day: [{ key, date, games }] (inside a day, by kick-off). */
function groupByDay(games, newestFirst = false) {
  const map = new Map()
  for (const g of games) {
    const k = dayKey(g.game_date)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(g)
  }
  const keys = [...map.keys()].sort((a, b) => (newestFirst ? (a < b ? 1 : -1) : (a < b ? -1 : 1)))
  return keys.map(k => {
    const list = map.get(k).sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
    return { key: k, date: list[0].game_date, games: list }
  })
}

const pill = (on) => `inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full text-[14px] whitespace-nowrap transition-colors ${on
  ? "bg-fg-strong text-surface font-semibold" : "border border-line text-fg-strong font-medium hover:bg-surface-sunken"}`

export default function Games() {
  const { coachTeamIds, profile } = useAuth()
  const myPlayerId = profile?.player_id || null
  const seasonName = useSeasonName()
  const isDesktop = useIsDesktop()
  const [games, setGames] = useState([])
  const [availByGame, setAvailByGame] = useState({})
  // The signed-in player's own answer per upcoming game → "מגיע/ה" tag on the row.
  const [myAvail, setMyAvail] = useState({})
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [referees, setReferees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeCompetition, setActiveCompetition] = useState("ליגה")
  const ageTab = DEFAULT_AGE // this page is senior-only; youth games live on the tournament pages
  const [statusFilter, setStatusFilter] = useState("all")
  const [teamFilter, setTeamFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("")
  const [view, setView] = useState(() => readPref(VIEW_KEY, "list"))   // list | month
  const [mode, setMode] = useState(null)                               // upcoming | results (null = auto)
  const [sheetOpen, setSheetOpen] = useState(false)
  // game_stats grouped by game id — every finished row shows its scorers/cards inline.
  const [statsByGame, setStatsByGame] = useState({})

  useEffect(() => { loadData() }, [])
  const pickView = (v) => { setView(v); writePref(VIEW_KEY, v) }

  // Coach-only: fetch attendance for the coach's own upcoming games → per-row chip.
  useEffect(() => {
    const cids = coachTeamIds || []
    const myGames = cids.length ? games.filter(g => g.status === "scheduled" && (cids.includes(g.home_team_id) || cids.includes(g.away_team_id))) : []
    if (!myGames.length) { setAvailByGame({}); return }
    let alive = true
    getAvailabilityForGames(myGames.map(g => g.id)).then(rows => {
      if (!alive) return
      const map = {}
      rows.forEach(r => { (map[r.game_id] ||= []).push(r) })
      setAvailByGame(map)
    }).catch(() => {})
    return () => { alive = false }
  }, [games, (coachTeamIds || []).join(",")])

  // Player: my own answer for every upcoming game (RLS returns my rows; a coach also
  // gets their team's, hence the player_id filter).
  useEffect(() => {
    const ids = myPlayerId ? games.filter(g => g.status === "scheduled").map(g => g.id) : []
    if (!ids.length) { setMyAvail({}); return }
    let alive = true
    getAvailabilityForGames(ids).then(rows => {
      if (!alive) return
      setMyAvail(Object.fromEntries(rows.filter(r => r.player_id === myPlayerId).map(r => [r.game_id, r.status])))
    }).catch(() => {})
    return () => { alive = false }
  }, [games, myPlayerId])

  // Games being officiated right now — realtime, pinned above the schedule.
  const liveGames = useLiveGames()

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [g, t, p, r] = await Promise.all([getGames(), getTeams(), getPlayers(), getReferees()])
      setGames(g); setTeams(t); setPlayers(p); setReferees(r)
      // Box scores are secondary — load them after the schedule renders, never block on them.
      getGameStats().then(rows => {
        const map = {}
        rows.forEach(s => { (map[s.game_id] ||= []).push(s) })
        setStatsByGame(map)
      }).catch(err => console.error(err))
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const gamesById = Object.fromEntries(games.map(g => [g.id, g]))
  const playersMap = Object.fromEntries(players.map(p => [p.id, p]))
  const liveById = Object.fromEntries(liveGames.map(l => [l.game_id, l]))
  const rounds = useMemo(() => roundsOf(games), [games])
  const myTeamId = profile?.player?.team_id || (coachTeamIds || [])[0] || null

  const refInfo = (game) => {
    if (!game.referee_id) return null
    const pool = game.referee_type === 'player' ? players : referees
    const ref = pool.find(r => r.id === game.referee_id)
    return ref ? `${ref.first_name} ${ref.last_name}` : null
  }

  // Senior-only page: a game belongs if either team is senior; tournament games live on
  // the tournament pages.
  const gameInAge = (g, age) => {
    const h = teamsMap[g.home_team_id], a = teamsMap[g.away_team_id]
    return (h && ageGroupsOf(h).includes(age)) || (a && ageGroupsOf(a).includes(age))
  }
  const compMatch = (g) => g.game_type === activeCompetition && !g.tournament_id

  // Every filter except the date: this is what the season calendar shows, and the
  // calendar is how a date gets picked, so it must not narrow itself to that date.
  const calendarGames = games.filter(g => {
    if (!gameInAge(g, ageTab)) return false
    if (!compMatch(g)) return false
    if (statusFilter !== "all" && g.status !== statusFilter) return false
    if (teamFilter !== "all" && g.home_team_id !== teamFilter && g.away_team_id !== teamFilter) return false
    return true
  })
  const filtered = dateFilter ? calendarGames.filter(g => dayKey(g.game_date) === dateFilter) : calendarGames

  const completed = filtered.filter(g => g.status === 'completed')
  // Postponed games stay in the schedule (struck time + נדחה), so nobody wonders where they went.
  const upcoming = filtered.filter(g => ['scheduled', 'in_progress', 'waiting_result', 'postponed'].includes(g.status) && !liveById[g.id])
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
  const live = filtered.filter(g => liveById[g.id])

  // The last round = every completed game played on the same day as the most recent
  // result (rounds are one matchday). Skipped when a date is picked.
  const sortedCompleted = [...completed].sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
  const lastRoundDay = !dateFilter && sortedCompleted.length ? dayKey(sortedCompleted[0].game_date) : null
  const lastRound = sortedCompleted.filter(g => lastRoundDay && dayKey(g.game_date) === lastRoundDay)
  const olderResults = sortedCompleted.filter(g => !lastRound.includes(g))
  const upcomingDays = groupByDay(upcoming)
  const olderDays = groupByDay(olderResults, true)
  const current = mode || (upcoming.length === 0 && live.length === 0 ? "results" : "upcoming")

  if (loading) return <GamesSkeletonFL />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="fl-card p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-fl-red text-sm font-medium">{error}</span>
          <button onClick={loadData} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /> נסה שוב</button>
        </div>
      </div>
    )
  }

  // Tags under a row: the coach's attendance chip, the player's own answer, the game type.
  const tagsFor = (game) => {
    const tags = []
    const myCoachTid = (coachTeamIds || []).find(tid => tid === game.home_team_id || tid === game.away_team_id)
    if (myCoachTid && game.status === "scheduled") {
      const st = Object.fromEntries((availByGame[game.id] || []).map(r => [r.player_id, r.status]))
      const coming = players.filter(p => p.team_id === myCoachTid && st[p.id] === "available")
      const gk = coming.some(p => p.position === "Goalkeeper")
      tags.push({ icon: <Squad className="w-4 h-4" />, text: <>מגיעים {coming.length}{!gk && <AlertTriangle className="w-4 h-4" aria-label="אין שוער" />}</>,
        tone: coming.length < 4 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400" })
    }
    if (game.status === "scheduled" && myAvail[game.id] === "available") tags.push({ icon: <CheckCircle2 className="w-4 h-4" />, text: "מגיע/ה", tone: "text-emerald-700 dark:text-emerald-400" })
    if (game.status === "scheduled" && myAvail[game.id] === "unavailable") tags.push({ icon: <XCircle className="w-4 h-4" />, text: "לא מגיע/ה" })
    if (game.status === "waiting_result") tags.push({ text: "ממתין לתוצאה", tone: "text-amber-700 dark:text-amber-400" })
    if (game.game_type === 'פלייאוף') tags.push({ text: game.series_game ? `פלייאוף · משחק ${game.series_game}` : "פלייאוף" })
    if (game.game_type === FRIENDLY_GAME_TYPE) tags.push({ text: "ידידותי" })
    if (game.kiosk_open != null) tags.push({ icon: <Utensils className="w-3.5 h-3.5" />, text: game.kiosk_open ? "דוכן פתוח" : "אין דוכן" })
    const ref = refInfo(game)
    if (ref && game.status !== "completed") tags.push({ icon: <Referee className="w-4 h-4" />, text: ref })
    return tags
  }

  // Goals + cards of a finished game, home column on the RIGHT. Only players who did
  // something — the full box score is on the game page.
  const statLine = (s, name) => (
    <span key={s.id} className="flex items-center justify-between gap-2 text-[12px] min-w-0">
      <span className="truncate text-fg-soft">{name}</span>
      <span className="flex gap-1.5 shrink-0 items-center fl-num text-[12px]">
        {s.goals > 0 && <span className="inline-flex items-center gap-0.5"><Ball className="w-4 h-4" /><span dir="ltr">{s.goals}</span></span>}
        {s.blue_cards > 0 && <span className="inline-flex items-center gap-0.5 text-fl-blue"><BlueCard className="w-4 h-4" /><span dir="ltr">{s.blue_cards}</span></span>}
        {s.red_cards > 0 && <span className="inline-flex items-center gap-0.5 text-fl-red"><RedCard className="w-4 h-4" /><span dir="ltr">{s.red_cards}</span></span>}
      </span>
    </span>
  )
  const eventsFor = (game) => {
    const notable = (statsByGame[game.id] || []).filter(s => s.goals > 0 || s.blue_cards > 0 || s.red_cards > 0)
    if (!notable.length) return null
    const nameOf = (s) => {
      if (s.is_guest_player) return s.guest_player_name || 'אורח'
      const p = playersMap[s.player_id]
      return p ? `${p.first_name} ${p.last_name}` : '—'
    }
    const teamOf = (s) => s.played_for_team_id || playersMap[s.player_id]?.team_id
    const guests = notable.filter(s => s.is_guest_player && !s.played_for_team_id)
    return (
      <span className="block mt-1 pt-1.5 border-t border-line/70">
        <span className="grid grid-cols-2 gap-x-5 gap-y-0.5">
          {[game.home_team_id, game.away_team_id].map(tid => (
            <span key={tid} className="flex flex-col gap-0.5 min-w-0">
              {notable.filter(s => !guests.includes(s) && teamOf(s) === tid)
                .sort((a, b) => (b.goals || 0) - (a.goals || 0))
                .map(s => statLine(s, nameOf(s)))}
            </span>
          ))}
        </span>
        {guests.length > 0 && (
          <span className="flex flex-col gap-0.5 mt-1">
            {guests.map(s => statLine(s, `${nameOf(s)}${s.guest_player_original_team ? ` (${s.guest_player_original_team})` : ''}`))}
          </span>
        )}
      </span>
    )
  }

  const row = (g, onDark = false) => (
    <FixtureRow key={g.id} game={g} home={teamsMap[g.home_team_id]} away={teamsMap[g.away_team_id]} live={liveById[g.id]}
      onDark={onDark} tags={tagsFor(g)} extra={!onDark && g.status === "completed" ? eventsFor(g) : null} />
  )
  const notes = (list) => list.filter(g => g.notes).map(g => (
    <p key={`n-${g.id}`} className="text-[12.5px] text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded-[12px] px-3 py-2">{g.notes}</p>
  ))
  const dayBlock = (day) => (
    <section key={day.key} className="flex flex-col gap-2.5" aria-label={`${weekday(day.date)} ${dayMonth(day.date)}`}>
      <div className="px-2"><DayHeader date={day.date} games={day.games} round={rounds[day.games[0].id]} /></div>
      <div className="flex flex-col gap-1.5">{day.games.map(g => row(g))}{notes(day.games)}</div>
    </section>
  )
  const blockTitle = (t, tone = "text-fg-strong") => <h2 className={`text-[13px] font-extrabold px-2 -mb-1 ${tone}`}>{t}</h2>

  const nTotal = games.filter(g => !g.tournament_id && gameInAge(g, ageTab)).length
  const selectedTeam = teamFilter !== "all" ? teamsMap[teamFilter] : null

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-8">
      <header className="flex items-end justify-between gap-3 px-1 pb-3.5">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="text-[40px] sm:text-[44px] font-extrabold leading-none text-fg-strong">משחקים</h1>
          <p className="text-[13px] text-fg-muted">{seasonName ? <>עונת <bdi dir="ltr">{seasonName}</bdi> · </> : null}{nTotal} משחקים</p>
        </div>
        <button type="button" onClick={() => setSheetOpen(o => !o)} aria-expanded={sheetOpen}
          className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full bg-fg-strong text-surface text-[13.5px] font-bold shrink-0">
          <CalendarPlus className="w-[22px] h-[22px]" /> ליומן שלי
        </button>
      </header>

      {sheetOpen && (
        <div className="mb-4 fl-fade-in">
          <CalendarSheet games={calendarGames} teamsMap={teamsMap} team={selectedTeam || (myTeamId ? teamsMap[myTeamId] : null)} seasonName={seasonName} onClose={() => setSheetOpen(false)} />
        </div>
      )}

      {/* Filters: view · הבאים/תוצאות · team, then competition + status + date. */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap [scrollbar-width:none]">
          <div role="group" aria-label="תצוגה" className="flex shrink-0 bg-surface-sunken rounded-full p-0.5 lg:hidden">
            {[["list", "רשימה"], ["month", "חודש"]].map(([v, t]) => (
              <button key={v} type="button" onClick={() => pickView(v)} aria-pressed={view === v}
                className={`min-h-11 px-3.5 rounded-full text-[13.5px] font-bold ${view === v ? "bg-surface text-fg-strong shadow-sm" : "text-fg-soft"}`}>{t}</button>
            ))}
          </div>
          {(view === "list" || isDesktop) && <>
            <button type="button" className={pill(current === "upcoming")} aria-pressed={current === "upcoming"} onClick={() => setMode("upcoming")}>הבאים</button>
            <button type="button" className={pill(current === "results")} aria-pressed={current === "results"} onClick={() => setMode("results")}>תוצאות</button>
          </>}
          {myTeamId && teamsMap[myTeamId] && (
            <button type="button" className={pill(teamFilter === myTeamId)} aria-pressed={teamFilter === myTeamId}
              onClick={() => setTeamFilter(f => (f === myTeamId ? "all" : myTeamId))}>הקבוצה שלי</button>
          )}
          <label className="relative shrink-0">
            <span className="sr-only">סינון לפי קבוצה</span>
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
              className={`${pill(teamFilter !== "all" && teamFilter !== myTeamId)} appearance-none pe-9 bg-transparent cursor-pointer`}>
              <option value="all">כל הקבוצות</option>
              {teams.filter(t => ageGroupsOf(t).includes(ageTab)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" aria-hidden="true" />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="tab-bar sm:w-auto">
            {[["ליגה", "ליגה"], ["פלייאוף", "פלייאוף"], [FRIENDLY_GAME_TYPE, "ידידותי"]].map(([v, t]) => (
              <button key={v} type="button" onClick={() => setActiveCompetition(v)} className={activeCompetition === v ? "tab-active" : "tab-inactive"}>{t}</button>
            ))}
          </div>
          <div className="flex gap-2 flex-1">
            <select aria-label="סינון לפי סטטוס" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select flex-1 min-w-[120px] min-h-11">
              <option value="all">כל הסטטוסים</option>
              <option value="scheduled">מתוכנן</option>
              <option value="completed">הסתיים</option>
              <option value="waiting_result">ממתין</option>
              <option value="postponed">נדחה</option>
            </select>
            <div className="relative flex-1 min-w-[130px]">
              <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} aria-label="סינון לפי תאריך" className={`peer filter-input w-full min-h-11 ${dateFilter ? '' : 'text-transparent focus:text-fg-soft'}`} />
              {/* iOS shows an empty date field as a blank box (desktop shows dd/mm/yyyy) — label it */}
              {!dateFilter && <span className="peer-focus:hidden pointer-events-none absolute inset-y-0 right-9 flex items-center text-sm font-medium text-fg-soft">כל התאריכים</span>}
              {dateFilter && <button onClick={() => setDateFilter('')} aria-label="נקה תאריך" className="absolute left-1 top-1/2 -translate-y-1/2 size-9 flex items-center justify-center"><X className="w-4 h-4 text-fg-muted" /></button>}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop: the month calendar always sits beside the list (the toggle is for phones). */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:items-start">
        {(
          <div className={`mb-5 lg:mb-0 lg:sticky lg:top-20 ${view === "month" ? "" : "hidden lg:block"}`}>
            <GamesCalendar games={calendarGames} teamsMap={teamsMap} selectedDate={dateFilter} onSelectDate={setDateFilter} />
          </div>
        )}

        <div className="flex flex-col gap-6 min-w-0">
          {dateFilter && (
            <button type="button" onClick={() => setDateFilter("")} className="self-start inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full bg-fg-strong text-surface text-[14px] font-semibold"
              aria-label="ביטול סינון היום">
              {weekday(`${dateFilter}T12:00:00+02:00`)} <bdi dir="ltr">{dayMonth(`${dateFilter}T12:00:00+02:00`)}</bdi><X className="w-3.5 h-3.5" />
            </button>
          )}

          {liveGames.length > 0 && (
            <section className="flex flex-col gap-2.5">
              {blockTitle("משחקים חיים", "text-fl-live")}
              <LiveGameBanner liveGames={liveGames} gamesById={gamesById} teamsMap={teamsMap} />
            </section>
          )}

          {((view === "month" && !isDesktop) || current === "upcoming") && upcomingDays.length > 0 && (() => {
            const [first, ...rest] = upcomingDays
            return (
              <>
                <section aria-label="יום המשחקים הבא" className="relative isolate overflow-hidden rounded-[24px] bg-[#0E151F] px-3 pt-4.5 pb-3 pt-[18px]">
                  <RinkDrawing strength={0.2} className="absolute inset-x-2 top-1/2 -translate-y-1/2 w-[calc(100%-16px)] -z-10 opacity-20" />
                  <div className="px-1.5 pb-3.5">
                    <DayHeader date={first.date} games={first.games} round={rounds[first.games[0].id]} size={56} onDark trailing={daysUntil(first.date)} />
                  </div>
                  <div className="flex flex-col gap-1.5">{first.games.map(g => row(g, true))}</div>
                  {first.games.some(g => g.notes) && <div className="flex flex-col gap-1.5 mt-1.5">{notes(first.games)}</div>}
                </section>
                {rest.map(dayBlock)}
              </>
            )
          })()}

          {((view === "month" && !isDesktop) || current === "results") && (
            <>
              {lastRound.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {blockTitle("המחזור האחרון")}
                  {dayBlock(groupByDay(lastRound)[0])}
                </div>
              )}
              {olderDays.map(dayBlock)}
            </>
          )}

          {(view === "list" || isDesktop) && current === "upcoming" && upcomingDays.length === 0 && filtered.length > 0 && (
            <p className="text-center text-[14px] text-fg-muted py-6">אין משחקים קרובים</p>
          )}
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <Calendar className="w-12 h-12 mx-auto mb-3" />
              <h3 className="text-lg font-extrabold text-fg-strong">אין משחקים תואמים</h3>
              <p className="text-sm text-fg-muted mt-1">נסה לשנות את הסינונים</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
