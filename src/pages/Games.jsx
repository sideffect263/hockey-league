import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getGames, getTeams, getPlayers, getReferees, getGameStats } from "@/lib/api"
import { Calendar, Clock, MapPin, Trophy, Shield, X, ArrowLeft, RefreshCw, AlertTriangle, Users, Utensils, CheckCircle2, XCircle } from "lucide-react"
import { Crossed } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { useAuth } from "@/lib/AuthContext"
import { getAvailabilityForGames } from "@/lib/availability"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { DEFAULT_AGE, ageGroupsOf } from "@/lib/ageGroups"
import LiveGameBanner from "@/components/LiveGameBanner"
import { useLiveGames } from "@/lib/useLiveGames"
import { Radio } from "lucide-react"
import { useSeasonName } from "@/App"
import { entityPath } from "@/lib/slugs"
import { GamesSkeleton } from "@/components/skeletons/PageSkeletons"
import GamesCalendar from "@/components/games/GamesCalendar"

export default function Games() {
  const { coachTeamIds, profile } = useAuth()
  const myPlayerId = profile?.player_id || null
  const seasonName = useSeasonName()
  const [games, setGames] = useState([])
  const [availByGame, setAvailByGame] = useState({})
  // The signed-in player's own answer per upcoming game → "מגיע/ה" badge on the card.
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
  // game_stats grouped by game id — every finished card shows its scorers/cards inline.
  const [statsByGame, setStatsByGame] = useState({})

  useEffect(() => { loadData() }, [])

  // Coach-only: fetch attendance for the coach's own upcoming games → per-card chip.
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
      // Keep tournament games too — the age tabs + טורנירים filter surface them
      // (youth teams only ever play tournament games).
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
  const teamName = (id) => teamsMap[id]?.name || '—'

  const refInfo = (game) => {
    if (!game.referee_id) return null
    const pool = game.referee_type === 'player' ? players : referees
    const ref = pool.find(r => r.id === game.referee_id)
    return ref ? `${ref.first_name} ${ref.last_name}` : null
  }

  const statusCfg = {
    scheduled: { label: "מתוכנן", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    waiting_result: { label: "ממתין", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    in_progress: { label: "במהלך", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    completed: { label: "הסתיים", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400" },
    postponed: { label: "נדחה", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  }

  // The Games page is senior-only (youth play tournaments, shown on the tournament
  // pages). A game belongs to an age group if either team is in it; ageTab is always
  // senior here, so this keeps senior league/playoff/friendly games.
  const gameInAge = (g, age) => {
    const h = teamsMap[g.home_team_id], a = teamsMap[g.away_team_id]
    return (h && ageGroupsOf(h).includes(age)) || (a && ageGroupsOf(a).includes(age))
  }
  // This page is senior league/playoff/friendly only; tournament games live on the
  // tournament pages, so every tab here excludes tournament-tagged games.
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
  const filtered = dateFilter
    ? calendarGames.filter(g => format(new Date(g.game_date), 'yyyy-MM-dd') === dateFilter)
    : calendarGames

  const completed = filtered.filter(g => g.status === 'completed')
  const upcoming = filtered.filter(g => ['scheduled', 'in_progress', 'waiting_result'].includes(g.status))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))

  // The last round = every completed game played on the same day as the most recent
  // result (rounds are one matchday; there's no round column). Pinned above the
  // schedule so last weekend's scores are the first thing you see; pulled out of
  // תוצאות so they don't render twice. Skipped when a date is picked — that list is
  // already just one day.
  const sortedCompleted = [...completed].sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
  const lastRoundDay = !dateFilter && sortedCompleted.length
    ? format(new Date(sortedCompleted[0].game_date), 'yyyy-MM-dd') : null
  const inLastRound = (g) => lastRoundDay && format(new Date(g.game_date), 'yyyy-MM-dd') === lastRoundDay
  const lastRound = sortedCompleted.filter(inLastRound)
  const olderResults = sortedCompleted.filter(g => !inLastRound(g))

  if (loading) return <GamesSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  // Rendered by INVOKING this function inline (`{GameCard({ game })}`), not as
  // `<GameCard/>`. It's defined inside Games, so its identity changes every render;
  // as a JSX element that remounts every card on any state change — tearing down the
  // DOM (scroll jumps to top) and replaying the entrance animation when stats arrive.
  // Invoking it inline keeps the keyed root <motion.div> stable. Safe because it has
  // no hooks. Keep the `key` on the returned motion.div.
  const GameCard = ({ game }) => {
    const done = game.status === "completed"
    const status = statusCfg[game.status] || statusCfg.completed
    const ref = refInfo(game)
    // Coach-only attendance chip for the coach's own upcoming games.
    const myCoachTid = (coachTeamIds || []).find(tid => tid === game.home_team_id || tid === game.away_team_id)
    const att = (myCoachTid && game.status === "scheduled") ? (() => {
      const st = Object.fromEntries((availByGame[game.id] || []).map(r => [r.player_id, r.status]))
      const coming = players.filter(p => p.team_id === myCoachTid && st[p.id] === "available")
      return { count: coming.length, gk: coming.some(p => p.position === "Goalkeeper"), tooFew: coming.length < 4 }
    })() : null
    const home = teamsMap[game.home_team_id]
    const away = teamsMap[game.away_team_id]
    const homeWin = done && game.home_score > game.away_score
    const awayWin = done && game.away_score > game.home_score
    const tie = done && game.home_score === game.away_score

    return (
      <motion.div key={game.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-hover overflow-hidden">
        {/* The whole card is the link to the full game page (live scoreboard, stream,
            H2H, box score). Nothing inside may be another <a> — names are plain text. */}
        <Link to={entityPath('games', game)} className="block text-right p-4 sm:p-5">
          {/* Tags row */}
          <div className="flex items-center gap-2 mb-3">
            <span className={`stat-pill ${status.cls}`}>{status.label}</span>
            {game.game_type === 'פלייאוף' && <span className="stat-pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">פלייאוף</span>}
            {game.game_type === FRIENDLY_GAME_TYPE && <span className="stat-pill bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">ידידותי</span>}
            {game.series_game && <span className="stat-pill bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">משחק {game.series_game}</span>}
            {att && (
              <span className={`stat-pill inline-flex items-center gap-1 ${att.tooFew ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`} title="מגיעים מהקבוצה שלך">
                <Users className="w-3 h-3" /> {att.count}{!att.gk && <AlertTriangle className="w-3 h-3 text-red-500" />}
              </span>
            )}
            {game.status === "scheduled" && myAvail[game.id] === "available" && (
              <span className="stat-pill inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" title="אישרת הגעה למשחק">
                <CheckCircle2 className="w-3 h-3" /> מגיע/ה
              </span>
            )}
            {game.status === "scheduled" && myAvail[game.id] === "unavailable" && (
              <span className="stat-pill inline-flex items-center gap-1 bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" title="סימנת שלא תגיע/י">
                <XCircle className="w-3 h-3" /> לא מגיע/ה
              </span>
            )}
          </div>

          {/* Match row — winning side is tinted + trophy-marked */}
          <div className="flex items-center justify-between gap-2">
            <div className={`flex flex-col sm:flex-row items-center gap-1 sm:gap-3 flex-1 min-w-0 rounded-xl px-2 py-1.5 transition-colors ${homeWin ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
              <TeamLogo team={home} size={10} />
              <div className="min-w-0 max-w-full text-center sm:text-start">
                <p className={`text-sm leading-tight flex items-center justify-center sm:justify-start gap-1 ${homeWin ? 'font-extrabold text-emerald-700 dark:text-emerald-300' : awayWin ? 'font-semibold text-slate-500 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-white'}`}>
                  {homeWin && <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  <span className="line-clamp-2 break-words">{home?.name}</span>
                </p>
                <p className={`text-[11px] ${homeWin ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}`}>{tie ? 'תיקו' : homeWin ? 'מנצחת' : 'בית'}</p>
              </div>
            </div>

            {/* RTL: the flex row visually places the home team on the RIGHT and the
                away team on the LEFT, but numeric digits always render left-to-right.
                So the score outputs away_score first (renders on the left, beside the
                away team) and home_score last (renders on the right, beside the home
                team). Do NOT reorder to home:away — it looks flipped. */}
            <div className="px-1 sm:px-3 text-center shrink-0">
              {done ? (
                <div className="text-2xl font-extrabold tracking-tight tabular-nums">
                  <span className={awayWin ? 'text-emerald-600 dark:text-emerald-400' : homeWin ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}>{game.away_score}</span>
                  <span className="text-slate-300 dark:text-slate-600 mx-1">:</span>
                  <span className={homeWin ? 'text-emerald-600 dark:text-emerald-400' : awayWin ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'}>{game.home_score}</span>
                </div>
              ) : (
                <div className="text-lg font-bold text-slate-300 dark:text-slate-600">
                  {format(new Date(game.game_date), "HH:mm")}
                </div>
              )}
            </div>

            <div className={`flex flex-col sm:flex-row-reverse items-center gap-1 sm:gap-3 flex-1 min-w-0 rounded-xl px-2 py-1.5 transition-colors ${awayWin ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
              <TeamLogo team={away} size={10} />
              <div className="min-w-0 max-w-full text-center sm:text-left">
                <p className={`text-sm leading-tight flex items-center justify-center sm:justify-start gap-1 flex-row-reverse ${awayWin ? 'font-extrabold text-emerald-700 dark:text-emerald-300' : homeWin ? 'font-semibold text-slate-500 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-white'}`}>
                  {awayWin && <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  <span className="line-clamp-2 break-words">{away?.name}</span>
                </p>
                <p className={`text-[11px] ${awayWin ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}`}>{tie ? 'תיקו' : awayWin ? 'מנצחת' : 'חוץ'}</p>
              </div>
            </div>
          </div>

          {done && EventsRow(game)}

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{format(new Date(game.game_date), "d/M/yyyy")}</span>
            {/* Upcoming games already show the time in place of the score. */}
            {done && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{format(new Date(game.game_date), "HH:mm")}</span>}
            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{game.venue || '—'}</span>
            {/* Kiosk — only when someone has actually said. null stays silent. */}
            {game.kiosk_open != null && (
              <span className={`flex items-center gap-1 font-semibold ${game.kiosk_open ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                <Utensils className="w-3.5 h-3.5" />{game.kiosk_open ? 'דוכן פתוח' : 'אין דוכן'}
              </span>
            )}
            {ref && <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5" />{ref}</span>}
            <span className="mr-auto flex items-center gap-1 font-semibold text-brand dark:text-brand-light">לעמוד המשחק <ArrowLeft className="w-3.5 h-3.5" /></span>
          </div>

          {game.notes && (
            <div className="mt-3 p-2.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-300 border border-amber-100 dark:border-amber-800/50">
              {game.notes}
            </div>
          )}
        </Link>
      </motion.div>
    )
  }

  // Goals + cards of a finished game, one column per team (home on the right in RTL).
  // Only players who did something — the full box score is on the game page.
  const statLine = (s, name) => (
    <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-slate-700 dark:text-slate-300">{name}</span>
      <span className="flex gap-1 shrink-0">
        {s.goals > 0 && <span className="stat-pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 !py-0 !px-1.5">⚽ {s.goals}</span>}
        {s.blue_cards > 0 && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 !py-0 !px-1.5">🟦 {s.blue_cards}</span>}
        {s.red_cards > 0 && <span className="stat-pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 !py-0 !px-1.5">🟥 {s.red_cards}</span>}
      </span>
    </div>
  )
  const EventsRow = (game) => {
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
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {[game.home_team_id, game.away_team_id].map(tid => (
            <div key={tid} className="space-y-1 min-w-0">
              {notable.filter(s => !guests.includes(s) && teamOf(s) === tid)
                .sort((a, b) => (b.goals || 0) - (a.goals || 0))
                .map(s => statLine(s, nameOf(s)))}
            </div>
          ))}
        </div>
        {guests.length > 0 && (
          <div className="mt-2 space-y-1">
            {guests.map(s => statLine(s, `${nameOf(s)}${s.guest_player_original_team ? ` (${s.guest_player_original_team})` : ''}`))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Crossed className="w-7 h-7 text-brand" /> משחקים
        </h1>
        <p className="page-subtitle mt-1">לוח משחקים ותוצאות{seasonName && ` עונת ${seasonName}`}</p>
      </motion.div>

      <GamesCalendar
        games={calendarGames}
        teamsMap={teamsMap}
        selectedDate={dateFilter}
        onSelectDate={setDateFilter}
        team={teamFilter !== "all" ? teamsMap[teamFilter] : null}
        seasonName={seasonName}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="tab-bar sm:w-auto">
          <button onClick={() => setActiveCompetition("ליגה")} className={activeCompetition === "ליגה" ? "tab-active" : "tab-inactive"}>
            <Trophy className="w-4 h-4" /> ליגה
          </button>
          <button onClick={() => setActiveCompetition("פלייאוף")} className={activeCompetition === "פלייאוף" ? "tab-active" : "tab-inactive"}>
            <Shield className="w-4 h-4" /> פלייאוף
          </button>
          <button onClick={() => setActiveCompetition(FRIENDLY_GAME_TYPE)} className={activeCompetition === FRIENDLY_GAME_TYPE ? "tab-active" : "tab-inactive"}>
            <Crossed className="w-4 h-4" /> ידידותי
          </button>
        </div>
        <div className="flex gap-2 flex-1 flex-wrap">
          <select aria-label="סינון לפי סטטוס" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="filter-select flex-1 min-w-[120px]">
            <option value="all">כל הסטטוסים</option>
            <option value="scheduled">מתוכנן</option>
            <option value="completed">הסתיים</option>
            <option value="waiting_result">ממתין</option>
          </select>
          <select aria-label="סינון לפי קבוצה" value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="filter-select flex-1 min-w-[120px]">
            <option value="all">כל הקבוצות</option>
            {teams.filter(t => ageGroupsOf(t).includes(ageTab)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="relative flex-1 min-w-[130px]">
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} aria-label="סינון לפי תאריך" className={`peer filter-input w-full ${dateFilter ? '' : 'text-transparent focus:text-fg-soft'}`} />
            {/* iOS shows an empty date field as a blank box (desktop shows dd/mm/yyyy) — label it */}
            {!dateFilter && <span className="peer-focus:hidden pointer-events-none absolute inset-y-0 right-9 flex items-center text-sm font-medium text-fg-soft">כל התאריכים</span>}
            {dateFilter && <button onClick={() => setDateFilter('')} aria-label="נקה תאריך" className="absolute left-2 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
          </div>
        </div>
      </div>

      {/* Games */}
      <div className="space-y-6">
        {liveGames.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2 uppercase tracking-wide">
              <Radio className="w-4 h-4 text-red-500" /> משחקים חיים
            </h2>
            <LiveGameBanner liveGames={liveGames} gamesById={gamesById} teamsMap={teamsMap} />
          </div>
        )}
        {lastRound.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2 uppercase tracking-wide">
              <Trophy className="w-4 h-4 text-amber-500" /> המחזור האחרון
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 normal-case">{format(new Date(lastRound[0].game_date), "d/M/yyyy")}</span>
            </h2>
            <div className="grid gap-3">{lastRound.map(g => GameCard({ game: g }))}</div>
          </div>
        )}
        {upcoming.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2 uppercase tracking-wide">
              <Clock className="w-4 h-4 text-blue-500" /> משחקים קרובים
            </h2>
            <div className="grid gap-3">{upcoming.map(g => GameCard({ game: g }))}</div>
          </div>
        )}
        {olderResults.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2 uppercase tracking-wide">
              <Trophy className="w-4 h-4 text-emerald-500" /> תוצאות
            </h2>
            <div className="grid gap-3">{olderResults.map(g => GameCard({ game: g }))}</div>
          </div>
        )}
        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Calendar className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
            <h3 className="text-lg font-semibold text-slate-500 dark:text-slate-400">אין משחקים תואמים</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">נסה לשנות את הסינונים</p>
          </div>
        )}
      </div>
    </div>
  )
}
