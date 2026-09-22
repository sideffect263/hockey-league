import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getTeams, getPlayers, getMyTeamRequests } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { standingsComparator } from "@/lib/utils"
import { AGE_GROUPS, DEFAULT_AGE, AGE_LABEL, ageOf, ageGroupsOf } from "@/lib/ageGroups"
import { useAuth } from "@/lib/AuthContext"
import CreateTeamModal from "@/components/CreateTeamModal"
import { Users, Trophy, Target, Shield, ChevronDown, ChevronUp, Star, RefreshCw, ArrowLeft, Plus, Clock } from "lucide-react"
import { Teams as TeamsIcon } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import TeamLogo from "@/components/TeamLogo"
import { useSeasonName } from "@/App"
import { entityPath } from "@/lib/slugs"
import { TeamsSkeleton } from "@/components/skeletons/PageSkeletons"

export default function Teams() {
  const { profile } = useAuth()
  const seasonName = useSeasonName()
  const isLinkedPlayer = !!profile?.player_id
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [playerTeams, setPlayerTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedTeam, setExpandedTeam] = useState(null)
  const [ageTab, setAgeTab] = useState(DEFAULT_AGE)
  const [showCreate, setShowCreate] = useState(false)
  const [myPending, setMyPending] = useState([])

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (isLinkedPlayer) refreshMyRequests() }, [isLinkedPlayer])

  const refreshMyRequests = async () => {
    try { const r = await getMyTeamRequests(); setMyPending(r.filter(t => t.status === 'pending')) }
    catch { /* ignore */ }
  }

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [t, p, pt] = await Promise.all([getTeams(), getPlayers(), getPlayerTeams().catch(() => [])])
      setTeams(t); setPlayers(p); setPlayerTeams(pt)
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  if (loading) return <TeamsSkeleton />

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

  const isSenior = ageTab === DEFAULT_AGE
  const { byTeam: membersByTeam } = buildMemberMaps(playerTeams, players)
  const countByAge = teams.reduce((acc, t) => { for (const a of ageGroupsOf(t)) acc[a] = (acc[a] || 0) + 1; return acc }, {})
  const visible = teams.filter(t => ageGroupsOf(t).includes(ageTab))
  const sorted = isSenior
    ? [...visible].sort(standingsComparator)
    : [...visible].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2.5">
              <TeamsIcon className="w-7 h-7 text-brand" /> קבוצות
            </h1>
            <p className="page-subtitle mt-1">
              {isSenior
                ? `${visible.length} קבוצות בליגה${seasonName ? ` • עונת ${seasonName}` : ''}`
                : `${visible.length} קבוצות • ${AGE_LABEL[ageTab]}`}
            </p>
          </div>
          {isLinkedPlayer && (
            <button onClick={() => setShowCreate(true)}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors">
              <Plus className="w-4 h-4" /> צור קבוצה
            </button>
          )}
        </div>
        {myPending.length > 0 && (
          <div className="mt-3 card p-3 flex items-center gap-2.5 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              הקבוצה "{myPending[0].name}" ממתינה לאישור מנהל הליגה
            </p>
          </div>
        )}
      </motion.div>

      {showCreate && (
        <CreateTeamModal onClose={() => setShowCreate(false)} onCreated={refreshMyRequests} />
      )}

      {/* age-group tabs: the senior league + youth-tournament age categories */}
      <div className="flex items-center gap-2 overflow-x-auto nav-scroll -mx-1 px-1">
        {AGE_GROUPS.map(a => {
          const on = ageTab === a.value
          return (
            <button key={a.value} onClick={() => { setAgeTab(a.value); setExpandedTeam(null) }}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-bold transition-colors ${on ? "bg-brand text-white shadow-sm shadow-brand/25" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
              {a.label}
              <span className={`text-[11px] tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{countByAge[a.value] || 0}</span>
            </button>
          )
        })}
      </div>

      {sorted.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-2">
          <TeamsIcon className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">אין קבוצות בקטגוריה זו עדיין</p>
          {!isSenior && <p className="text-xs text-slate-400">קבוצות {AGE_LABEL[ageTab]} מתווספות דרך מסך הניהול</p>}
        </div>
      ) : (
      <div className="space-y-3">
        {sorted.map((team, index) => {
          const tp = players.filter(p => membersByTeam.get(team.id)?.has(p.id))
          const open = expandedTeam === team.id
          const topScorer = tp.filter(p => p.position === 'Field Player' && (p.goals || 0) > 0).sort((a, b) => (b.goals || 0) - (a.goals || 0))[0]

          return (
            <motion.div key={team.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
              <div className="card-hover overflow-hidden">
                <button onClick={() => setExpandedTeam(open ? null : team.id)} className="w-full p-4 sm:p-5 text-right" aria-expanded={open}>
                  <div className="flex items-center gap-4">
                    <TeamLogo team={team} size={12} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-base text-slate-900 dark:text-white">{team.name}</h2>
                        {isSenior && <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">#{index + 1}</span>}
                        {!isSenior && <span className="text-[10px] font-bold text-brand dark:text-brand-light bg-brand/10 dark:bg-brand/20 px-1.5 py-0.5 rounded">{AGE_LABEL[ageTab]}</span>}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{team.city}{team.founded_year ? ` • ${team.founded_year}` : ''}</p>
                    </div>
                    {isSenior && <div className="hidden sm:flex items-center gap-5 text-center">
                      <div>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white">{team.points || 0}</p>
                        <p className="text-[10px] text-slate-400 font-medium">נקודות</p>
                      </div>
                      <div className="h-8 w-px bg-slate-200 dark:bg-slate-700" />
                      <div className="flex gap-3">
                        <div><p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{team.wins || 0}</p><p className="text-[10px] text-slate-400">נ</p></div>
                        <div><p className="text-sm font-bold text-slate-500">{team.ties || 0}</p><p className="text-[10px] text-slate-400">ת</p></div>
                        <div><p className="text-sm font-bold text-red-500">{team.losses || 0}</p><p className="text-[10px] text-slate-400">ה</p></div>
                      </div>
                    </div>}
                    <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                  {isSenior && (
                    <div className="sm:hidden flex gap-3 mt-2">
                      <span className="stat-pill bg-slate-900 dark:bg-brand text-white">{team.points} נק׳</span>
                      <span className="text-xs text-slate-400">{team.wins}נ {team.ties}ת {team.losses}ה</span>
                    </div>
                  )}
                </button>

                {open && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 sm:px-5 pb-5 border-t border-slate-100 dark:border-slate-700">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 mb-5">
                      {(isSenior ? [
                        { icon: Trophy, val: team.points || 0, label: "נקודות", color: "text-brand" },
                        { icon: Target, val: team.goals_for || 0, label: "שערי זכות", color: "text-emerald-500" },
                        { icon: Shield, val: team.goals_against || 0, label: "שערי חובה", color: "text-red-500" },
                        { icon: Users, val: tp.length, label: "שחקנים", color: "text-blue-500" },
                      ] : [
                        { icon: Users, val: tp.length, label: "שחקנים", color: "text-blue-500" },
                      ]).map(({ icon: Icon, val, label, color }) => (
                        <div key={label} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 text-center">
                          <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
                          <p className="text-lg font-extrabold text-slate-900 dark:text-white">{val}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{label}</p>
                        </div>
                      ))}
                    </div>

                    {topScorer && (
                      <div className="mb-4 flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 rounded-xl">
                        <Star className="w-4 h-4 text-amber-500 shrink-0" />
                        <div>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">מלך שערים</p>
                          <p className="font-bold text-sm text-slate-900 dark:text-white">{topScorer.first_name} {topScorer.last_name} — {topScorer.goals} שערים</p>
                        </div>
                      </div>
                    )}

                    <h4 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">סגל ({tp.length})</h4>
                    <div className="space-y-1">
                      {tp.sort((a, b) => (b.goals || 0) - (a.goals || 0)).map(player => (
                        <div key={player.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-sm">
                          <div className="flex items-center gap-2">
                            {player.is_core && <span className="w-1.5 h-1.5 rounded-full bg-brand" />}
                            <span className="font-medium text-slate-900 dark:text-white">{player.first_name} {player.last_name}</span>
                            {player.jersey_number && <span className="text-[10px] text-slate-400 font-mono">#{player.jersey_number}</span>}
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${player.position === 'Goalkeeper' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                              {player.position === 'Goalkeeper' ? 'GK' : 'FP'}
                            </span>
                            {player.is_referee && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">REF</span>}
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            {(player.goals || 0) > 0 && <span dir="ltr" className="inline-flex items-center gap-0.5 font-bold text-emerald-600 dark:text-emerald-400"><span>{player.goals}</span><span>⚽</span></span>}
                            <span className="text-slate-400">{player.games_played || 0} מש׳</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Link to={entityPath('teams', team)} className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-brand dark:text-brand-light hover:text-brand-hover dark:hover:text-brand-light py-2.5 border border-brand/10 dark:border-brand/25 rounded-lg transition-colors">
                      עמוד הקבוצה המלא <ArrowLeft className="w-3.5 h-3.5" />
                    </Link>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
      )}
    </div>
  )
}
