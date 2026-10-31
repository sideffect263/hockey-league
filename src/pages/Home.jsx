import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getTeams, getGames, getPlayers, getLeagueSetting } from "@/lib/api"
import { standingsComparator } from "@/lib/utils"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { RefreshCw } from "lucide-react"
import { TeamIcon, GoalIcon } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import FinalFourBracket from "@/components/FinalFourBracket"
import { useSeasonName } from "@/App"
import { StandingsSkeleton } from "@/components/skeletons/PageSkeletons"
import { entityPath } from "@/lib/slugs"
import { teamTint, edge, deep, teamIsLight } from "@/lib/flTeam"
import { CrestDisc, TeamBlend } from "@/components/fl/Floodlight"
import { FLTSegmented, FLTPlayerFace, FLTOgTag, rowWash, fmtDiff, INK_ON_LIGHT } from "@/components/fl/teams/FLTeamsKit"
import { rankScorers, tieNote, lastPlayedRound, teamForm, playerName } from "@/components/fl/teams/teamsData"

// The dev deployment says so on the page, so nobody mistakes it for the league's
// site — and the league's site must never say it. Decided from the hostname at
// runtime, NOT from a build flag: both environments build from the same commit,
// so anything baked in at build time ships to both.
const IS_DEV_SITE =
  typeof window !== 'undefined' && window.location.hostname !== 'rinkhockeyil.com'

// 2026-27 format (lib/playoffs.js): #1 goes straight to the semi-finals, #2–#7 play
// series 2v7 / 3v6 / 4v5 — every team is in the playoffs, so the only line is under #1.
const PLAYOFF_CUTOFF = 1

/**
 * טבלה (Floodlight Standings + Scorers boards): a קבוצות / מלכי השערים switch on the
 * phone, both side by side on a desktop. Teams: the leader on a hero card in its
 * colours, every row on a faint wash of its team colour, the "ישר לחצי הגמר" line,
 * recent form, "אם העונה נגמרת היום" pairs and the Final Four bracket. Scorers: a
 * podium (2nd on the RIGHT of 1st — RTL) and the rest; ties never cut, ranks shared.
 */
export default function Home() {
  const seasonName = useSeasonName()
  const [teams, setTeams] = useState([])
  const [games, setGames] = useState([])
  const [players, setPlayers] = useState([])
  const [championId, setChampionId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState("teams")

  useEffect(() => { loadTeams() }, [])

  const loadTeams = async () => {
    try {
      setLoading(true); setError(null)
      const [t, g] = await Promise.all([getTeams('points', false), getGames()])
      setTeams(t); setGames(g)
    } catch { setError("שגיאה בטעינת נתוני קבוצות") }
    finally { setLoading(false) }
    // Scorers and the Final Four are extras; a failure here must not blank the page.
    getPlayers('goals', false).then(setPlayers).catch(() => {})
    try { setChampionId(await getLeagueSetting('champion_team_id') || null) } catch { /* optional */ }
  }

  // The league table is senior only; youth-tournament teams have their own
  // standings on the tournament pages (they'd otherwise sit at 0 pts here).
  const seniorTeams = teams.filter(t => ageOf(t) === DEFAULT_AGE)
  const sorted = [...seniorTeams].sort(standingsComparator)
  const round = lastPlayedRound(games)

  if (loading) return <StandingsSkeleton />

  return (
    <div data-ff-connector-host className="relative px-3 pt-4 pb-8 sm:px-6 lg:px-8 max-w-6xl mx-auto">
      <header className="px-1 pb-3.5">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-[44px] font-extrabold leading-[1.05] text-fg-strong">טבלה</h1>
          {round ? <p className="pb-1.5 text-[13px] text-fg-muted">אחרי מחזור <span className="fl-num">{round}</span></p> : null}
        </div>
        {(seasonName || IS_DEV_SITE) && (
          <p className="text-[13px] text-fg-muted">
            {seasonName && <>דירוג קבוצות עונת <bdi dir="ltr">{seasonName}</bdi></>}{IS_DEV_SITE && ' · סביבת בדיקות'}
          </p>
        )}
      </header>

      {error && (
        <div className="card mb-4 p-4 flex items-center justify-between gap-3">
          <span className="text-fl-red text-sm font-semibold">{error}</span>
          <button onClick={loadTeams} className="btn-primary min-h-[44px] inline-flex items-center gap-1.5 px-4 text-sm">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> נסה שוב
          </button>
        </div>
      )}

      {/* Final Four — the full bracket, above the table (opens once #1 is certain) */}
      <div className="mb-5">
        <FinalFourBracket teams={teams} games={games} championId={championId} />
      </div>

      <FLTSegmented className="lg:hidden mb-4" label="תצוגה" value={tab} onChange={setTab}
        options={[["teams", "קבוצות"], ["scorers", "מלכי השערים"]]} />

      <div className="lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8 lg:items-start">
        <div className={tab === "teams" ? "" : "hidden lg:block"}>
          {sorted.length > 0 && <TeamsTable rows={sorted} games={games} />}
          {seniorTeams.length === 0 && !error && (
            <div className="card py-14 text-center">
              <TeamIcon className="w-12 h-12 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-fg-muted">אין קבוצות רשומות</h3>
            </div>
          )}
        </div>
        <div className={tab === "scorers" ? "" : "hidden lg:block"}>
          <h2 className="hidden lg:block text-[22px] font-extrabold text-fg-strong mb-3 px-1">מלכי השערים</h2>
          <Scorers players={players} teams={teams} />
        </div>
      </div>

      {/* Line linking the table-topper to its direct Final Four spot */}
      <FinalFourLink dep={`${sorted.length}:${championId || ""}`} />
    </div>
  )
}

/* ------------------------------------------------------------------ teams */

function TeamsTable({ rows, games }) {
  const leader = rows[0]
  const leaderPts = Math.max(1, ...rows.map(t => t.points || 0))
  return (
    <div>
      <LeaderCard team={leader} rows={rows} />

      <div aria-hidden="true" className="flex items-center px-[14px] pb-1.5 pt-3.5 text-[11px] font-semibold text-fg-muted">
        <span className="w-[30px]" />
        <span className="flex-1">קבוצה</span>
        <span className="hidden sm:block w-10 text-center">מש׳</span>
        <span className="w-[58px] text-center">נ–ת–ה</span>
        <span className="hidden sm:block w-10 text-center">זכות</span>
        <span className="hidden sm:block w-10 text-center">חובה</span>
        <span className="w-[42px] text-center">הפרש</span>
        <span className="w-[78px] text-left">נקודות</span>
      </div>

      <ol className="flex flex-col gap-1.5" aria-label="טבלת הליגה">
        {rows.map((t, i) => (
          <li key={t.id}>
            <TeamRow team={t} rank={i + 1} leaderPts={leaderPts} games={games} />
            {i + 1 === PLAYOFF_CUTOFF && i + 1 < rows.length && (
              <div className="flex items-center gap-2 h-[22px] px-[14px]" aria-hidden="true">
                <span className="w-3.5 border-t-[1.5px] border-fg-muted/60" />
                <span className="text-[12px] font-semibold text-fg-muted">ישר לחצי הגמר</span>
                <span className="flex-1 border-t-[1.5px] border-dashed border-fg-muted/60" />
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="px-2 pt-2.5 text-[11px] text-fg-muted">
        מקום 1 עולה ישר לחצי הגמר · 2–7 בסדרות: 2 מול 7, 3 מול 6, 4 מול 5
      </p>

      {rows.length >= 7 && <Pairs rows={rows} />}
    </div>
  )
}

function LeaderCard({ team: t, rows }) {
  if (!t) return null
  const light = teamIsLight(t)
  const ink = light ? INK_ON_LIGHT : "#FFFFFF"
  const tied = rows.slice(1).filter(r => (r.points || 0) === (t.points || 0)).map(r => r.name)
  const gd = (t.goals_for || 0) - (t.goals_against || 0)
  return (
    <Link to={entityPath('teams', t)} aria-label={`מקום 1: ${t.name}, ${t.points || 0} נקודות`}
      className="relative flex items-center gap-3 rounded-[24px] p-5 overflow-hidden fl-fade-in"
      style={{ backgroundImage: `linear-gradient(225deg, ${edge(t)} 0%, ${deep(t)} 100%)`, color: ink }}>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span className="text-[12px] font-bold" style={{ color: light ? INK_ON_LIGHT : "rgb(var(--fl-accent))" }}>מקום 1</span>
        <span className="text-[30px] font-extrabold leading-[1.05] line-clamp-2">{t.name}</span>
        <span className="flex items-baseline gap-3.5 mt-1 flex-wrap">
          <span><span className="fl-num text-[40px]">{t.points || 0}</span> <span className="text-[13px] opacity-80">נק׳</span></span>
          <span className="text-[13px] opacity-85">{t.wins || 0} ניצחונות · <bdi dir="ltr">{fmtDiff(gd)}</bdi></span>
        </span>
        {tied.length > 0 && <span className="text-[12px] opacity-75">שווה נקודות עם {tied.join(", ")}</span>}
      </div>
      <CrestDisc team={t} size={112} shadow className="max-[379px]:!size-[84px]" />
    </Link>
  )
}

function TeamRow({ team: t, rank, leaderPts, games }) {
  const tint = teamTint(t)
  const pct = Math.min(1, Math.max(0, (t.points || 0) / leaderPts))
  const gd = (t.goals_for || 0) - (t.goals_against || 0)
  const played = (t.wins || 0) + (t.losses || 0) + (t.ties || 0)
  const form = teamForm(games, t.id)
  return (
    <Link to={entityPath('teams', t)} data-ff-anchor={rank === 1 ? "table-first" : undefined}
      aria-label={`מקום ${rank}: ${t.name}, ${t.points || 0} נקודות, ${t.wins || 0} ניצחונות, ${t.ties || 0} תיקו, ${t.losses || 0} הפסדים, הפרש ${fmtDiff(gd)}, ${played} משחקים`}
      className="block rounded-2xl bg-surface px-[14px] py-2 min-h-[62px] hover:brightness-[.98] dark:hover:brightness-110 transition"
      style={rowWash(tint, 0.16)}>
      <div className="flex items-center">
        <span className={`fl-num w-[30px] text-[24px] ${rank === 1 ? "text-fg-strong" : "text-fg-muted"}`}>{rank}</span>
        <span className="flex flex-1 min-w-0 items-center gap-2.5">
          <TeamLogo team={t} px={34} />
          <span className="line-clamp-2 leading-tight text-[15px] max-[379px]:text-[13px] font-bold text-fg-strong">{t.name}</span>
        </span>
        <span className="hidden sm:block w-10 text-center text-[13px] tabular-nums text-fg-muted">{played}</span>
        {/* Three pieces in a forced-RTL row: wins at the RIGHT under "נ". */}
        <span dir="rtl" className="w-[58px] flex justify-center gap-px text-[13px] tabular-nums text-fg-muted">
          <span>{t.wins || 0}</span><span>–</span><span>{t.ties || 0}</span><span>–</span><span>{t.losses || 0}</span>
        </span>
        <span className="hidden sm:block w-10 text-center text-[13px] tabular-nums text-fg-muted">{t.goals_for || 0}</span>
        <span className="hidden sm:block w-10 text-center text-[13px] tabular-nums text-fg-muted">{t.goals_against || 0}</span>
        <span dir="ltr" className="w-[42px] text-center text-[13px] font-semibold tabular-nums text-fg-strong">{fmtDiff(gd)}</span>
        <span className="w-[78px] flex items-center gap-1.5">
          <span className="relative h-1.5 flex-1 rounded-full bg-surface-sunken overflow-hidden" aria-hidden="true">
            <span className="absolute inset-y-0 right-0 rounded-full" style={{ width: `${Math.max(6, pct * 100)}%`, backgroundColor: tint }} />
          </span>
          <span className="fl-num min-w-[22px] text-left text-[26px] text-fg-strong">{t.points || 0}</span>
        </span>
      </div>
      {form.length > 0 && (
        <span className="flex gap-[3px] ps-[30px] pt-1" aria-hidden="true">
          {form.map((r, i) => (
            <span key={i} className={`h-1 w-3.5 rounded-sm ${r === 1 ? "bg-[#1B7A2A] dark:bg-[#3DBE58]" : r === -1 ? "bg-fl-red" : "bg-fg-muted/50"}`} />
          ))}
        </span>
      )}
    </Link>
  )
}

function Pairs({ rows }) {
  const seeds = [[2, 7], [3, 6], [4, 5]]
  return (
    <section aria-label="אם העונה נגמרת היום" className="mt-6">
      <h2 className="px-1.5 pb-2.5 text-[22px] font-extrabold text-fg-strong">אם העונה נגמרת היום</h2>
      <div className="flex flex-col gap-1.5">
        {seeds.map(([a, b]) => {
          const A = rows[a - 1], B = rows[b - 1]
          return (
            // The higher seed on the RIGHT (like home).
            <TeamBlend key={a} home={A} away={B} vignette={false}
              className="rounded-control min-h-[52px] px-3.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
              aria-label={`${a} מול ${b}: ${A.name} נגד ${B.name}`}>
              <span className="flex items-center gap-2.5 min-w-0">
                <CrestDisc team={A} size={34} />
                <span className="truncate text-[14px] font-bold">{A.name}</span>
              </span>
              <span className="text-[12px] opacity-85 px-1">{a} מול {b}</span>
              <span className="flex items-center gap-2.5 min-w-0 justify-end">
                <span className="truncate text-[14px] font-bold">{B.name}</span>
                <CrestDisc team={B} size={34} />
              </span>
            </TeamBlend>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ scorers */

function Scorers({ players, teams }) {
  const list = rankScorers(players, 10)
  const byId = Object.fromEntries(teams.map(t => [t.id, t]))
  if (list.length === 0) {
    return (
      <div className="card p-8 text-center">
        <GoalIcon className="w-10 h-10 mx-auto mb-2" />
        <p className="text-[15px] font-bold text-fg-strong">אין עדיין שערים</p>
        <p className="text-[13px] text-fg-muted mt-1">מלכי השערים יופיעו אחרי המחזור הראשון</p>
      </div>
    )
  }
  const podium = list.slice(0, 3)
  const rest = list.slice(3)
  const note = tieNote(list)
  return (
    <div>
      <Podium top={podium} byId={byId} />
      <ol className="mt-4 flex flex-col gap-1.5" aria-label="שאר מלכי השערים">
        {rest.map(e => <ScorerRow key={e.player.id} e={e} team={byId[e.player.team_id]} />)}
      </ol>
      {note && <p className="px-1.5 pt-3 text-[12px] text-fg-muted">{note}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link to="/players" className="btn-primary min-h-[44px] inline-flex items-center justify-center text-[15px]">כל השחקנים</Link>
        <Link to="/statistics" className="min-h-[44px] inline-flex items-center justify-center rounded-control bg-surface text-[15px] font-bold text-fg-strong hover:bg-surface-sunken">כל הסטטיסטיקות</Link>
      </div>
    </div>
  )
}

/**
 * Visual order, right to left: 2nd, 1st, 3rd. The grid is pinned LTR, so it is listed
 * 3rd, 1st, 2nd (2nd sat on the LEFT on iOS once, QA 10-28).
 */
function Podium({ top, byId }) {
  const order = top.length === 3 ? [top[2], top[0], top[1]] : top.length === 2 ? [top[0], top[1]].reverse() : top
  return (
    <section aria-label="שלושת הראשונים" dir="ltr" className="grid gap-2 items-end" style={{ gridTemplateColumns: `repeat(${order.length}, minmax(0,1fr))` }}>
      {order.map(e => <PodiumColumn key={e.player.id} e={e} team={byId[e.player.team_id]} first={e === top[0]} />)}
    </section>
  )
}

function PodiumColumn({ e, team, first }) {
  const p = e.player
  const light = team ? teamIsLight(team) : false
  const tint = team ? teamTint(team) : "#5B616B"
  const h = e.rank === 1 ? 150 : e.rank === 2 ? 118 : 96
  return (
    <Link dir="rtl" to={entityPath('players', p)} aria-label={`מקום ${e.rank}: ${playerName(p)}, ${p.goals} שערים`}
      className="flex flex-col items-center gap-2 min-w-0">
      <FLTPlayerFace player={p} team={team} size={first ? 96 : 76} ring={e.rank === 1 ? "rgb(var(--fl-accent))" : tint} ringWidth={3}
        className="max-[379px]:scale-90" />
      <span className="text-[14px] font-bold text-fg-strong text-center leading-tight line-clamp-2">{playerName(p)}</span>
      <span className="w-full flex flex-col items-center gap-0.5 pt-3 rounded-t-2xl rounded-b-md"
        style={{
          height: h,
          color: light ? INK_ON_LIGHT : "#FFFFFF",
          backgroundImage: light
            ? `linear-gradient(180deg, #FFFFFF, #A3A3A3)`
            : `linear-gradient(180deg, ${tint}, ${team ? deep(team) : "#141A24"})`,
        }}>
        <span className={`fl-num ${e.rank === 1 ? "text-[52px]" : "text-[40px]"}`}>{p.goals}</span>
        <span className="text-[11px] opacity-80">שערים</span>
        <span className="fl-num text-[18px] opacity-60 mt-1.5">{e.rank}</span>
      </span>
    </Link>
  )
}

function ScorerRow({ e, team }) {
  const p = e.player
  const tint = team ? teamTint(team) : "#5B616B"
  return (
    <li>
      <Link to={entityPath('players', p)} aria-label={`מקום ${e.rank}: ${playerName(p)}, ${team?.name || ""}, ${p.goals} שערים`}
        className="flex items-center gap-3 min-h-[64px] px-3.5 rounded-2xl bg-surface hover:brightness-[.98] dark:hover:brightness-110 transition"
        style={rowWash(tint, 0.14)}>
        <span className="fl-num w-[26px] text-[22px] text-fg-muted">{e.rank}</span>
        <FLTPlayerFace player={p} team={team} size={42} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[15px] font-bold text-fg-strong">{playerName(p)}</span>
            <FLTOgTag number={p.og_number} />
          </span>
          <span className="block truncate text-[12px] text-fg-muted">{team?.name || ""}</span>
        </span>
        <span className="fl-num text-[30px] text-fg-strong">{p.goals}</span>
      </Link>
    </li>
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
      // Once the playoffs grow panels BELOW the bracket (places 5–7, final ranking) the
      // line would cut straight through them — drop it then.
      const blocked = document.querySelector('[data-ff-blocks-link]')
      if (!host || !row || !dq || blocked || window.innerWidth < 1024) { setLine(null); return }
      const h = host.getBoundingClientRect()
      const r = row.getBoundingClientRect()
      const d = dq.getBoundingClientRect()
      const start = { x: r.right - h.left - 26, y: r.top - h.top }          // #1 rank (right edge in RTL)
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
    <svg className="pointer-events-none absolute inset-0 h-full w-full hidden lg:block text-fl-accent" style={{ zIndex: 20 }} aria-hidden="true">
      <circle cx={line.start.x} cy={line.start.y} r="3.5" fill="currentColor" />
      <path d={line.d} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
    </svg>
  )
}
