import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getTeams, getMyTeamRequests } from "@/lib/api"
import { standingsComparator } from "@/lib/utils"
import { AGE_GROUPS, DEFAULT_AGE, AGE_LABEL, ageOf, ageGroupsOf } from "@/lib/ageGroups"
import { useAuth } from "@/lib/AuthContext"
import CreateTeamModal from "@/components/CreateTeamModal"
import { RefreshCw, ChevronLeft, Plus } from "lucide-react"
import { LikeOn as Heart, Hourglass, TeamsIcon, BrandTile } from "@/components/icons/BrandIcons"
import { getFollowerCounts, fansLabel } from "@/lib/follows"
import { teamTint } from "@/lib/flTeam"
import { FLTPills, FLTTag, rowWash } from "@/components/fl/teams/FLTeamsKit"
import TeamLogo from "@/components/TeamLogo"
import { useSeasonName } from "@/App"
import { entityPath } from "@/lib/slugs"
import { TeamsSkeleton } from "@/components/skeletons/PageSkeletons"

export default function Teams() {
  const { profile } = useAuth()
  const seasonName = useSeasonName()
  const isLinkedPlayer = !!profile?.player_id
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ageTab, setAgeTab] = useState(DEFAULT_AGE)
  const [showCreate, setShowCreate] = useState(false)
  const [myPending, setMyPending] = useState([])
  // Real fans per team (the team's own players are not counted — fans-v2.sql).
  const [fans, setFans] = useState({})

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (isLinkedPlayer) refreshMyRequests() }, [isLinkedPlayer])

  const refreshMyRequests = async () => {
    try { const r = await getMyTeamRequests(); setMyPending(r.filter(t => t.status === 'pending')) }
    catch { /* ignore */ }
  }

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const list = await getTeams()
      setTeams(list)
      getFollowerCounts('team', list.map(t => t.id)).then(setFans).catch(() => {})
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
  const countByAge = teams.reduce((acc, t) => { for (const a of ageGroupsOf(t)) acc[a] = (acc[a] || 0) + 1; return acc }, {})
  const visible = teams.filter(t => ageGroupsOf(t).includes(ageTab))
  const sorted = isSenior
    ? [...visible].sort(standingsComparator)
    : [...visible].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))

  // "Most-supported" board: only teams that actually have fans, top 5.
  const fanBoard = visible
    .map(t => ({ team: t, n: fans[t.id] || 0 }))
    .filter(r => r.n > 0)
    .sort((a, b) => b.n - a.n || (a.team.name || '').localeCompare(b.team.name || '', 'he'))
    .slice(0, 5)

  return (
    <div className="px-3 pt-4 pb-8 sm:px-6 lg:px-8 max-w-5xl mx-auto space-y-3">
      <header className="flex items-center justify-between gap-2.5 px-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandTile name="team" className="w-11 h-11 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[28px] font-extrabold leading-tight text-fg-strong">קבוצות</h1>
            <p className="text-[13px] text-fg-muted">
              {isSenior
                ? <>{visible.length} קבוצות בליגה{seasonName && <> · עונת <bdi dir="ltr">{seasonName}</bdi></>}</>
                : `${visible.length} קבוצות · ${AGE_LABEL[ageTab]}`}
            </p>
          </div>
        </div>
        {isLinkedPlayer && (
          <button onClick={() => setShowCreate(true)}
            className="btn-primary shrink-0 min-h-[44px] inline-flex items-center gap-1.5 px-3.5 text-[14px]">
            <Plus className="w-4 h-4" aria-hidden="true" /> צור קבוצה
          </button>
        )}
      </header>

      {myPending.length > 0 && (
        <div className="rounded-2xl px-3.5 py-3 flex items-center gap-2.5 bg-[#F6EBD3] dark:bg-[#3A2E14]">
          <Hourglass className="w-7 h-7 shrink-0" />
          <p className="text-[13px] font-semibold text-[#7A5200] dark:text-[#F2D08A]">
            הקבוצה "{myPending[0].name}" ממתינה לאישור מנהל הליגה
          </p>
        </div>
      )}

      {showCreate && (
        <CreateTeamModal onClose={() => setShowCreate(false)} onCreated={refreshMyRequests} />
      )}

      {/* age-group tabs: the senior league + youth-tournament age categories */}
      <FLTPills label="גיל" value={ageTab} onChange={setAgeTab}
        items={AGE_GROUPS.map(a => ({ value: a.value, label: a.label, count: countByAge[a.value] || 0 }))} />

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-4 lg:items-start space-y-3 lg:space-y-0">
      {fanBoard.length > 0 && (
        <section aria-label="הכי הרבה אוהדים" className="rounded-[18px] bg-surface p-3.5 lg:order-2 lg:sticky lg:top-20">
          <h2 className="flex items-center gap-2 mb-2.5 text-[15px] font-extrabold text-fg-strong">
            <Heart className="w-6 h-6" /> הכי הרבה אוהדים
          </h2>
          <ol className="flex gap-1.5 overflow-x-auto nav-scroll -mx-1 px-1 lg:flex-col lg:overflow-visible">
            {fanBoard.map((r, i) => (
              <li key={r.team.id} className="shrink-0">
                <Link to={entityPath('teams', r.team)}
                  className="flex items-center gap-1.5 min-h-[44px] ps-2 pe-3 rounded-control bg-surface-page hover:bg-surface-sunken transition-colors">
                  <span className="fl-num text-[12px] text-fg-muted w-3 text-center">{i + 1}</span>
                  <TeamLogo team={r.team} px={24} disc={false} />
                  <span className="text-[12.5px] font-bold text-fg-strong max-w-[9rem] truncate lg:max-w-none lg:flex-1">{r.team.name}</span>
                  <span className="text-[12.5px] font-extrabold text-[#C2185B] dark:text-[#F06292] tabular-nums">{r.n}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-card bg-surface p-10 flex flex-col items-center text-center gap-2 lg:order-1">
          <TeamsIcon className="w-9 h-9" />
          <p className="text-sm font-semibold text-fg-muted">אין קבוצות בקטגוריה זו עדיין</p>
          {!isSenior && <p className="text-xs text-fg-muted">קבוצות {AGE_LABEL[ageTab]} מתווספות דרך מסך הניהול</p>}
        </div>
      ) : (
      <ol className="flex flex-col gap-2 lg:order-1" aria-label="קבוצות">
        {sorted.map((team, index) => {
          const tint = teamTint(team)
          return (
            <li key={team.id}>
              {/* One tap opens the team page — the row used to expand inline first. */}
              <Link to={entityPath('teams', team)}
                className="flex items-center gap-3 rounded-[18px] bg-surface px-3.5 py-3 hover:brightness-[.98] dark:hover:brightness-110 transition"
                style={rowWash(tint, 0.19, 42)}>
                <span className="shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${tint}` }}>
                  <TeamLogo team={team} px={56} />
                </span>
                <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[16px] font-extrabold text-fg-strong truncate">{team.name}</span>
                    {isSenior && <FLTTag className="text-fg-muted">#{index + 1}</FLTTag>}
                    {!isSenior && <FLTTag>{AGE_LABEL[ageTab]}</FLTTag>}
                  </span>
                  <span className="text-[12.5px] text-fg-muted truncate">
                    {[team.city, team.founded_year].filter(Boolean).join(' · ')}
                    {fans[team.id] > 0 && (
                      <span className="inline-flex items-center gap-0.5 ms-1.5 align-middle font-bold text-[#C2185B] dark:text-[#F06292]">
                        <Heart className="w-4 h-4" /> <span className="tabular-nums">{fansLabel(fans[team.id])}</span>
                      </span>
                    )}
                  </span>
                  {isSenior && (
                    <span className="flex items-center gap-2 mt-0.5">
                      <span className="text-[12px] font-extrabold px-2.5 py-[3px] rounded-full bg-fg-strong text-surface"><span className="tabular-nums">{team.points || 0}</span> נק׳</span>
                      <span className="text-[12px] text-fg-muted tabular-nums">
                        <b className="text-[#1B7A2A] dark:text-[#4CC765]">{team.wins || 0}</b>נ <b className="text-fg-strong">{team.ties || 0}</b>ת <b className="text-fl-red dark:text-[#FF6B60]">{team.losses || 0}</b>ה
                      </span>
                    </span>
                  )}
                </span>
                <ChevronLeft className="w-5 h-5 text-fg-muted shrink-0" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ol>
      )}
      </div>
    </div>
  )
}
