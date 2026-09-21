import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { getTournamentById, getTournamentGames, getTournamentTeams, respondTournamentInvite } from "@/lib/tournaments"
import { getTeams } from "@/lib/api"
import { useAuth } from "@/lib/AuthContext"
import { AGE_LABEL } from "@/lib/ageGroups"
import { TOURNAMENT_STATUS, dateRange } from "./Tournaments"
import TournamentTeamsManager from "@/components/TournamentTeamsManager"
import ScheduleGenerator from "@/components/ScheduleGenerator"
import TournamentStandings from "@/components/TournamentStandings"
import { Trophy, Calendar, MapPin, ArrowRight, RefreshCw, Users, Check, X } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { TeamLink } from "@/components/EntityLinks"
import { useSeo } from "@/lib/seo"
import { useSlugId, entityPath } from "@/lib/slugs"
import { TournamentDetailSkeleton } from "@/components/skeletons/PageSkeletons"

const statusLabel = {
  scheduled: "מתוכנן", in_progress: "משחק חי", waiting_result: "ממתין לתוצאה",
  completed: "הסתיים", postponed: "נדחה", cancelled: "בוטל",
}

export default function TournamentDetail() {
  const { id: routeKey } = useParams()
  const { id, notFound: unknownRoute } = useSlugId('tournaments', routeKey)
  const { isAdmin, isLeagueManager, coachTeamIds } = useAuth()
  const [tournament, setTournament] = useState(null)
  const [games, setGames] = useState([])
  const [teams, setTeams] = useState([])
  const [teamsMap, setTeamsMap] = useState({})
  const [tteams, setTteams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Runs before the early returns below so the tab title / share preview names the
  // tournament instead of falling back to the generic site title.
  useSeo({
    title: tournament?.name || 'טורניר',
    description: tournament?.name
      ? `לוח משחקים, טבלה ותוצאות של ${tournament.name} — טורניר הנוער של ליגת הוקי הגלגיליות הישראלית`
      : undefined,
    path: entityPath('tournaments', tournament) || `/tournaments/${routeKey}`,
  })

  useEffect(() => {
    // `id` is null only while a Hebrew slug is being resolved into the row's
    // UUID; `unknownRoute` means that resolution came back empty.
    if (id) load()
    else if (unknownRoute) { setError('הטורניר לא נמצא'); setLoading(false) }
  }, [id, unknownRoute])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const [tour, gs, ts, tt] = await Promise.all([
        getTournamentById(id), getTournamentGames(id), getTeams(), getTournamentTeams(id).catch(() => []),
      ])
      if (!tour) { setError("הטורניר לא נמצא"); return }
      setTournament(tour); setGames(gs); setTeams(ts)
      setTeamsMap(Object.fromEntries(ts.map(x => [x.id, x])))
      setTteams(tt)
    } catch (e) { console.error(e); setError("שגיאה בטעינת הטורניר") }
    finally { setLoading(false) }
  }

  const reloadTeams = async () => { try { setTteams(await getTournamentTeams(id)) } catch { /* ignore */ } }
  const reloadGames = async () => { try { setGames(await getTournamentGames(id)) } catch { /* ignore */ } }
  const respond = async (inviteId, accept) => {
    try { await respondTournamentInvite(inviteId, accept); await reloadTeams() }
    catch (e) { alert('שגיאה: ' + (e.message || e)) }
  }

  if (loading) return <TournamentDetailSkeleton />

  if (error || !tournament) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error || "הטורניר לא נמצא"}</span>
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
            </button>
            <Link to="/tournaments" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors">
              <ArrowRight className="w-3.5 h-3.5" /> חזרה
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const st = TOURNAMENT_STATUS[tournament.status] || TOURNAMENT_STATUS.active
  const range = dateRange(tournament)
  const acceptedIds = tteams.filter(r => r.status === 'accepted').map(r => r.team_id)
  const derivedIds = games.flatMap(g => [g.home_team_id, g.away_team_id]).filter(Boolean)
  const teamIds = [...new Set([...acceptedIds, ...derivedIds])]
  const isManager = isAdmin || isLeagueManager
  const myInvites = tteams.filter(r => r.status === 'invited' && Array.isArray(coachTeamIds) && coachTeamIds.includes(r.team_id))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <Link to="/tournaments" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> חזרה לטורנירים
      </Link>

      {/* header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
            <Trophy className="w-7 h-7 text-brand" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">{tournament.name}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <span className="stat-pill bg-brand/10 text-brand-strong dark:bg-brand/20 dark:text-brand-light">{AGE_LABEL[tournament.age_group] || tournament.age_group}</span>
              <span className={`stat-pill ${st.cls}`}>{st.label}</span>
              {range && <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> <span dir="ltr">{range}</span></span>}
            </div>
            {tournament.notes && <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">{tournament.notes}</p>}
          </div>
        </div>
      </motion.div>

      {/* Coach: respond to a tournament invite for your team */}
      {myInvites.map(inv => {
        const t = inv.teams || teamsMap[inv.team_id]
        return (
          <div key={inv.id} className="card p-4 flex items-center justify-between gap-3 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
            <div className="flex items-center gap-2 min-w-0">
              <TeamLogo team={t} size={7} />
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-400 truncate">הוזמנתם לטורניר עם {t?.name || "הקבוצה"}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => respond(inv.id, true)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"><Check className="w-3.5 h-3.5" /> אשר</button>
              <button onClick={() => respond(inv.id, false)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><X className="w-3.5 h-3.5" /> דחה</button>
            </div>
          </div>
        )
      })}

      {/* Manager: invite & manage teams */}
      {isManager && (
        <TournamentTeamsManager tournamentId={id} ageGroup={tournament.age_group} rows={tteams} teams={teams} teamsMap={teamsMap} onChange={reloadTeams} />
      )}

      {/* Manager: generate the schedule from accepted teams */}
      {isManager && (
        <ScheduleGenerator tournament={tournament} teamIds={acceptedIds} teamsMap={teamsMap} existingGames={games.length} onChange={reloadGames} />
      )}

      {/* teams involved */}
      {teamIds.length > 0 && (
        <div className="card p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-3">
            <Users className="w-4 h-4 text-brand" /> קבוצות משתתפות ({teamIds.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {teamIds.map(tid => {
              const team = teamsMap[tid]
              return (
                <div key={tid} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-1.5">
                  <TeamLogo team={team} size={6} />
                  <TeamLink team={team} className="text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-brand transition-colors">{team?.name || "—"}</TeamLink>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* standings (round-robin / group play) */}
      <TournamentStandings teamIds={teamIds} games={games} teamsMap={teamsMap} />

      {/* games / results */}
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white mb-3">
          <Calendar className="w-4 h-4 text-brand" /> משחקים ({games.length})
        </h2>
        {games.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">עדיין לא נקבעו משחקים לטורניר זה</p>
        ) : (
          <div className="space-y-2">
            {games.map(g => {
              const home = teamsMap[g.home_team_id], away = teamsMap[g.away_team_id]
              const done = g.status === "completed" && g.home_score != null && g.away_score != null
              return (
                <div key={g.id} className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  {/* RTL: home on the right, away on the left; score rendered away:home */}
                  <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                    <TeamLink team={home} className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate text-left hover:text-brand transition-colors">{home?.name || "—"}</TeamLink>
                    <TeamLogo team={home} size={6} />
                  </div>
                  <div className="shrink-0 text-center min-w-[3.5rem]">
                    {done ? (
                      <span className="text-base font-extrabold tabular-nums text-slate-900 dark:text-white">{g.away_score}<span className="text-slate-300 dark:text-slate-600 mx-1">:</span>{g.home_score}</span>
                    ) : (
                      /* date and time are two separate LTR runs — without dir=ltr the RTL context prints the time first */
                      <span className="text-[11px] font-semibold text-slate-400">
                        {g.game_date
                          ? <span dir="ltr" className="tabular-nums">{format(new Date(g.game_date), "d/M HH:mm")}</span>
                          : (statusLabel[g.status] || "")}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <TeamLogo team={away} size={6} />
                    <TeamLink team={away} className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate hover:text-brand transition-colors">{away?.name || "—"}</TeamLink>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {games.some(g => g.venue) && (
          <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1"><MapPin className="w-3 h-3" /> המשחקים מתקיימים במגרשי הטורניר</p>
        )}
      </div>
    </div>
  )
}
