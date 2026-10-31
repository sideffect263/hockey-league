import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getPlayers, getTeams } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { Search, RefreshCw } from "lucide-react"
import { Profile, BrandTile } from "@/components/icons/BrandIcons"
import { RoleBadge, deriveRoleItems } from "@/components/RoleBadges"
import { teamTint } from "@/lib/flTeam"
import { FLTPlayerFace, FLTOgTag, FLTTag, KeeperStickMark, isKeeper } from "@/components/fl/teams/FLTeamsKit"
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

  const chipSel = "filter-select appearance-none min-h-[44px] rounded-full ps-4 pe-9 text-[13.5px] font-bold border border-line bg-surface text-fg-strong bg-no-repeat"
  const chevron = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235B616B' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundPosition: "left 14px center" }

  return (
    <div className="px-3 pt-4 pb-8 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-3">
      <header className="flex items-center gap-2.5 px-1">
        <BrandTile name="player-pose-1" className="w-11 h-11 shrink-0" />
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight text-fg-strong">שחקנים</h1>
          <p className="text-[13px] text-fg-muted"><span className="tabular-nums">{seniorPlayers.length}</span> שחקנים בליגה</p>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-2.5 lg:items-center">
        <label className="relative flex-1 flex items-center gap-2 min-h-[48px] rounded-2xl bg-surface border border-line px-3.5">
          <Search className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
          <span className="sr-only">חיפוש שחקן</span>
          <input type="text" placeholder="חיפוש שחקן…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-fg-strong placeholder:text-fg-muted" />
        </label>
        {/* aria-label on every filter: with none, a screen reader announces only the
            selected option ("כל הקבוצות") and never what the control filters. */}
        <div className="flex gap-1.5 overflow-x-auto nav-scroll -mx-1 px-1">
          <select aria-label="סינון לפי קבוצה" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
            className={`${chipSel} ${teamFilter !== "all" ? "!bg-fg-strong !text-surface !border-fg-strong" : ""}`} style={chevron}>
            <option value="all">כל הקבוצות</option>
            {seniorTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select aria-label="סינון לפי עמדה" value={positionFilter} onChange={e => setPositionFilter(e.target.value)}
            className={`${chipSel} ${positionFilter !== "all" ? "!bg-fg-strong !text-surface !border-fg-strong" : ""}`} style={chevron}>
            <option value="all">כל העמדות</option>
            <option value="Field Player">שחקן שדה</option>
            <option value="Goalkeeper">שוער</option>
          </select>
          <select aria-label="מיון השחקנים" value={sortBy} onChange={e => setSortBy(e.target.value)}
            className={`${chipSel} !bg-fg-strong !text-surface !border-fg-strong`} style={chevron}>
            <option value="goals">מיון: שערים</option>
            <option value="games">מיון: משחקים</option>
            <option value="name">מיון: שם</option>
          </select>
        </div>
      </div>

      {/* Players */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {filtered.map((player) => {
          const team = teamsMap[player.team_id]
          const keeper = isKeeper(player)
          return (
            <li key={player.id}>
              <Link to={entityPath('players', player)} className="block h-full rounded-[18px] bg-surface p-3 hover:brightness-[.98] dark:hover:brightness-110 transition">
                <div className="flex items-center gap-3">
                  <FLTPlayerFace player={player} team={team} size={46} ring={team ? teamTint(team) : undefined} />
                  <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h2 className="text-[15.5px] font-extrabold text-fg-strong truncate">{player.first_name} {player.last_name}</h2>
                      {keeper && <KeeperStickMark size={20} />}
                      <FLTOgTag number={player.og_number} />
                    </div>
                    <p className="text-[12.5px] text-fg-muted truncate">
                      {(() => {
                        const ids = [...(teamsByPlayer.get(player.id) || [])]
                        const names = ids.map(tid => teamsMap[tid]?.name).filter(Boolean)
                        return names.length ? names.join(' · ') : teamName(player.team_id)
                      })()}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <FLTTag className={keeper ? "bg-fg-strong !text-surface" : ""}>{keeper ? "שוער" : "שחקן שדה"}</FLTTag>
                      {player.is_core && <FLTTag className="bg-fl-accent/25">סגל קבוע</FLTTag>}
                      {(() => {
                        const roles = player.role_badges ? deriveRoleItems(player.role_badges) : []
                        // The account's referee badge already says שופט — no second tag.
                        const refBadge = roles.some(it => it.role === "judge" || it.role === "referee")
                        return <>
                          {player.is_referee && !refBadge && <FLTTag>שופט</FLTTag>}
                          {roles.map(it => <RoleBadge key={it.role} role={it.role} size="sm" />)}
                        </>
                      })()}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                  {[
                    { val: player.goals || 0, label: "שערים", color: "text-[#1B7A2A] dark:text-[#4CC765]" },
                    { val: player.games_played || 0, label: "משחקים", color: "text-fg-strong" },
                    { val: player.blue_cards || 0, label: "כחולים", color: "text-[#2560C4] dark:text-[#6EA0FF]" },
                    { val: player.red_cards || 0, label: "אדומים", color: "text-fl-red dark:text-[#FF6B60]" },
                  ].map(({ val, label, color }) => (
                    <span key={label} className="rounded-[10px] bg-surface-page py-[7px] flex flex-col items-center gap-0.5">
                      <span className={`fl-num text-[17px] ${color}`}>{val}</span>
                      <span className="text-[10.5px] text-fg-muted">{label}</span>
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Profile className="w-12 h-12 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-fg-muted">אין שחקנים תואמים</h2>
        </div>
      )}
    </div>
  )
}
