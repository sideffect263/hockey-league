import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getPlayers, getTeams } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { UserCheck, Search, RefreshCw } from "lucide-react"
import { Player as PlayerIcon } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import PlayerAvatar from "@/components/PlayerAvatar"
import { entityPath } from "@/lib/slugs"
import { PlayersSkeleton } from "@/components/skeletons/PageSkeletons"

export default function Players() {
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [playerTeams, setPlayerTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState("")
  const [teamFilter, setTeamFilter] = useState("all")
  const [positionFilter, setPositionFilter] = useState("all")
  const [sortBy, setSortBy] = useState("goals")

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [p, t, pt] = await Promise.all([getPlayers(), getTeams(), getPlayerTeams().catch(() => [])])
      setPlayers(p); setTeams(t); setPlayerTeams(pt)
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const teamName = (id) => teamsMap[id]?.name || '—'
  const { byTeam: membersByTeam, byPlayer: teamsByPlayer } = buildMemberMaps(playerTeams, players)

  // This is the senior-league directory. Youth-tournament players (whose primary
  // team is a youth team) are browsed via the Teams page age tabs, not here.
  // Free agents (no team) count as senior. team_id is senior-preferred, so a
  // player on both a senior and a youth team still shows.
  const seniorTeams = teams.filter(t => ageOf(t) === DEFAULT_AGE)
  const seniorPlayers = players.filter(p => ageOf(teamsMap[p.team_id]) === DEFAULT_AGE)

  const filtered = seniorPlayers
    .filter(p => {
      if (search && !`${p.first_name} ${p.last_name}`.includes(search)) return false
      if (teamFilter !== "all" && !membersByTeam.get(teamFilter)?.has(p.id)) return false
      if (positionFilter !== "all" && p.position !== positionFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === "goals") return (b.goals || 0) - (a.goals || 0)
      if (sortBy === "games") return (b.games_played || 0) - (a.games_played || 0)
      if (sortBy === "name") return a.first_name.localeCompare(b.first_name)
      return 0
    })

  if (loading) return <PlayersSkeleton />

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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <PlayerIcon className="w-7 h-7 text-brand" /> שחקנים
        </h1>
        <p className="page-subtitle mt-1">{seniorPlayers.length} שחקנים בליגה</p>
      </motion.div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" placeholder="חיפוש שחקן..." aria-label="חיפוש שחקן" value={search} onChange={e => setSearch(e.target.value)}
            className="filter-input w-full pr-10" />
        </div>
        {/* aria-label on every filter: with none, a screen reader announces only the
            selected option ("כל הקבוצות") and never what the control filters. */}
        <select aria-label="סינון לפי קבוצה" value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className="filter-select">
          <option value="all">כל הקבוצות</option>
          {seniorTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select aria-label="סינון לפי עמדה" value={positionFilter} onChange={e => setPositionFilter(e.target.value)} className="filter-select">
          <option value="all">כל העמדות</option>
          <option value="Field Player">שחקן שדה</option>
          <option value="Goalkeeper">שוער</option>
        </select>
        <select aria-label="מיון השחקנים" value={sortBy} onChange={e => setSortBy(e.target.value)} className="filter-select">
          <option value="goals">שערים</option>
          <option value="games">משחקים</option>
          <option value="name">שם</option>
        </select>
      </div>

      {/* Players Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((player, index) => (
          <Link key={player.id} to={entityPath('players', player)} className="block">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.02, 0.4) }}
            className="card-hover p-4 h-full"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3 min-w-0">
                <PlayerAvatar player={player} team={teamsMap[player.team_id]} size={12} />
                <div className="min-w-0">
                  <h2 className="font-bold text-sm text-slate-900 dark:text-white truncate">{player.first_name} {player.last_name}</h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {(() => {
                      const ids = [...(teamsByPlayer.get(player.id) || [])]
                      const names = ids.map(tid => teamsMap[tid]?.name).filter(Boolean)
                      return names.length ? names.join(' · ') : teamName(player.team_id)
                    })()}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${player.position === 'Goalkeeper' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                  {player.position === 'Goalkeeper' ? 'GK' : 'FP'}
                </span>
                {player.is_core && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light">C</span>}
                {player.is_referee && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">R</span>}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[
                { val: player.goals || 0, label: "שערים", color: "text-emerald-600 dark:text-emerald-400" },
                { val: player.games_played || 0, label: "משחקים", color: "text-slate-700 dark:text-slate-300" },
                { val: player.blue_cards || 0, label: "כחולים", color: "text-blue-600 dark:text-blue-400" },
                { val: player.red_cards || 0, label: "אדומים", color: "text-red-500 dark:text-red-400" },
              ].map(({ val, label, color }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg py-2 text-center">
                  <p className={`text-base font-extrabold ${color}`}>{val}</p>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">{label}</p>
                </div>
              ))}
            </div>
          </motion.div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <UserCheck className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h2 className="text-lg font-semibold text-slate-500 dark:text-slate-400">אין שחקנים תואמים</h2>
        </div>
      )}
    </div>
  )
}
