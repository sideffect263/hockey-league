import { useState, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { getTeams, getPlayers, getGames, getReferees, getGameStats, getSeasonStatisticsData } from "@/lib/api"
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react"
import { TrendUp as TrendingUp, Crown, Trophy, Flame, Goalkeeper as Glove, Referee as Whistle, BlueCard, RedCard, GoalIcon as Goal, MatchFallback as Crossed, HatTrick, Mvp, TeamsIcon, PlayerPose } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { PlayerLink } from "@/components/EntityLinks"
import { useTheme } from "@/lib/ThemeContext"
import { useSeasonName } from "@/App"
import { seriesColors } from "@/lib/chartPalette"
import { teamSeriesColors, flPair } from "@/components/fl/teams/flChart"
import { multiGoalCounts } from "@/components/fl/teams/teamsData"
import { FLTPills } from "@/components/fl/teams/FLTeamsKit"
import { TeamBlend, FLScore } from "@/components/fl/Floodlight"
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

/**
 * /statistics for the live season — or, given `season` (an archived seasons row),
 * the same page for that past season, embedded in its /archive page: its frozen
 * player/team rows and box scores (getSeasonStatisticsData), no page header.
 */
export default function Statistics({ season = null }) {
  const { dark } = useTheme()
  const liveSeasonName = useSeasonName()
  const seasonName = season?.name || liveSeasonName
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

  useEffect(() => { loadData() }, [season?.id])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      if (season) {
        // A past season is already league-only (its archived rows), so no age filter.
        const [d, r] = await Promise.all([getSeasonStatisticsData(season.id), getReferees()])
        setTeams(d.teams); setPlayers(d.players); setGames(d.games); setReferees(r); setGameStats(d.gameStats)
        return
      }
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
    const colors = teamSeriesColors(teams, dark)
    const series = cumulativeTeamGoals(statGames, teams)
      .map(s => ({ ...s, id: s.teamId, color: colors[s.teamId] }))
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
  // Multi-goal games count ONLY 3 / 4 / 5+ goals (Ariel 10-28) — no דאבל anywhere.
  const multi = useMemo(() => multiGoalCounts(statGameStats, players), [statGameStats, players])
  const awardQuad = achievements.players
    .map(p => ({ ...p, quads: multi.players.get(p.id)?.four || 0 }))
    .filter(p => p.quads > 0).sort((a, b) => b.quads - a.quads)
  const awardClean = cleanSheetLeaders
  const awardBlue = bluePlayers
  // MVP picks by the officials, counted over the same competitive games as everything else.
  const awardMvp = useMemo(() => {
    const n = {}
    for (const g of statGames) if (g.mvp_player_id) n[g.mvp_player_id] = (n[g.mvp_player_id] || 0) + 1
    return players.filter(p => n[p.id]).map(p => ({ ...p, mvps: n[p.id] })).sort((a, b) => b.mvps - a.mvps)
  }, [statGames, players])

  // Entity colour follows the fixed team→slot map (same hues as the goal race).
  const teamColor = useMemo(() => {
    const colors = teamSeriesColors(teams, dark)
    return (id) => colors[id] || seriesColors(dark)[0]
  }, [teams, dark])

  const playersById = useMemo(() => new Map(players.map(p => [p.id, p])), [players])

  // Radar spoke labels for teams — abbreviate the long compound names so they
  // don't collide around the circle.
  const shortTeam = (nm = '') => nm.replace('גבעת עדה', 'גב״ע').replace('קריית', 'ק״')
  const intTicks = (m) => Array.from({ length: Math.max(1, m) }, (_, i) => i + 1)
  const radarScale = (vals) => {
    const m = Math.max(1, ...vals)
    // Counts of games are whole numbers: small maxima get integer rings (no 0.3 / 0.6).
    if (m <= 5) return { max: m, rings: intTicks(m) }
    const { yMax, ticks } = axisTicks(m)
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
    const div = flPair(dark)
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

    // radar — scoring profile: games with exactly 3, exactly 4 and 5+ goals (no 2-goal axis)
    const pal = seriesColors(dark)
    const AXES = ['3 שערים', '4 שערים', '5+ שערים']
    const mv = (m) => [m?.three || 0, m?.four || 0, m?.five || 0]
    const topPlayers = [...enriched].filter(a => a.hatTricks > 0).sort((x, y) => y.goals - x.goals).slice(0, 4)
    const radarPlayers = {
      axes: AXES,
      series: topPlayers.map((a, i) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`, color: pal[i % pal.length], values: mv(multi.players.get(a.id)) })),
      ...radarScale(topPlayers.flatMap(a => mv(multi.players.get(a.id)))),
    }
    const topTeams = [...teamAch].filter(t => t.hatTricks > 0).sort((x, y) => y.hatTricks - x.hatTricks).slice(0, 4)
    const radarTeams = {
      axes: AXES,
      series: topTeams.map(t => ({ id: t.teamId, name: t.name, color: teamColor(t.teamId), values: mv(multi.teams.get(t.teamId)) })),
      ...radarScale(topTeams.flatMap(t => mv(multi.teams.get(t.teamId)))),
    }

    return { scatterPlayers, scatterTeams, radarPlayers, radarTeams }
  }, [achievements, playersById, teams, teamAch, goalDiff, dark, teamColor, multi])

  const tabs = [
    { value: "scorers", label: "מבקיעים" },
    { value: "goalkeepers", label: "שוערים" },
    { value: "cards", label: "כרטיסים" },
    { value: "referees", label: "שופטים" },
  ]
  const teamById = (id) => teams.find(t => t.id === id)

  // Swatch+name legend for the radar views (series aren't teams, so no crest).
  const MiniLegend = ({ items = [] }) => (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
      {items.map(it => (
        <span key={it.id} className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted">
          <span className="w-3.5 h-1.5 rounded-full shrink-0" style={{ background: it.color }} aria-hidden="true" />
          <span className="whitespace-nowrap">{it.name}</span>
        </span>
      ))}
    </div>
  )

  // Board medals: amber, silver, bronze, then the raised track (all with ink numbers).
  const medal = (i) =>
    i === 0 ? 'bg-fl-accent text-[#11161D]' :
    i === 1 ? 'bg-[#C9CDD2] text-[#11161D]' :
    i === 2 ? 'bg-[#D9A066] text-[#11161D]' :
    'bg-surface-sunken text-fg-muted'

  const List = ({ title, icon, data, render, tKey, empty }) => {
    const exp = expanded[tKey]
    const show = exp ? data : data.slice(0, 5)
    return (
      <section className="rounded-card bg-surface px-3.5 pt-2 pb-2">
        <h3 className="flex items-center gap-2 my-2 text-[15px] font-extrabold text-fg-strong">{icon} {title}</h3>
        <div className="divide-y divide-line">
          {show.map((item, i) => render(item, i))}
        </div>
        {data.length === 0 && <p className="text-center text-fg-muted py-6 text-sm">{empty}</p>}
        {data.length > 5 && (
          <button onClick={() => toggle(tKey)} className="w-full min-h-[44px] flex items-center justify-center gap-1.5 text-[13px] font-bold text-fg-strong mt-1 rounded-control hover:bg-surface-sunken transition-colors">
            {exp ? <><ChevronUp className="w-4 h-4" aria-hidden="true" /> הצג פחות</> : <><ChevronDown className="w-4 h-4" aria-hidden="true" /> הצג הכל ({data.length})</>}
          </button>
        )}
      </section>
    )
  }

  const Num = ({ children, className = "bg-surface-sunken text-fg-strong" }) => (
    <span className={`fl-num text-[15px] min-w-[2rem] text-center px-2 py-1 rounded-lg shrink-0 ${className}`}>{children}</span>
  )

  const PlayerRow = ({ player, index, value, unit, badge }) => (
    <Link to={entityPath('players', player)} className="flex items-center gap-2.5 min-h-[50px] py-1 group">
      <span className={`size-6 rounded-[7px] flex items-center justify-center text-[12px] font-extrabold shrink-0 ${medal(index)}`}>{index + 1}</span>
      <TeamLogo team={teamById(player.team_id)} px={26} disc={false} />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[14px] font-semibold text-fg-strong group-hover:underline underline-offset-2">{player.first_name} {player.last_name}</span>
        <span className="block truncate text-[12px] text-fg-muted">{teamName(player.team_id)}</span>
      </span>
      {badge ? <Num className={badge}>{value}</Num> : <span className="text-[13px] font-bold text-fg-strong shrink-0"><span className="fl-num text-[15px]">{value}</span>{unit ? ` ${unit}` : ''}</span>}
    </Link>
  )

  // Compact award card: top-5 players, crest + name + value badge, links to the player page.
  const AwardCard = ({ title, icon, data, valueOf, unit, badge = "bg-fg-strong text-surface", empty = "אין נתונים", note }) => (
    <div className="rounded-[18px] bg-surface p-3 flex flex-col gap-2 min-h-[150px] min-w-0">
      <h3 className="flex items-center gap-2 text-[13px] font-extrabold leading-tight text-fg-strong">{icon} <span className="min-w-0">{title}</span></h3>
      <div className="flex flex-col gap-1">
        {data.slice(0, 5).map((p) => (
          <PlayerLink key={p.id} playerId={p.id} className="flex items-center gap-1.5 min-h-[32px] text-[12.5px] group">
            <TeamLogo team={teamById(p.team_id)} px={18} disc={false} />
            <span className="flex-1 min-w-0 truncate font-semibold text-fg-strong group-hover:underline underline-offset-2">{p.first_name} {p.last_name}</span>
            <span className={`fl-num text-[14px] px-[7px] py-0.5 rounded-[7px] shrink-0 ${badge}`}>{valueOf(p)}{unit ? <span className="font-sans not-italic font-bold text-[11px]"> {unit}</span> : null}</span>
          </PlayerLink>
        ))}
        {data.length === 0 && <p className="text-[12.5px] text-fg-muted leading-snug">{empty}</p>}
      </div>
      {note && <p className="text-[11px] text-fg-muted mt-auto pt-1">{note}</p>}
    </div>
  )

  if (loading) return <StatisticsSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="card p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-fl-red text-sm font-semibold">{error}</span>
          <button onClick={loadData} className="btn-primary min-h-[44px] inline-flex items-center gap-1.5 px-4 text-sm">
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  const biggest = summary.highestScoringGame
  const bigHome = biggest ? teamById(biggest.home_team_id) : null
  const bigAway = biggest ? teamById(biggest.away_team_id) : null
  const ddmm = (d) => new Date(d).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' }).replace('/', '.')

  return (
    <div className={season ? "space-y-6" : "px-3 pt-4 pb-8 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-5"}>
      {!season && (
        <header className="px-1">
          <h1 className="text-[28px] sm:text-[36px] font-extrabold leading-tight text-fg-strong">סטטיסטיקות</h1>
          <p className="text-[13px] text-fg-muted mt-0.5">נתוני ביצועים{seasonName && <> עונת <bdi dir="ltr">{seasonName}</bdi></>}</p>
        </header>
      )}

      {/* Overview tiles */}
      <section aria-label="העונה במספרים" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        <StatTile icon={<Crossed className="w-7 h-7" />} value={summary.completedGames} label="משחקים" />
        <StatTile icon={<Goal className="w-7 h-7" />} value={summary.totalGoals} label="שערים" accent="ink" spark={monthly.map(m => m.goals)} />
        <StatTile icon={<TrendingUp className="w-7 h-7" />} value={summary.avgPerGame.toFixed(1)} label="ממוצע למשחק" />
        <StatTile icon={<Glove className="w-7 h-7" />} value={summary.shutouts} label="בלימות · משחקים ללא ספיגה" />
        {biggest && (
          <TeamBlend as={Link} to={entityPath('games', biggest)} home={bigHome} away={bigAway}
            className="col-span-2 sm:col-span-4 lg:col-span-2 rounded-[18px] p-3.5 flex items-center gap-3 hover:brightness-110 transition">
            <Flame className="w-9 h-9 shrink-0" />
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[12px] font-bold text-fl-accent">משחק השיא</span>
              <span className="text-[14.5px] font-bold leading-snug">{teamName(biggest.home_team_id)} נגד {teamName(biggest.away_team_id)} · <bdi dir="ltr">{ddmm(biggest.game_date)}</bdi></span>
            </span>
            <FLScore home={biggest.home_score} away={biggest.away_score} size={26} />
          </TeamBlend>
        )}
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
        {/* Main chart — the goal race, full width, with a קבוצה / שחקן toggle. Time runs right → left. */}
        <ChartCard
          className="lg:col-span-2"
          title="מרוץ השערים"
          subtitle={raceMode === 'team'
            ? 'שערים מצטברים לאורך העונה, לפי קבוצה'
            : 'שערים מצטברים לאורך העונה · 8 המבקיעים המובילים'}
          footnote={raceMode === 'player' ? STATS_NOTE : undefined}
          toolbar={
            <SegToggle
              value={raceMode}
              onChange={setRaceMode}
              options={[
                { id: 'team', label: 'קבוצה', icon: <TeamsIcon className="w-4 h-4" /> },
                { id: 'player', label: 'שחקן', icon: <PlayerPose pose={3} className="w-4 h-4" /> },
              ]}
            />
          }
          legend={<Legend items={raceMode === 'team' ? legendItems : playerLegend} />}
        >
          <div className="mx-auto w-full max-w-3xl">
            <LineChart series={raceMode === 'team' ? raceSeries : playerRaceSeries} xTicks={xTicks} vbH={200} rtl />
          </div>
        </ChartCard>

        <ChartCard
          title="הפרש שערים"
          subtitle={gdView === 'scatter'
            ? 'התקפה מול הגנה: כל קבוצה על המפה'
            : 'זכות מול חובה: מכ״ם קבוצתי'}
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
          title="שלישיות"
          subtitle={hatView === 'radar'
            ? 'פרופיל הבקעה: משחקים עם 3, 4 ו־5+ שערים'
            : hatMode === 'player'
              ? 'נפח מול נפיצות: שערים מול שלישיות'
              : 'שערי קבוצה מול שלישיות'}
          footnote={`סופרים רק משחקים שבהם שחקן אחד הבקיע 3, 4 או 5 ומעלה. 2 שערים לא נספרים. ${STATS_NOTE}`}
          toolbar={
            <div className="flex flex-wrap items-center gap-1.5">
              <SegToggle
                value={hatMode}
                onChange={setHatMode}
                options={[
                  { id: 'player', label: 'שחקן', icon: <PlayerPose pose={3} className="w-4 h-4" /> },
                  { id: 'team', label: 'קבוצה', icon: <TeamsIcon className="w-4 h-4" /> },
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
      <section aria-label="הישגים ותארים">
        <h2 className="flex items-center gap-2 px-1.5 mb-2.5 text-[19px] font-extrabold text-fg-strong">
          <Trophy className="w-6 h-6" /> הישגים ותארים
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <AwardCard title="MVP של המשחק" icon={<Mvp className="w-7 h-7" />} data={awardMvp} valueOf={p => p.mvps} badge="bg-[#8A5E08] text-white" empty="טרם נבחרו MVP העונה" />
          <AwardCard title="מלכי השלישיות" icon={<HatTrick className="w-7 h-7" />} data={awardHat} valueOf={p => p.hatTricks} empty="אין שלישיות" note={STATS_NOTE} />
          <AwardCard title="משחקי־על (5+ שערים)" icon={<Flame className="w-7 h-7" />} data={awardBig} valueOf={p => p.bigGames} badge="bg-[#B23F08] text-white" empty="אין" note={STATS_NOTE} />
          <AwardCard title="רביעיות (4 שערים)" icon={<Goal className="w-7 h-7" />} data={awardQuad} valueOf={p => p.quads} badge="bg-[#5B616B] text-white" empty="אין" note={STATS_NOTE} />
          <AwardCard title="שוערי הברזל" icon={<Glove className="w-7 h-7" />} data={awardClean} valueOf={p => p.clean_sheets} unit="נקיות" badge="bg-[#1550D8] text-white" empty="טרם נרשמו משחקים ללא ספיגה" />
          <AwardCard title="כרטיסים כחולים" icon={<BlueCard className="w-7 h-7" />} data={awardBlue} valueOf={p => p.blue_cards} badge="bg-[#2560C4] text-white" empty="אין" />
        </div>
      </section>

      {/* Detailed tabbed lists */}
      <section aria-label="רשימות" className="space-y-3 pt-1">
        <FLTPills label="רשימות" items={tabs} value={activeTab} onChange={setActiveTab} />

        {activeTab === "scorers" && (
          <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
            <List title="מלכי השערים" icon={<Crown className="w-5 h-5" />} data={topScorers} tKey="top" empty="טרם נרשמו שערים העונה"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.goals || 0} unit="שערים" />} />
            <List title="מצטיין מכל קבוצה" icon={<Crown className="w-5 h-5" />} data={topPerTeam} tKey="perTeam" empty="טרם נרשמו שערים העונה"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.goals || 0} badge="bg-fl-accent text-[#11161D]" />} />
          </div>
        )}

        {activeTab === "goalkeepers" && (
          <List title="שוערי הברזל" icon={<Glove className="w-5 h-5" />} data={cleanSheetLeaders} tKey="gk" empty="טרם נרשמו משחקים ללא ספיגה"
            render={(gk, i) => (
              <Link key={gk.id} to={entityPath('players', gk)} className="flex items-center gap-2.5 min-h-[50px] py-1 group">
                <span className={`size-6 rounded-[7px] flex items-center justify-center text-[12px] font-extrabold shrink-0 ${medal(i)}`}>{i + 1}</span>
                <TeamLogo team={teamById(gk.team_id)} px={26} disc={false} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-fg-strong group-hover:underline underline-offset-2">{gk.first_name} {gk.last_name}</span>
                  <span className="block truncate text-[12px] text-fg-muted">{teamName(gk.team_id)} · <span className="tabular-nums">{gk.total_games}</span> משחקים</span>
                </span>
                <Num className="bg-[#1550D8] text-white">{gk.clean_sheets}</Num>
                <span className="text-[12px] text-fg-muted">נקיות</span>
              </Link>
            )} />
        )}

        {activeTab === "cards" && (
          <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
            <List title="כרטיסים כחולים" icon={<BlueCard className="w-6 h-6 -my-1" />} data={bluePlayers} tKey="blue" empty="אין"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.blue_cards} badge="bg-[#2560C4] text-white" />} />
            <List title="כחולים לפי קבוצה" icon={<TeamsIcon className="w-5 h-5" />} data={blueTeams} tKey="blueT" empty="אין"
              render={(t) => (
                <Link key={t.id} to={entityPath('teams', t)} className="flex items-center gap-2.5 min-h-[50px] py-1 group">
                  <TeamLogo team={t} px={28} />
                  <span className="flex-1 min-w-0 truncate text-[14px] font-semibold text-fg-strong group-hover:underline underline-offset-2">{t.name}</span>
                  <Num className="bg-[#2560C4] text-white">{t.total_blue}</Num>
                </Link>
              )} />
            <List title="כרטיסים אדומים" icon={<RedCard className="w-6 h-6 -my-1" />} data={redPlayers} tKey="red" empty="אין"
              render={(p, i) => <PlayerRow key={p.id} player={p} index={i} value={p.red_cards} badge="bg-fl-red text-white" />} />
          </div>
        )}

        {activeTab === "referees" && (
          <section className="rounded-card bg-surface overflow-hidden">
            <h3 className="flex items-center gap-2 px-4 pt-3 pb-2 text-[15px] font-extrabold text-fg-strong"><Whistle className="w-5 h-5" /> שופטים</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[11px] text-fg-muted">
                    <th scope="col" className="text-right py-2.5 px-4 font-semibold">שופט</th>
                    <th scope="col" className="text-center py-2.5 px-3 font-semibold">בוצעו</th>
                    <th scope="col" className="text-center py-2.5 px-3 font-semibold">מתוכננים</th>
                    <th scope="col" className="text-center py-2.5 px-4 font-semibold">סה״כ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {refStats.map((ref, i) => (
                    <tr key={`${ref.type}-${ref.id}`}>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <span className={`size-6 rounded-[7px] flex items-center justify-center text-[12px] font-extrabold shrink-0 ${medal(i)}`}>{i + 1}</span>
                          <div className="min-w-0">
                            <p className="font-semibold text-[14px] text-fg-strong truncate">{ref.first_name} {ref.last_name}</p>
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-surface-sunken text-fg-muted">
                              {ref.type === 'player' ? 'שחקן-שופט' : 'חיצוני'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="text-center py-2.5 px-3 font-semibold tabular-nums text-fg-strong">{ref.completed}</td>
                      <td className="text-center py-2.5 px-3 tabular-nums text-fg-muted">{ref.scheduled}</td>
                      <td className="text-center py-2.5 px-4"><Num className="bg-fg-strong text-surface">{ref.total}</Num></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {refStats.length === 0 && <p className="text-center text-fg-muted py-8 text-sm">אין נתוני שיפוט</p>}
            </div>
          </section>
        )}
      </section>
    </div>
  )
}
