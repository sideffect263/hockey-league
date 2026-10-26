import { useState, useEffect, lazy, Suspense } from "react"
import { useParams, Link } from "react-router-dom"
import {
  getArchivedSeasons, getArchivedStandings,
  getArchivedPlayerStats, getArchivedGames
} from "@/lib/api"
import { Archive, Users, UserCheck, ArrowRight, RefreshCw } from "lucide-react"
import { Trophy, Calendar } from "@/components/icons/BrandIcons"
import { Crate } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import { useSlugId } from "@/lib/slugs"
import { ArchiveSkeleton, ArchiveSeasonSkeleton, StatisticsSkeleton } from "@/components/skeletons/PageSkeletons"
import { Stats } from "@/components/icons/HockeyIcons"
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
        <h1 className="page-title flex items-center gap-2.5">
          <Crate className="w-7 h-7 text-brand" /> ארכיון עונות
        </h1>
        <p className="page-subtitle mt-1">צפייה בנתוני עונות קודמות</p>
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
              <Link to={`/archive/${encodeURIComponent(season.slug || season.id)}`} className="card-hover p-5 block">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand to-amber-500 flex items-center justify-center shadow-md">
                    <Trophy className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-bold text-lg text-slate-900 dark:text-white">עונת {season.name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">אורכבה {new Date(season.archived_at).toLocaleDateString('he-IL')}</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400" />
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
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5">
        <p className="text-sm font-semibold text-fg-strong">
          את/ה צופה בעונת {season?.name} — עונה שהסתיימה
        </p>
        <Link to="/standings" className="text-xs font-bold text-brand-strong dark:text-brand-light hover:underline">
          חזרה לעונה הנוכחית ←
        </Link>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <Link to="/archive" className="text-xs font-semibold text-brand hover:text-brand-hover mb-2 inline-block">
          ← כל העונות
        </Link>
        <h1 className="page-title flex items-center gap-2.5">
          <Trophy className="w-7 h-7 text-brand" /> עונת {season?.name}
        </h1>
        <p className="page-subtitle mt-1">טבלה סופית, מלכי השערים וכל המשחקים של העונה</p>
      </motion.div>

      {/* Stats overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4 flex flex-col items-center text-center gap-1.5">
          {champion && <TeamLogo team={teamOf(champion.team_id, champion.team_name)} size={10} />}
          <p className="text-base font-extrabold text-fg-strong leading-tight">{champion?.team_name || '—'}</p>
          <p className="text-[10px] text-amber-500 font-bold">אלופה</p>
        </div>
        <div className="card p-4 flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-extrabold text-fg-strong">{completed.length}</p>
          <p className="text-[10px] text-fg-subtle font-medium">משחקים</p>
        </div>
        <div className="card p-4 flex flex-col items-center justify-center text-center">
          <p className="text-2xl font-extrabold text-fg-strong">{totalGoals}</p>
          <p className="text-[10px] text-fg-subtle font-medium">שערים{completed.length ? ` · ${(totalGoals / completed.length).toFixed(1)} למשחק` : ''}</p>
        </div>
        <div className="card p-4 flex flex-col items-center justify-center text-center">
          <p className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 leading-tight">
            {topScorer ? <PlayerName p={topScorer} /> : '—'}
          </p>
          <p className="text-[10px] text-fg-subtle font-medium mt-1">מלך שערים ({topScorer?.goals || 0})</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {[
          { id: "standings", label: "טבלה", icon: Trophy },
          { id: "players", label: "שחקנים", icon: UserCheck },
          { id: "games", label: "משחקים", icon: Calendar },
          { id: "stats", label: "סטטיסטיקות", icon: Stats },
        ].map(t => (
          // Four tabs must fit a 375px phone: icons hide and padding tightens below sm.
          <button key={t.id} onClick={() => setTab(t.id)} className={`${tab === t.id ? "tab-active" : "tab-inactive"} !px-2 sm:!px-4`}>
            <t.icon className="w-4 h-4 hidden sm:block" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Standings */}
      {tab === "standings" && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 dark:bg-slate-800 text-white text-xs">
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
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {standings.map(team => {
                const href = teamHref(team.team_id)
                const diff = (team.goals_for || 0) - (team.goals_against || 0)
                return (
                  <tr key={team.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold ${
                        team.final_rank === 1 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                        team.final_rank === 2 ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' :
                        team.final_rank === 3 ? 'bg-bronze-100 text-bronze-700 dark:bg-bronze-900/40 dark:text-bronze-400' :
                        'text-slate-400'
                      }`}>
                        {team.final_rank}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {href ? (
                        <Link to={href} className="flex items-center gap-2 font-semibold text-fg-strong hover:text-brand-strong dark:hover:text-brand-light">
                          <TeamLogo team={teamOf(team.team_id, team.team_name)} size={6} />{team.team_name}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 font-semibold text-fg-strong">
                          <TeamLogo team={teamOf(team.team_id, team.team_name)} size={6} />{team.team_name}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-center font-extrabold text-fg-strong">{team.points}</td>
                    <td className="py-3 px-2 text-center text-emerald-600 dark:text-emerald-400 font-semibold">{team.wins}</td>
                    <td className="py-3 px-2 text-center text-slate-500">{team.ties}</td>
                    <td className="py-3 px-2 text-center text-red-500 font-semibold">{team.losses}</td>
                    <td className="py-3 px-2 text-center text-slate-700 dark:text-slate-300">{team.goals_for}</td>
                    <td className="py-3 px-2 text-center text-slate-400">{team.goals_against}</td>
                    <td dir="ltr" className={`py-3 px-2 text-center font-semibold ${diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : diff < 0 ? 'text-red-500' : 'text-slate-400'}`}>{diff > 0 ? `+${diff}` : diff}</td>
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
        <div className="card overflow-hidden">
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {games.map(game => {
              const row = (
                <>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <TeamLogo team={teamOf(game.home_team_id, game.home_team_name)} size={6} />
                    <span className="font-semibold text-sm text-fg-strong truncate">{game.home_team_name}</span>
                    {/* RTL: away first, home last so each score renders beside its team (home is on the right).
                        dir=ltr because the spaces around the colon are bidi-neutral: without it the two digit
                        runs swap and every score sits next to the wrong team. */}
                    <div className="text-center px-2">
                      {game.status === 'completed' ? (
                        <span dir="ltr" className="font-bold text-sm text-fg-strong tabular-nums">{game.away_score} : {game.home_score}</span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </div>
                    <span className="font-semibold text-sm text-fg-strong truncate">{game.away_team_name}</span>
                    <TeamLogo team={teamOf(game.away_team_id, game.away_team_name)} size={6} />
                  </div>
                  <div className="flex items-center gap-2 ms-3 shrink-0">
                    <span dir="ltr" className="text-[10px] text-slate-400">
                      {game.game_date ? format(ilDate(game.game_date), "d/M/yy") : '—'}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                      {game.playoff_round || game.game_type}
                    </span>
                  </div>
                </>
              )
              const cls = "flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
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

  const chip = (active) => `px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${active ? 'bg-brand text-brand-fg' : 'bg-surface-sunken text-fg-muted hover:text-fg-strong'}`

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

      <div className="card overflow-hidden">
        {list.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-muted">אין שחקנים להצגה</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {list.map((p, i) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                    i === 1 ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' :
                    i === 2 ? 'bg-bronze-100 text-bronze-700 dark:bg-bronze-900/40 dark:text-bronze-400' :
                    'text-slate-400'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-fg-strong"><PlayerName p={p} /></span>
                    <p className="text-[11px] text-fg-subtle">{p.team_name}{p.position === 'Goalkeeper' ? ' · שוער' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">{p.goals} שערים</span>
                  <span className="text-slate-400">{p.games_played} מש׳</span>
                  {sort === 'avg' && <span dir="ltr" className="text-fg-muted">{by.key(p).toFixed(2)}</span>}
                  {p.blue_cards > 0 && <span className="text-blue-500">{p.blue_cards} כחול</span>}
                  {p.red_cards > 0 && <span className="text-red-500">{p.red_cards} אדום</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
