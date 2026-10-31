import { useState, useEffect, lazy, Suspense } from "react"
import { useParams, Link } from "react-router-dom"
import {
  getArchivedSeasons, getArchivedStandings,
  getArchivedPlayerStats, getArchivedGames
} from "@/lib/api"
import { Archive, ChevronLeft, RefreshCw } from "lucide-react"
import { FLScore } from "@/components/fl/Floodlight"
import { FLTPills, fmtDiff } from "@/components/fl/teams/FLTeamsKit"
import { Trophy, BrandTile } from "@/components/icons/BrandIcons"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { useSlugId } from "@/lib/slugs"
import { ArchiveSkeleton, ArchiveSeasonSkeleton, StatisticsSkeleton } from "@/components/skeletons/PageSkeletons"
import { ilDate } from "@/lib/ilTime"

// The live /statistics page, run on this season's archived data (its own chunk).
const SeasonStatistics = lazy(() => import("./Statistics"))

export default function ArchivePage() {
  // /archive/2025-26, or the season's UUID for any older link.
  const { seasonId: routeKey } = useParams()

  if (routeKey) return <SeasonDetail routeKey={routeKey} />
  return <SeasonsList />
}

function SeasonsList() {
  const [seasons, setSeasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadSeasons = () => {
    setLoading(true); setError(null)
    getArchivedSeasons()
      .then(setSeasons)
      .catch((err) => { console.error(err); setError("שגיאה בטעינת הנתונים") })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSeasons() }, [])

  if (loading) return <ArchiveSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={loadSeasons} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="flex items-center gap-2.5 text-[28px] font-extrabold leading-tight text-fg-strong">
          <BrandTile name="trophy" className="w-11 h-11" /> ארכיון
        </h1>
        <p className="text-[13px] text-fg-muted mt-1">צפייה בנתוני עונות קודמות · בכל מקום באתר: תג העונה בסרגל העליון פותח את רשימת העונות</p>
      </motion.div>

      {seasons.length === 0 ? (
        <div className="text-center py-16">
          <Archive className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h2 className="text-lg font-semibold text-slate-500 dark:text-slate-400">אין עונות בארכיון</h2>
          <p className="text-sm text-slate-400 mt-1">עונות שהסתיימו יופיעו כאן</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {seasons.map((season, i) => (
            <motion.div key={season.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link to={`/archive/${encodeURIComponent(season.slug || season.id)}`} className="block rounded-[18px] bg-surface p-4 hover:brightness-[.98] dark:hover:brightness-110 transition">
                <div className="flex items-center gap-4">
                  <div className="size-12 rounded-[14px] bg-fl-accent/25 flex items-center justify-center">
                    <Trophy className="w-8 h-8" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-[18px] font-extrabold text-fg-strong">עונת <bdi dir="ltr">{season.name}</bdi></h2>
                    <p className="text-[12.5px] text-fg-muted mt-0.5">טבלה סופית, מלכי השערים וכל המשחקים · אורכבה {new Date(season.archived_at).toLocaleDateString('he-IL')}</p>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-fg-muted" aria-hidden="true" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

function SeasonDetail({ routeKey }) {
  // Everything below still works in season UUIDs; only the URL changed.
  const { id: seasonId, notFound: unknownSeason } = useSlugId('seasons', routeKey)
  const [season, setSeason] = useState(null)
  const [standings, setStandings] = useState([])
  const [playerStats, setPlayerStats] = useState([])
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState("standings")

  const loadSeason = () => {
    setLoading(true); setError(null)
    Promise.all([
      getArchivedSeasons(),
      getArchivedStandings(seasonId),
      getArchivedPlayerStats(seasonId),
      getArchivedGames(seasonId)
    ])
      .then(([seasons, st, ps, gm]) => {
        setSeason(seasons.find(s => s.id === seasonId))
        setStandings(st)
        setPlayerStats(ps)
        setGames(gm)
      })
      .catch((err) => { console.error(err); setError("שגיאה בטעינת הנתונים") })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (seasonId) loadSeason()
    else if (unknownSeason) { setError('העונה לא נמצאה'); setLoading(false) }
  }, [seasonId, unknownSeason])

  if (loading) return <ArchiveSeasonSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={loadSeason} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  // Team slug + crest per team_id, read off the season's games (the RPC resolves
  // them even for clubs that have since folded) — standings rows carry neither.
  const teamInfo = {}
  for (const g of games) {
    if (g.home_team_id) teamInfo[g.home_team_id] = { name: g.home_team_name, slug: g.home_team_slug, logo_url: g.home_logo_url }
    if (g.away_team_id) teamInfo[g.away_team_id] = { name: g.away_team_name, slug: g.away_team_slug, logo_url: g.away_logo_url }
  }
  const teamOf = (id, name) => ({ name, ...(teamInfo[id] || {}) })
  const teamHref = (id) => teamInfo[id]?.slug ? `/teams/${encodeURIComponent(teamInfo[id].slug)}` : null

  const fieldPlayers = playerStats.filter(p => p.position === 'Field Player')
  const topScorer = fieldPlayers[0]
  const completed = games.filter(g => g.status === 'completed' && g.home_score != null)
  const totalGoals = completed.reduce((n, g) => n + (g.home_score || 0) + (g.away_score || 0), 0)
  const champion = standings[0]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      {/* You are in the past: the palette already says so; this says it in words. */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface px-4 py-2.5 ring-1 ring-brand/30">
        <p className="text-sm font-semibold text-fg-strong">
          את/ה צופה בעונת {season?.name} — עונה שהסתיימה
        </p>
        <Link to="/standings" className="min-h-[44px] inline-flex items-center text-[13px] font-bold text-fg-strong underline underline-offset-2">
          חזרה לעונה הנוכחית ←
        </Link>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Link to="/archive" className="min-h-[44px] inline-flex items-center text-[13px] font-bold text-fg-strong hover:underline">
          ← כל העונות
        </Link>
        <h1 className="flex items-center gap-2.5 text-[28px] sm:text-[36px] font-extrabold leading-tight text-fg-strong">
          <BrandTile name="trophy" className="w-11 h-11 -my-1.5" /> עונת <bdi dir="ltr">{season?.name}</bdi>
        </h1>
        <p className="text-[13px] text-fg-muted mt-1">טבלה סופית, מלכי השערים וכל המשחקים של העונה</p>
      </motion.div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {/* The champion on the amber card (board FinalFourArchive). */}
        <div className="col-span-2 rounded-card p-4 flex items-center gap-3 text-[#11161D]" style={{ backgroundImage: "linear-gradient(135deg, #F2B233, #C98A12)" }}>
          <Trophy className="w-12 h-12 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-extrabold">אלופת הליגה</p>
            <p className="text-[22px] font-black leading-tight truncate">{champion?.team_name || '—'}</p>
          </div>
          {champion && <TeamLogo team={teamOf(champion.team_id, champion.team_name)} px={58} />}
        </div>
        <div className="rounded-[18px] bg-surface p-3.5 flex flex-col">
          <p className="fl-num text-[30px] text-fg-strong">{completed.length}</p>
          <p className="text-[12.5px] text-fg-muted mt-1">משחקים</p>
        </div>
        <div className="rounded-[18px] bg-surface p-3.5 flex flex-col">
          <p className="fl-num text-[30px] text-fg-strong">{totalGoals}</p>
          <p className="text-[12.5px] text-fg-muted mt-1">שערים{completed.length ? ` · ${(totalGoals / completed.length).toFixed(1)} למשחק` : ''}</p>
        </div>
        <div className="col-span-2 lg:col-span-4 rounded-[18px] bg-surface p-3.5 flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[12.5px] text-fg-muted">מלך השערים</span>
            <span className="block text-[17px] font-extrabold text-fg-strong truncate">{topScorer ? <PlayerName p={topScorer} /> : '—'}</span>
          </span>
          <span className="flex items-baseline gap-1"><span className="fl-num text-[30px] text-fg-strong">{topScorer?.goals || 0}</span><span className="text-[12px] text-fg-muted">שערים</span></span>
        </div>
      </div>

      {/* Tabs */}
      <FLTPills label={`עונת ${season?.name || ''}`} value={tab} onChange={setTab} items={[
        { value: "standings", label: "טבלה" },
        { value: "players", label: "שחקנים" },
        { value: "games", label: "משחקים" },
        { value: "stats", label: "סטטיסטיקות" },
      ]} />

      {/* Standings */}
      {tab === "standings" && (
        <div className="rounded-[18px] bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-fg-muted text-[11px]">
                <th className="py-3 px-4 text-right font-semibold">#</th>
                <th className="py-3 px-4 text-right font-semibold">קבוצה</th>
                <th className="py-3 px-2 text-center font-semibold">נק׳</th>
                <th className="py-3 px-2 text-center font-semibold">נ</th>
                <th className="py-3 px-2 text-center font-semibold">ת</th>
                <th className="py-3 px-2 text-center font-semibold">ה</th>
                <th className="py-3 px-2 text-center font-semibold">שז</th>
                <th className="py-3 px-2 text-center font-semibold">שח</th>
                <th className="py-3 px-2 text-center font-semibold">הפרש</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {standings.map(team => {
                const href = teamHref(team.team_id)
                const diff = (team.goals_for || 0) - (team.goals_against || 0)
                return (
                  <tr key={team.id} className={team.final_rank === 1 ? "bg-fl-accent/15" : ""}>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${
                        team.final_rank === 1 ? 'bg-fl-accent text-[#11161D]' :
                        team.final_rank === 2 ? 'bg-[#C9CDD2] text-[#11161D]' :
                        team.final_rank === 3 ? 'bg-[#D9A066] text-[#11161D]' :
                        'text-fg-muted'
                      }`}>
                        {team.final_rank}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {href ? (
                        <Link to={href} className="flex items-center gap-2 font-semibold text-fg-strong whitespace-nowrap hover:underline underline-offset-2">
                          <TeamLogo team={teamOf(team.team_id, team.team_name)} px={28} />{team.team_name}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 font-semibold text-fg-strong whitespace-nowrap">
                          <TeamLogo team={teamOf(team.team_id, team.team_name)} px={28} />{team.team_name}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-center fl-num text-[16px] text-fg-strong">{team.points}</td>
                    <td className="py-3 px-2 text-center tabular-nums text-fg-strong font-semibold">{team.wins}</td>
                    <td className="py-3 px-2 text-center tabular-nums text-fg-muted">{team.ties}</td>
                    <td className="py-3 px-2 text-center tabular-nums text-fg-muted">{team.losses}</td>
                    <td className="py-3 px-2 text-center tabular-nums text-fg-muted">{team.goals_for}</td>
                    <td className="py-3 px-2 text-center tabular-nums text-fg-muted">{team.goals_against}</td>
                    <td dir="ltr" className="py-3 px-2 text-center tabular-nums font-semibold text-fg-strong">{fmtDiff(diff)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Players */}
      {tab === "players" && <SeasonPlayers players={playerStats} />}

      {/* Statistics — charts, awards, goalkeepers, cards, referees for this season */}
      {tab === "stats" && season && (
        <Suspense fallback={<StatisticsSkeleton />}>
          <SeasonStatistics season={season} />
        </Suspense>
      )}

      {/* Games */}
      {tab === "games" && (
        <div className="rounded-[18px] bg-surface overflow-hidden">
          <div className="divide-y divide-line">
            {games.map(game => {
              const row = (
                <>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <TeamLogo team={teamOf(game.home_team_id, game.home_team_name)} px={24} />
                    <span className="font-semibold text-sm text-fg-strong truncate">{game.home_team_name}</span>
                    {/* Home on the RIGHT: FLScore = separate spans, never one "a : h" string. */}
                    <div className="text-center px-2">
                      {game.status === 'completed' ? (
                        <FLScore home={game.home_score} away={game.away_score} size={16} className="text-fg-strong" />
                      ) : (
                        <span className="text-[11px] text-fg-muted">—</span>
                      )}
                    </div>
                    <span className="font-semibold text-sm text-fg-strong truncate">{game.away_team_name}</span>
                    <TeamLogo team={teamOf(game.away_team_id, game.away_team_name)} px={24} />
                  </div>
                  <div className="flex items-center gap-2 ms-3 shrink-0">
                    <span dir="ltr" className="text-[11px] text-fg-muted">
                      {game.game_date ? format(ilDate(game.game_date), "d.M.yy") : '—'}
                    </span>
                    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-surface-sunken text-fg-muted">
                      {game.playoff_round || game.game_type}
                    </span>
                  </div>
                </>
              )
              const cls = "flex items-center justify-between px-4 py-3 min-h-[52px] hover:bg-surface-sunken transition-colors"
              return game.slug
                ? <Link key={game.id} to={`/games/${encodeURIComponent(game.slug)}`} className={cls}>{row}</Link>
                : <div key={game.id} className={cls}>{row}</div>
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerName({ p }) {
  const name = `${p.player_first_name} ${p.player_last_name}`
  return p.player_slug
    ? <Link to={`/players/${encodeURIComponent(p.player_slug)}`} className="hover:underline">{name}</Link>
    : name
}

const PLAYER_SORTS = [
  { id: 'goals', label: 'שערים', key: p => p.goals || 0 },
  { id: 'games', label: 'משחקים', key: p => p.games_played || 0 },
  { id: 'avg', label: 'ממוצע למשחק', key: p => (p.games_played ? (p.goals || 0) / p.games_played : 0) },
  { id: 'cards', label: 'כרטיסים', key: p => (p.red_cards || 0) * 10 + (p.blue_cards || 0) },
]
const POSITIONS = [
  { id: 'all', label: 'כולם' },
  { id: 'Field Player', label: 'שחקני שדה' },
  { id: 'Goalkeeper', label: 'שוערים' },
]

/** The season's player table — sortable, filterable by position, every name a link. */
function SeasonPlayers({ players }) {
  const [sort, setSort] = useState('goals')
  const [pos, setPos] = useState('all')
  const by = PLAYER_SORTS.find(s => s.id === sort)
  const list = players
    .filter(p => pos === 'all' || p.position === pos)
    .filter(p => sort !== 'cards' || (p.blue_cards || 0) + (p.red_cards || 0) > 0)
    .filter(p => sort !== 'avg' || (p.games_played || 0) >= 3)
    .sort((a, b) => by.key(b) - by.key(a))

  const chip = (active) => `min-h-[44px] px-4 rounded-full text-[13px] font-bold transition-colors ${active ? 'bg-fg-strong text-surface' : 'bg-surface text-fg-strong hover:bg-surface-sunken'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-fg-subtle font-semibold">מיון:</span>
          {PLAYER_SORTS.map(s => <button key={s.id} onClick={() => setSort(s.id)} className={chip(sort === s.id)}>{s.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {POSITIONS.map(s => <button key={s.id} onClick={() => setPos(s.id)} className={chip(pos === s.id)}>{s.label}</button>)}
        </div>
      </div>
      {sort === 'avg' && <p className="text-[11px] text-fg-subtle">מינימום 3 משחקים</p>}

      <div className="rounded-[18px] bg-surface overflow-hidden">
        {list.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-muted">אין שחקנים להצגה</p>
        ) : (
          <div className="divide-y divide-line">
            {list.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 min-h-[56px]">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center shrink-0 ${
                    i === 0 ? 'bg-fl-accent text-[#11161D]' :
                    i === 1 ? 'bg-[#C9CDD2] text-[#11161D]' :
                    i === 2 ? 'bg-[#D9A066] text-[#11161D]' :
                    'text-fg-muted'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-fg-strong"><PlayerName p={p} /></span>
                    <p className="text-[12px] text-fg-muted">{p.team_name}{p.position === 'Goalkeeper' ? ' · שוער' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="font-bold text-fg-strong"><span className="fl-num text-[15px]">{p.goals}</span> שערים</span>
                  <span className="text-fg-muted">{p.games_played} מש׳</span>
                  {sort === 'avg' && <span dir="ltr" className="text-fg-muted">{by.key(p).toFixed(2)}</span>}
                  {p.blue_cards > 0 && <span className="inline-flex items-center gap-1 text-fg-strong"><span aria-hidden="true" className="w-2 h-2.5 rounded-[2px] bg-fl-blue" />{p.blue_cards} כחול</span>}
                  {p.red_cards > 0 && <span className="inline-flex items-center gap-1 text-fg-strong"><span aria-hidden="true" className="w-2 h-2.5 rounded-[2px] bg-fl-red" />{p.red_cards} אדום</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
