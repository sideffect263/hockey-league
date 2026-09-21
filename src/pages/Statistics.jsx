import { useState, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { getTeams, getPlayers, getGames, getReferees, getGameStats } from "@/lib/api"
import { BarChart3, Shield, Crown, ChevronDown, ChevronUp, RefreshCw, Trophy, TrendingUp, Flame, Zap, Target } from "lucide-react"
import { Player, Glove, Cards, Whistle, StickBall, BlueCard, RedCard, Goal, Crossed, Stats } from "@/components/icons/HockeyIcons"
import { motion } from "framer-motion"
import TeamLogo from "@/components/TeamLogo"
import { PlayerLink } from "@/components/EntityLinks"
import { useTheme } from "@/lib/ThemeContext"
import { useSeasonName } from "@/App"
import { seriesColors, teamColorIndex, diverging } from "@/lib/chartPalette"
import {
  leagueSummary, monthlyGoals, cumulativeTeamGoals, cumulativePlayerGoals,
  teamGoalDiff, teamAchievements, playerAchievements, goalkeeperCleanSheets,
  seasonMonths, monthStartMs, shortMonthLabel, countsForStats,
} from "@/lib/leagueStats"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { axisTicks } from "@/components/charts/chartUtils"
import ChartCard, { SegToggle } from "@/components/charts/ChartCard"
import LineChart from "@/components/charts/LineChart"
import ScatterChart from "@/components/charts/ScatterChart"
import RadarChart from "@/components/charts/RadarChart"
import StatTile from "@/components/charts/StatTile"
import Legend from "@/components/charts/Legend"
import { entityPath } from "@/lib/slugs"
import { StatisticsSkeleton } from "@/components/skeletons/PageSkeletons"

// game_stats does not exist for every completed game — anything derived from it must
// carry this caveat (per the data contract for this page). Derived live rather than
// hardcoded, so it can't drift out of sync with the tiles on the same screen.
const statsNote = (withStats, completed) =>
  `מבוסס על ${withStats} מתוך ${completed} משחקים עם סטטיסטיקות שחקנים`

export default function Statistics() {
  const { dark } = useTheme()
  const seasonName = useSeasonName()
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [games, setGames] = useState([])
  const [referees, setReferees] = useState([])
  const [gameStats, setGameStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState("scorers")
  const [expanded, setExpanded] = useState({})
  const [raceMode, setRaceMode] = useState("team")   // מרוץ השערים: קבוצה / שחקן
  const [gdView, setGdView] = useState("scatter")    // הפרש שערים: פיזור / מכ״ם
  const [hatMode, setHatMode] = useState("player")    // שלישיות: שחקן / קבוצה
  const [hatView, setHatView] = useState("scatter")   // שלישיות: פיזור / מכ״ם

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [t, p, g, r, s] = await Promise.all([getTeams(), getPlayers(), getGames(), getReferees(), getGameStats()])
      // Senior-league statistics only: youth-tournament teams/players don't belong
      // in these leaderboards (youth has its own tournament pages). Games are
      // already senior-only via countsForStats. team_id is senior-preferred, so a
      // player on both a senior and a youth team still counts; free agents count.
      const seniorTeams = t.filter(tm => ageOf(tm) === DEFAULT_AGE)
      const seniorIds = new Set(seniorTeams.map(tm => tm.id))
      setTeams(seniorTeams)
      setPlayers(p.filter(pl => !pl.team_id || seniorIds.has(pl.team_id)))
      setGames(g); setReferees(r); setGameStats(s)
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  const toggle = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  const teamName = (id) => teams.find(t => t.id === id)?.name || '—'

  // Friendly (ידידותי) games are content-only — never part of the competitive
  // record. Exclude them, and their box scores, before every derivation on this
  // page (charts, awards, races, clean sheets, referee counts).
  const statGames = useMemo(() => games.filter(countsForStats), [games])
  const statGameStats = useMemo(() => {
    const ok = new Set(statGames.map(g => g.id))
    return gameStats.filter(s => ok.has(s.game_id))
  }, [gameStats, statGames])

  // ---- Tab data (unchanged behaviour) ----
  // A leaderboard ranks what someone has DONE, so nobody on zero belongs on it:
  // at the start of a season that produced "1. <player> — 0 שערים" down to fifth
  // place, which reads as a standing rather than as an empty board. Matches what
  // the card lists (bluePlayers/redPlayers/blueTeams) have always done.
  const topScorers = players.filter(p => p.position === 'Field Player' && (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0))

  const topPerTeam = teams.map(team => {
    const best = players.filter(p => p.team_id === team.id && p.position === 'Field Player')
      .reduce((b, p) => (p.goals || 0) > (b?.goals || 0) ? p : b, null)
    return best ? { ...best, team } : null
  }).filter(Boolean).sort((a, b) => (b.goals || 0) - (a.goals || 0))

  // Canonical clean-sheet computation, now shared from leagueStats. It returns a
  // record for EVERY goalkeeper, zeros included — `cleanSheetLeaders` below is
  // the ranked view, and is what both the tab and the award card render.
  const goalkeepers = useMemo(() => goalkeeperCleanSheets(players, statGames), [players, statGames])
  const cleanSheetLeaders = useMemo(() => goalkeepers.filter(g => g.clean_sheets > 0), [goalkeepers])

  const bluePlayers = players.filter(p => (p.blue_cards || 0) > 0).sort((a, b) => b.blue_cards - a.blue_cards)
  const redPlayers = players.filter(p => (p.red_cards || 0) > 0).sort((a, b) => b.red_cards - a.red_cards)
  const blueTeams = teams.map(t => ({ ...t, total_blue: players.filter(p => p.team_id === t.id).reduce((s, p) => s + (p.blue_cards || 0), 0) })).filter(t => t.total_blue > 0).sort((a, b) => b.total_blue - a.total_blue)

  const refStats = useMemo(() => {
    const rel = statGames.filter(g => g.referee_id && ['completed', 'scheduled'].includes(g.status))
    const m = new Map()
    rel.forEach(g => {
      const k = `${g.referee_type}-${g.referee_id}`
      if (!m.has(k)) {
        const ref = (g.referee_type === 'player' ? players : referees).find(r => r.id === g.referee_id)
        if (ref) m.set(k, { ...ref, type: g.referee_type, completed: 0, scheduled: 0, total: 0 })
      }
      if (m.has(k)) { const r = m.get(k); g.status === 'completed' ? r.completed++ : r.scheduled++; r.total++ }
    })
    return Array.from(m.values()).sort((a, b) => b.total - a.total)
  }, [statGames, players, referees])

  // ---- Overview + charts (sourced from `statGames`/`statGameStats`, friendlies excluded) ----
  const summary = useMemo(() => leagueSummary(statGames), [statGames])
  const monthly = useMemo(() => monthlyGoals(statGames), [statGames])
  const goalDiff = useMemo(() => teamGoalDiff(statGames, teams), [statGames, teams])
  const STATS_NOTE = useMemo(
    () => statsNote(new Set(statGameStats.map(s => s.game_id)).size, summary.completedGames),
    [statGameStats, summary.completedGames],
  )
  const achievements = useMemo(() => playerAchievements(statGameStats, players), [statGameStats, players])
  const teamAch = useMemo(() => teamAchievements(statGameStats, players, teams), [statGameStats, players, teams])

  const xTicks = useMemo(
    () => seasonMonths(statGames).map(k => ({ x: monthStartMs(k), label: shortMonthLabel(k) })),
    [statGames]
  )

  // Team race series — colour follows the ENTITY via the fixed team→slot map, never rank.
  const { raceSeries, legendItems } = useMemo(() => {
    const idx = teamColorIndex(teams)
    const palette = seriesColors(dark)
    const series = cumulativeTeamGoals(statGames, teams)
      .map(s => ({ ...s, id: s.teamId, color: palette[idx[s.teamId]] }))
      .sort((a, b) => b.total - a.total)
    return {
      raceSeries: series,
      legendItems: series.map(s => ({ id: s.teamId, name: s.name, color: s.color, team: s.team })),
    }
  }, [statGames, teams, dark])

  // Player race — top 8 scorers' cumulative goals (from game_stats, 40/45 games).
  // No crest on the series so each end-label shows the player's initial, which
  // distinguishes team-mates; the legend carries the team crest for context.
  const { playerRaceSeries, playerLegend } = useMemo(() => {
    const palette = seriesColors(dark)
    const top = cumulativePlayerGoals(statGameStats, statGames, players).slice(0, 8)
    return {
      playerRaceSeries: top.map((p, i) => ({
        id: p.playerId, name: p.name, total: p.total, points: p.points,
        color: palette[i % palette.length],
      })),
      playerLegend: top.map((p, i) => ({
        id: p.playerId, name: p.name, color: palette[i % palette.length],
        team: teams.find(t => t.id === p.team_id),
      })),
    }
  }, [statGameStats, statGames, players, teams, dark])

  // ---- Awards (derived) ----
  const awardHat = achievements.players.filter(p => p.hatTricks > 0).sort((a, b) => b.hatTricks - a.hatTricks || b.gamesWithGoal - a.gamesWithGoal)
  const awardBig = achievements.players.filter(p => p.bigGames > 0).sort((a, b) => b.bigGames - a.bigGames)
  const awardBrace = achievements.players.filter(p => p.braces > 0).sort((a, b) => b.braces - a.braces)
  const awardClean = cleanSheetLeaders
  const awardBlue = bluePlayers

  // Entity colour follows the fixed team→slot map (same hues as the goal race).
  const teamColor = useMemo(() => {
    const idx = teamColorIndex(teams)
    const pal = seriesColors(dark)
    return (id) => pal[idx[id]] || pal[0]
  }, [teams, dark])

  const playersById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])

  // Radar spoke labels for teams — abbreviate the long compound names so they
  // don't collide around the circle.
  const shortTeam = (nm = '') => nm.replace('גבעת עדה', 'גב״ע').replace('קריית', 'ק״')
  const intTicks = (m) => Array.from({ length: Math.max(1, m) }, (_, i) => i + 1)
  const radarScale = (vals) => {
    const { yMax, ticks } = axisTicks(Math.max(1, ...vals))
    return { max: yMax, rings: ticks.filter(v => v > 0) }
  }

  // ---- הפרש שערים: scatter (GF×GA quadrants) + radar (GF/GA over teams) ----
  const gdCharts = useMemo(() => {
    const comb = Math.max(1, ...goalDiff.flatMap(d => [d.gf, d.ga]))
    const { yMax, ticks } = axisTicks(comb)
    const t = ticks.filter(v => v > 0)
    const n = goalDiff.length || 1
    const meanGf = goalDiff.reduce((s, d) => s + d.gf, 0) / n
    const meanGa = goalDiff.reduce((s, d) => s + d.ga, 0) / n
    const div = diverging(dark)
    return {
      scatter: {
        points: goalDiff.map(d => ({
          id: d.teamId, x: d.gf, y: d.ga, name: d.name, label: shortTeam(d.name),
          color: teamColor(d.teamId), team: d.team,
          tip: [{ k: 'זכות', v: d.gf }, { k: 'חובה', v: d.ga }, { k: 'הפרש', v: (d.gd > 0 ? '+' : '') + d.gd }],
        })),
        xMax: yMax, yMax, xTicks: t, yTicks: t, xThreshold: meanGf, yThreshold: meanGa,
      },
      radar: {
        axes: goalDiff.map(d => shortTeam(d.name)),
        series: [
          { id: 'gf', name: 'זכות (הבקיעו)', color: div.pos, values: goalDiff.map(d => d.gf) },
          { id: 'ga', name: 'חובה (ספגו)', color: div.neg, values: goalDiff.map(d => d.ga) },
        ],
        max: yMax, rings: t,
      },
    }
  }, [goalDiff, dark, teamColor])

  // ---- שלישיות: scatter (scoring map) + radar (scoring profile), player/team ----
  const hatCharts = useMemo(() => {
    const enriched = achievements.players
      .map(a => { const p = playersById.get(a.id); return p ? { ...a, goals: p.goals || 0, team: teams.find(t => t.id === a.team_id) } : null })
      .filter(Boolean)

    // scatter — players: season goals × hat-tricks. Only hat-trick scorers, so
    // the zero-band crowd doesn't pile on the axis. Jitter within each band so
    // same-count dots spread out instead of stacking; the tooltip keeps the
    // true value, and only the standouts are labelled.
    const cloud = enriched.filter(a => a.hatTricks >= 1).sort((x, y) => y.goals - x.goals)
    const cn = cloud.length || 1
    const gAx = axisTicks(Math.max(1, ...cloud.map(a => a.goals)))
    const pHmax = Math.max(1, ...cloud.map(a => a.hatTricks))
    const band = {}
    cloud.forEach(a => { (band[a.hatTricks] ||= []).push(a) })
    const jitterY = new Map()
    Object.values(band).forEach(grp => {
      grp.sort((x, y) => x.goals - y.goals)
      const n = grp.length
      grp.forEach((a, k) => jitterY.set(a.id, a.hatTricks + (n > 1 ? (k / (n - 1) - 0.5) * 0.62 : 0)))
    })
    const scatterPlayers = {
      points: cloud.map(a => ({
        id: a.id, x: a.goals, y: jitterY.get(a.id), name: `${a.first_name} ${a.last_name}`,
        label: (a.hatTricks >= 3 || a.goals >= 20) ? a.first_name : '',
        color: teamColor(a.team_id), team: a.team,
        tip: [{ k: 'שערים', v: a.goals }, { k: 'שלישיות', v: a.hatTricks }, { k: 'משחקי-על', v: a.bigGames }],
      })),
      xMax: gAx.yMax, yMax: pHmax + 0.45, xTicks: gAx.ticks.filter(v => v > 0), yTicks: intTicks(pHmax),
      xThreshold: cloud.reduce((s, a) => s + a.goals, 0) / cn,
      yThreshold: Math.max(1.5, cloud.reduce((s, a) => s + a.hatTricks, 0) / cn),
    }

    // scatter — teams: team goals × hat-tricks
    const gfById = new Map(goalDiff.map(d => [d.teamId, d.gf]))
    const trows = teamAch.map(t => ({ ...t, gf: gfById.get(t.teamId) || 0 }))
    const tn = trows.length || 1
    const tGax = axisTicks(Math.max(1, ...trows.map(t => t.gf)))
    const tHmax = Math.max(1, ...trows.map(t => t.hatTricks))
    const scatterTeams = {
      points: trows.map(t => ({
        id: t.teamId, x: t.gf, y: t.hatTricks, name: t.name, label: shortTeam(t.name),
        color: teamColor(t.teamId), team: t.team,
        tip: [{ k: 'שערים', v: t.gf }, { k: 'שלישיות', v: t.hatTricks }, { k: 'משחקי-על', v: t.bigGames }],
      })),
      xMax: tGax.yMax, yMax: tHmax, xTicks: tGax.ticks.filter(v => v > 0), yTicks: intTicks(tHmax),
      xThreshold: trows.reduce((s, t) => s + t.gf, 0) / tn,
      yThreshold: trows.reduce((s, t) => s + t.hatTricks, 0) / tn,
    }

    // radar — scoring profile (doubles / hat-tricks / 5+)
    const pal = seriesColors(dark)
    const AXES = ['דאבלים (2)', 'שלישיות (3+)', 'משחקי-על (5+)']
    const topPlayers = [...enriched].sort((x, y) => y.goals - x.goals).slice(0, 4)
    const radarPlayers = {
      axes: AXES,
      series: topPlayers.map((a, i) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`, color: pal[i % pal.length], values: [a.braces, a.hatTricks, a.bigGames] })),
      ...radarScale(topPlayers.flatMap(a => [a.braces, a.hatTricks, a.bigGames])),
    }
    const topTeams = [...teamAch].sort((x, y) => y.hatTricks - x.hatTricks).slice(0, 4)
    const radarTeams = {
      axes: AXES,
      series: topTeams.map((t, i) => ({ id: t.teamId, name: t.name, color: pal[i % pal.length], values: [t.braces, t.hatTricks, t.bigGames] })),
      ...radarScale(topTeams.flatMap(t => [t.braces, t.hatTricks, t.bigGames])),
    }

    return { scatterPlayers, scatterTeams, radarPlayers, radarTeams }
  }, [achievements, playersById, teams, teamAch, goalDiff, dark, teamColor])

  const tabs = [
    { id: "scorers", label: "מבקיעים", icon: Player },
    { id: "goalkeepers", label: "שוערים", icon: Glove },
    { id: "cards", label: "כרטיסים", icon: Cards },
    { id: "referees", label: "שופטים", icon: Whistle },
  ]

  // Swatch+name legend for the radar views (series aren't teams, so no crest).
  const MiniLegend = ({ items = [] }) => (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
      {items.map(it => (
        <span key={it.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="w-3.5 h-1.5 rounded-full shrink-0" style={{ background: it.color }} aria-hidden="true" />
          <span className="whitespace-nowrap">{it.name}</span>
        </span>
      ))}
    </div>
  )

  const medal = (i) =>
    i === 0 ? 'bg-amber-400 text-amber-950' :
    i === 1 ? 'bg-slate-300 dark:bg-slate-500 text-slate-800 dark:text-white' :
    i === 2 ? 'bg-bronze-300 dark:bg-bronze-700 text-bronze-900 dark:text-white' :
    'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'

  const List = ({ title, icon, data, render, tKey, empty }) => {
    const exp = expanded[tKey]
    const show = exp ? data : data.slice(0, 5)
    return (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h3 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">{icon} {title}</h3>
        </div>
        <div className="p-4 space-y-2">
          {show.map((item, i) => render(item, i))}
          {data.length === 0 && <p className="text-center text-slate-500 dark:text-slate-400 py-6 text-sm">{empty}</p>}
          {data.length > 5 && (
            <button onClick={() => toggle(tKey)} className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 py-2 mt-1 border border-slate-100 dark:border-slate-700 rounded-lg transition-colors">
              {exp ? <><ChevronUp className="w-3.5 h-3.5" /> הצג פחות</> : <><ChevronDown className="w-3.5 h-3.5" /> הצג הכל ({data.length})</>}
            </button>
          )}
        </div>
      </div>
    )
  }

  const PlayerRow = ({ player, index, value, color = "bg-slate-900 dark:bg-brand" }) => (
    <Link to={entityPath('players', player)} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors group">
      <div className="flex items-center gap-2.5">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${medal(index)}`}>{index + 1}</span>
        <div>
          <p className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-brand transition-colors">{player.first_name} {player.last_name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{teamName(player.team_id)}</p>
        </div>
      </div>
      <span className={`${color} text-white text-xs font-bold px-2.5 py-1 rounded-md`}>{value}</span>
    </Link>
  )

  // Compact award card: top-5 players, medal styling, links to the player page.
  const AwardCard = ({ title, icon, data, valueOf, unit, badge = "bg-slate-900 dark:bg-brand", empty = "אין נתונים", note }) => (
    <div className="card p-4">
      <h3 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white mb-3">{icon} {title}</h3>
      <div className="space-y-2">
        {data.slice(0, 5).map((p, i) => (
          <PlayerLink key={p.id} playerId={p.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors group">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${medal(i)}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-[13px] text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{p.first_name} {p.last_name}</span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">{teamName(p.team_id)}</span>
              </span>
            </span>
            <span className={`${badge} text-white text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0`}>{valueOf(p)}{unit ? ` ${unit}` : ''}</span>
          </PlayerLink>
        ))}
        {data.length === 0 && <p className="text-center text-slate-500 dark:text-slate-400 py-4 text-xs">{empty}</p>}
      </div>
      {note && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2.5">{note}</p>}
    </div>
  )

  if (loading) return <StatisticsSkeleton />

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

  const biggest = summary.highestScoringGame

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Stats className="w-7 h-7 text-brand" /> סטטיסטיקות
        </h1>
        <p className="page-subtitle mt-1">נתוני ביצועים{seasonName && ` עונת ${seasonName}`}</p>
      </motion.div>

      {/* Overview tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile icon={<Crossed className="w-5 h-5" mono />} value={summary.completedGames} label="משחקים" />
        <StatTile icon={<Goal className="w-5 h-5" mono />} value={summary.totalGoals} label="שערים" accent="brand" spark={monthly.map(m => m.goals)} />
        <StatTile icon={<TrendingUp className="w-5 h-5" />} value={summary.avgPerGame.toFixed(1)} label="ממוצע למשחק" />
        <StatTile icon={<Glove className="w-5 h-5" mono />} value={summary.shutouts} label="בלימות" sub="משחקים ללא ספיגה" />
        {biggest && (
          <StatTile
            icon={<Flame className="w-5 h-5" />}
            value={summary.highestTotal}
            label="משחק שיא"
            sub={`${teamName(biggest.home_team_id)} נגד ${teamName(biggest.away_team_id)}`}
            to={entityPath('games', biggest)}
          />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Main chart — the goal race, full width, with a לפי קבוצה / לפי שחקן toggle. */}
        <ChartCard
          className="lg:col-span-2"
          title="מרוץ השערים"
          subtitle={raceMode === 'team'
            ? 'שערים מצטברים לאורך העונה, לפי קבוצה'
            : 'שערים מצטברים לאורך העונה · 8 המבקיעים המובילים'}
          icon={<TrendingUp className="w-4 h-4 text-brand" />}
          footnote={raceMode === 'player' ? STATS_NOTE : undefined}
          toolbar={
            <SegToggle
              value={raceMode}
              onChange={setRaceMode}
              options={[
                { id: 'team', label: 'קבוצה', icon: <Shield className="w-3 h-3" /> },
                { id: 'player', label: 'שחקן', icon: <Player className="w-3 h-3" /> },
              ]}
            />
          }
          legend={<Legend items={raceMode === 'team' ? legendItems : playerLegend} />}
        >
          <LineChart series={raceMode === 'team' ? raceSeries : playerRaceSeries} xTicks={xTicks} vbH={200} />
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="הפרש שערים"
          subtitle={gdView === 'scatter'
            ? 'מתקפה מול הגנה — כל קבוצה על המפה'
            : 'זכות מול חובה — מכ״ם קבוצתי'}
          icon={<Target className="w-4 h-4 text-brand" />}
          toolbar={
            <SegToggle
              value={gdView}
              onChange={setGdView}
              options={[
                { id: 'scatter', label: 'פיזור' },
                { id: 'radar', label: 'מכ״ם' },
              ]}
            />
          }
          legend={gdView === 'radar' ? <MiniLegend items={gdCharts.radar.series} /> : undefined}
        >
          <div className="mx-auto w-full max-w-3xl">
            {gdView === 'scatter' ? (
              <ScatterChart
                {...gdCharts.scatter}
                yUp={false}
                diagonal
                quadrants={{ tr: 'שולטות', tl: 'מגננתיות', br: 'התקפיות', bl: 'נאבקות' }}
                xLabel="זכות (מתקפה) ◄"
                yLabel="חובה (הגנה) ►"
              />
            ) : (
              <RadarChart {...gdCharts.radar} />
            )}
          </div>
        </ChartCard>

        <ChartCard
          className="lg:col-span-2"
          title="שלישיות"
          subtitle={hatView === 'radar'
            ? 'פרופיל הבקעה: דאבלים · שלישיות · משחקי-על'
            : hatMode === 'player'
              ? 'נפח מול נפיצות — שערים מול שלישיות'
              : 'שערי קבוצה מול שלישיות'}
          icon={<Flame className="w-4 h-4 text-brand" />}
          footnote={STATS_NOTE}
          toolbar={
            <div className="flex flex-wrap items-center gap-1.5">
              <SegToggle
                value={hatMode}
                onChange={setHatMode}
                options={[
                  { id: 'player', label: 'שחקן', icon: <Player className="w-3 h-3" /> },
                  { id: 'team', label: 'קבוצה', icon: <Shield className="w-3 h-3" /> },
                ]}
              />
              <SegToggle
                value={hatView}
                onChange={setHatView}
                options={[
                  { id: 'scatter', label: 'פיזור' },
                  { id: 'radar', label: 'מכ״ם' },
                ]}
              />
            </div>
          }
          legend={hatView === 'radar'
            ? <MiniLegend items={(hatMode === 'player' ? hatCharts.radarPlayers : hatCharts.radarTeams).series} />
            : undefined}
        >
          <div className="mx-auto w-full max-w-3xl">
            {hatView === 'scatter' ? (
              <ScatterChart
                {...(hatMode === 'player' ? hatCharts.scatterPlayers : hatCharts.scatterTeams)}
                yUp
                quadrants={hatMode === 'player'
                  ? { tr: 'כוכבי-על', tl: 'נפיצים', br: 'עקביים', bl: 'מזדמנים' }
                  : { tr: 'דומיננטיות', tl: 'נפיצות', br: 'עקביות', bl: 'מזדמנות' }}
                xLabel={hatMode === 'player' ? 'סך שערים ◄' : 'שערי הקבוצה ◄'}
                yLabel="שלישיות ►"
              />
            ) : (
              <RadarChart {...(hatMode === 'player' ? hatCharts.radarPlayers : hatCharts.radarTeams)} />
            )}
          </div>
        </ChartCard>
      </div>

      {/* Awards */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-white mb-3">
          <Trophy className="w-5 h-5 text-amber-500" /> הישגים ותארים
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AwardCard title="מלכי השלישיות" icon={<StickBall className="w-4 h-4 text-brand" />} data={awardHat} valueOf={p => p.hatTricks} badge="bg-brand" empty="אין שלישיות" note={STATS_NOTE} />
          <AwardCard title="משחקי-על (5+ שערים)" icon={<Zap className="w-4 h-4 text-amber-500" />} data={awardBig} valueOf={p => p.bigGames} badge="bg-amber-500" empty="אין" note={STATS_NOTE} />
          <AwardCard title="דאבלים (2 שערים)" icon={<Target className="w-4 h-4 text-slate-500" />} data={awardBrace} valueOf={p => p.braces} badge="bg-slate-700 dark:bg-slate-500" empty="אין" note={STATS_NOTE} />
          <AwardCard title="שוערי הברזל" icon={<Glove className="w-4 h-4 text-blue-500" />} data={awardClean} valueOf={p => p.clean_sheets} unit="נקיות" badge="bg-blue-500" empty="אין" />
          <AwardCard title="כרטיסים כחולים" icon={<BlueCard className="w-4 h-4" />} data={awardBlue} valueOf={p => p.blue_cards} badge="bg-blue-500" empty="אין" />
        </div>
      </div>

      {/* Detailed tabbed lists */}
      <div className="space-y-5 pt-1">
        <div className="tab-bar overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={activeTab === tab.id ? "tab-active" : "tab-inactive"}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "scorers" && (
          <div className="space-y-4">
            <List title="מלכי השערים" icon={<StickBall className="w-4 h-4 text-brand" />} data={topScorers} tKey="top" empty="טרם נרשמו שערים העונה"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={`${p.goals || 0} שערים`} />} />
            <List title="מצטיין מכל קבוצה" icon={<Crown className="w-4 h-4 text-amber-500" />} data={topPerTeam} tKey="perTeam" empty="טרם נרשמו שערים העונה"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={`${p.goals || 0}`} color="bg-amber-500" />} />
          </div>
        )}

        {activeTab === "goalkeepers" && (
          <List title="שוערי הברזל" icon={<Glove className="w-4 h-4 text-blue-500" />} data={cleanSheetLeaders} tKey="gk" empty="טרם נרשמו משחקים ללא ספיגה"
            render={(gk, i) => (
              <Link key={gk.id} to={entityPath('players', gk)} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors group">
                <div className="flex items-center gap-2.5">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${medal(i)}`}>{i + 1}</span>
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-brand transition-colors">{gk.first_name} {gk.last_name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{teamName(gk.team_id)} • {gk.total_games} משחקים</p>
                  </div>
                </div>
                <span className="bg-blue-500 text-white text-xs font-bold px-2.5 py-1 rounded-md">{gk.clean_sheets} נקיות</span>
              </Link>
            )} />
        )}

        {activeTab === "cards" && (
          <div className="space-y-4">
            <List title="כרטיסים כחולים" icon={<BlueCard className="w-4 h-4" />} data={bluePlayers} tKey="blue" empty="אין"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.blue_cards} color="bg-blue-500" />} />
            <List title="כחולים לפי קבוצה" icon={<Shield className="w-4 h-4 text-blue-500" />} data={blueTeams} tKey="blueT" empty="אין"
              render={(t, i) => (
                <Link key={t.id} to={entityPath('teams', t)} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors group">
                  <div className="flex items-center gap-2.5">
                    <TeamLogo team={t} size={6} />
                    <span className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-brand transition-colors">{t.name}</span>
                  </div>
                  <span className="bg-blue-500 text-white text-xs font-bold px-2.5 py-1 rounded-md">{t.total_blue}</span>
                </Link>
              )} />
            <List title="כרטיסים אדומים" icon={<RedCard className="w-4 h-4" />} data={redPlayers} tKey="red" empty="אין"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.red_cards} color="bg-red-500" />} />
          </div>
        )}

        {activeTab === "referees" && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <h3 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white"><Whistle className="w-4 h-4 text-purple-500" /> שופטים</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-700 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="text-right py-3 px-4 font-semibold">שופט</th>
                    <th className="text-center py-3 px-4 font-semibold">בוצעו</th>
                    <th className="text-center py-3 px-4 font-semibold">מתוכננים</th>
                    <th className="text-center py-3 px-4 font-semibold">סה״כ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {refStats.map((ref, i) => (
                    <tr key={`${ref.type}-${ref.id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold ${medal(i)}`}>{i + 1}</span>
                          <div>
                            <p className="font-semibold text-sm text-slate-900 dark:text-white">{ref.first_name} {ref.last_name}</p>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${ref.type === 'player' ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                              {ref.type === 'player' ? 'שחקן-שופט' : 'חיצוני'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">{ref.completed}</td>
                      <td className="text-center py-3 px-4 text-slate-500 dark:text-slate-400">{ref.scheduled}</td>
                      <td className="text-center py-3 px-4">
                        <span className="bg-purple-500 text-white text-xs font-bold px-2.5 py-1 rounded-md">{ref.total}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {refStats.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">אין נתוני שיפוט</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
