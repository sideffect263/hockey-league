import { useState, useEffect } from "react"
import { getTeams, getGames, getLeagueSetting } from "@/lib/api"
import { standingsComparator } from "@/lib/utils"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { Users, RefreshCw } from "lucide-react"
import { Standings } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import TeamLogo from "@/components/TeamLogo"
import { TeamLink } from "@/components/EntityLinks"
import FinalFourBracket from "@/components/FinalFourBracket"
import { useSeasonName } from "@/App"
import { StandingsSkeleton } from "@/components/skeletons/PageSkeletons"

// The dev deployment says so on the page, so nobody mistakes it for the league's
// site — and the league's site must never say it. Decided from the hostname at
// runtime, NOT from a build flag: both environments build from the same commit,
// so anything baked in at build time ships to both.
const IS_DEV_SITE =
  typeof window !== 'undefined' && window.location.hostname !== 'rinkhockeyil.com'

export default function Home() {
  const seasonName = useSeasonName()
  const [teams, setTeams] = useState([])
  const [games, setGames] = useState([])
  const [championId, setChampionId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => { loadTeams() }, [])

  const loadTeams = async () => {
    try {
      setLoading(true); setError(null)
      const [t, g] = await Promise.all([getTeams('points', false), getGames()])
      setTeams(t); setGames(g)
    } catch { setError("שגיאה בטעינת נתוני קבוצות") }
    finally { setLoading(false) }
    // The Final Four bracket is a nice-to-have; a failure here must not blank the page.
    try { setChampionId(await getLeagueSetting('champion_team_id') || null) } catch { /* optional */ }
  }

  const diff = (t) => (t.goals_for || 0) - (t.goals_against || 0)
  const played = (t) => (t.wins || 0) + (t.losses || 0) + (t.ties || 0)
  // The league table is senior only; youth-tournament teams have their own
  // standings on the tournament pages (they'd otherwise sit at 0 pts here).
  const seniorTeams = teams.filter(t => ageOf(t) === DEFAULT_AGE)
  const sorted = [...seniorTeams].sort(standingsComparator)
  const first = sorted[0] || null
  // Points bar under each team: the leader is always 100%, everyone else is
  // (their points / leader points), drawn right-anchored (RTL) in the team's colour.
  const leaderPts = first?.points || 0
  const pointsBarPct = (pts) => leaderPts > 0 ? Math.max(0, Math.min(100, ((pts || 0) / leaderPts) * 100)) : 0

  if (loading) return <StandingsSkeleton />

  return (
    <div data-ff-connector-host className="relative p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Standings className="size-8 text-brand shrink-0" />
          טבלת הליגה
        </h1>
        <p className="page-subtitle mt-1">דירוג קבוצות{seasonName && ` עונת ${seasonName}`}{IS_DEV_SITE && ' · סביבת בדיקות'}</p>
      </motion.div>

      {error && (
        <div className="card p-4 border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950/30 flex items-center justify-between">
          <span className="text-danger-700 dark:text-danger-400 text-sm font-medium">{error}</span>
          <button onClick={loadTeams} className="flex items-center gap-1.5 px-3 py-1.5 bg-danger-600 text-white rounded-lg text-xs font-semibold hover:bg-danger-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      )}

      {/* Final Four — the full bracket, above the table */}
      <FinalFourBracket teams={teams} games={games} championId={championId} />

      {/* League Table */}
      {sorted.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-brand-deep text-white text-[11px] uppercase tracking-wider">
                  <th scope="col" className="ps-4 pe-2 py-3 text-right font-bold w-12 whitespace-nowrap">#</th>
                  <th scope="col" className="px-3 py-3 text-right font-bold whitespace-nowrap">קבוצה</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">מש׳</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">נ</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">ת</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">ה</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">זכות</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">חובה</th>
                  <th scope="col" className="px-2 py-3 text-center font-bold whitespace-nowrap">הפרש</th>
                  <th scope="col" className="ps-2 pe-4 py-3 text-center font-bold whitespace-nowrap">נק׳</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {sorted.map((team, i) => {
                  const zone = i === 0 ? "ff" : i <= 6 ? "po" : "none"
                  // Qualification stripe. It MUST live on the first <td>, never the <tr>:
                  // a positioned ::before on a display:table-row is wrapped in an anonymous
                  // table-cell, adding a phantom column that shifts every body cell one column
                  // out of line with the header (invisible until the header had a background).
                  const stripe = zone === "ff" ? "before:bg-gold" : zone === "po" ? "before:bg-brand" : "before:bg-transparent"
                  const d = diff(team)
                  return (
                  <motion.tr
                    key={team.id}
                    data-ff-anchor={i === 0 ? "table-first" : undefined}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className={`group relative transition-colors ${
                      i === 0
                        ? "bg-gold/[0.08] hover:bg-gold/[0.14]"
                        : i % 2 === 0
                          ? "bg-surface-inset/40 hover:bg-surface-inset/80"
                          : "hover:bg-surface-inset/50"
                    }`}
                  >
                    <td className={`ps-4 pe-2 py-3 relative before:absolute before:inset-y-0 before:right-0 before:w-1 ${stripe}`}>
                      <div className={`grid size-7 place-items-center rounded-lg text-xs font-black tabular-nums ${
                        i === 0 ? "bg-gold text-surface-page" :
                        i <= 6 ? "bg-brand/[0.12] text-brand-strong dark:text-brand-light" :
                        "bg-surface-chip text-fg-muted"
                      }`}>
                        {i + 1}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TeamLogo team={team} size={8} />
                        <TeamLink team={team} className="font-bold text-fg-strong text-sm truncate hover:text-brand hover:underline underline-offset-2 decoration-brand/40 transition-colors">{team.name}</TeamLink>
                        {zone === "ff" && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold bg-gold/[0.15] text-gold">FF</span>}
                        {zone === "po" && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold bg-brand/[0.12] text-brand-strong dark:text-brand-light">PO</span>}
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center tabular-nums text-fg-muted">{played(team)}</td>
                    <td className="px-2 py-3 text-center tabular-nums font-bold text-pos">{team.wins || 0}</td>
                    <td className="px-2 py-3 text-center tabular-nums text-fg-subtle">{team.ties || 0}</td>
                    <td className="px-2 py-3 text-center tabular-nums font-bold text-neg">{team.losses || 0}</td>
                    <td className="px-2 py-3 text-center tabular-nums text-fg-muted">{team.goals_for || 0}</td>
                    <td className="px-2 py-3 text-center tabular-nums text-fg-muted">{team.goals_against || 0}</td>
                    <td className="px-2 py-3 text-center">
                      <span dir="ltr" className={`inline-block font-bold text-sm tabular-nums ${d > 0 ? "text-pos" : d < 0 ? "text-neg" : "text-fg-subtle"}`}>
                        {d > 0 ? "+" : ""}{d}
                      </span>
                    </td>
                    <td className="ps-2 pe-4 py-3 text-center">
                      <span className="stat-num text-lg text-brand">{team.points || 0}</span>
                      {/* Points bar — spans the FULL row width, pinned to the row's bottom edge. It sits in
                          this (static) cell but the <tr> is `relative`, so it measures against the whole row.
                          A ::before on the row itself would spawn a phantom table-cell and shift the columns.
                          Leader = full width, others scaled to points ratio; grows right→left (RTL). Inset
                          ring keeps even white/pale team colours visible. */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-fg/[0.06]" aria-hidden="true">
                        <div className="absolute inset-y-0 right-0 rounded-l-full ring-1 ring-inset ring-black/10 dark:ring-white/15 transition-[width] duration-500"
                             style={{ width: `${pointsBarPct(team.points || 0)}%`, backgroundColor: team.primary_color || "#94a3b8" }} />
                      </div>
                    </td>
                  </motion.tr>
                )})}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="px-4 py-3 bg-surface-inset border-t border-line-subtle flex gap-4 text-[11px] font-medium text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-gold" /> Final Four ישיר</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-brand" /> פלייאוף</span>
          </div>
        </motion.div>
      )}

      {seniorTeams.length === 0 && !error && (
        <div className="text-center py-16">
          <Users className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="text-lg font-semibold text-slate-500 dark:text-slate-400">אין קבוצות רשומות</h3>
        </div>
      )}

      {/* Line linking the table-topper to its direct Final Four spot */}
      <FinalFourLink dep={`${sorted.length}:${championId || ""}`} />
    </div>
  )
}

// A gold connector drawn from the #1 team's row in the standings table up to its
// direct-entry card in the Final Four bracket — topping the table earns the bye.
// Desktop only (on mobile the bracket is a single stacked column, where the line
// would just be noise). Positions are measured live so it survives layout changes.
function FinalFourLink({ dep }) {
  const [line, setLine] = useState(null)
  useEffect(() => {
    const compute = () => {
      const host = document.querySelector('[data-ff-connector-host]')
      const row = document.querySelector('[data-ff-anchor="table-first"]')
      const dq = [...document.querySelectorAll('[data-ff-anchor="direct-qualifier"]')]
        .find(el => el.getBoundingClientRect().width > 0)
      if (!host || !row || !dq || window.innerWidth < 1024) { setLine(null); return }
      const h = host.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      const d = dq.getBoundingClientRect()
      const start = { x: r.right - h.left - 26, y: r.top - h.top }          // #1 rank badge (right edge in RTL)
      const end = { x: d.left + d.width / 2 - h.left, y: d.bottom - h.top } // direct-qualifier card, bottom-centre
      const bend = Math.min(48, Math.max(16, (start.y - end.y) / 2))
      setLine({
        d: `M ${start.x} ${start.y} C ${start.x} ${start.y - bend}, ${end.x} ${end.y + bend}, ${end.x} ${end.y}`,
        start,
      })
    }
    compute()
    const host = document.querySelector('[data-ff-connector-host]')
    const ro = new ResizeObserver(compute)
    if (host) ro.observe(host)
    window.addEventListener("resize", compute)
    const t = setTimeout(compute, 700) // let entrance animations settle first
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); clearTimeout(t) }
  }, [dep])

  if (!line) return null
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full hidden lg:block text-gold" style={{ zIndex: 20 }} aria-hidden="true">
      <circle cx={line.start.x} cy={line.start.y} r="3.5" fill="currentColor" />
      <path d={line.d} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
    </svg>
  )
}
