import { useState, useEffect } from "react"
import { GoalIcon as Ball, Hourglass, BlueCard, RedCard, Flame, HatTrick, Goalkeeper, Trophy, PersonClaim, PersonAdd as UserPlus, Tag as AtSign } from "@/components/icons/BrandIcons"
import { useParams, Link } from "react-router-dom"
import { getPlayers, getTeams, getGames, getGameStats, getLeagueSetting, getPlayerRoleBadges } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { AGE_LABEL, DEFAULT_AGE, ageOf } from "@/lib/ageGroups"
import { countsForStats, FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { useAuth } from "@/lib/AuthContext"
import { useSeasonMode } from "@/App"
import { getClaimContext, createClaim, cancelClaim } from "@/lib/claims"
import { linkRequestErrorMessage } from "@/lib/linkRequests"
import { ArrowRight, RefreshCw, Check } from "lucide-react"
import { format } from "date-fns"
import { he } from "date-fns/locale"
import TeamLogo from "@/components/TeamLogo"
import PastSeasons from "@/components/PastSeasons"
import TeamMembershipCard from "@/components/TeamMembershipCard"
import { RoleBadge, deriveRoleItems } from "@/components/RoleBadges"
import { teamTint } from "@/lib/flTeam"
import { FLScore } from "@/components/fl/Floodlight"
import {
  heroPalette, heroSurfaces, FLTHero, FLTStatsRow, FLTPills, FLTPlayerFace, KeeperStickMark,
  FLTGoalCage, rowWash, FLTResultSquare,
} from "@/components/fl/teams/FLTeamsKit"
import { useSeo } from '@/lib/seo'
import { useSlugId, entityPath } from '@/lib/slugs'
import FollowButton from "@/components/FollowButton"
import { ShareFollowButton, FollowInvite } from "@/components/ShareFollow"
import { PlayerDetailSkeleton } from "@/components/skeletons/PageSkeletons"
import { getPlayerMentions } from "@/lib/mentionsApi"
import { sizedImage } from "@/lib/imageSize"
import TeamMedia from "@/components/TeamMedia"
import { getPlayerMedia } from "@/lib/teamMedia"
import { ilDate } from "@/lib/ilTime"
import { supabase } from "@/lib/supabase"
import { playerSummary } from "@/lib/pageSummary"

export default function PlayerDetail() {
  // The route param is a Hebrew slug (/players/יואב-תורגמן) or, for every link
  // ever shared before slugs existed, a UUID. useSlugId hands the rest of this
  // page the UUID either way, so nothing below had to change.
  const { id: routeKey } = useParams()
  const { id, notFound: unknownRoute } = useSlugId('players', routeKey)
  const [player, setPlayer] = useState(null)
  const [allPlayers, setAllPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [games, setGames] = useState([])
  const [gameStats, setGameStats] = useState([])
  const [playerTeams, setPlayerTeams] = useState([])
  const [championId, setChampionId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [logFilter, setLogFilter] = useState("all")
  const { user, loading: authLoading, openAuth } = useAuth()
  const { seasonMode } = useSeasonMode()
  const [claimCtx, setClaimCtx] = useState(null)
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimErr, setClaimErr] = useState(null)
  const [accountBadges, setAccountBadges] = useState(null) // { isAdmin, roles } | null
  const [tagged, setTagged] = useState([]) // "תויג/ה ב…" — posts/comments this player is @-tagged in
  const [pastSeasons, setPastSeasons] = useState([]) // archived-season lines, for "על השחקן"
  const [media, setMedia] = useState(null) // the team-page media wall, scoped to the games this player played

  const playerName = player ? `${player.first_name} ${player.last_name}` : null
  useSeo({
    title: playerName || 'שחקן',
    description: playerName ? `סטטיסטיקות, שערים וכרטיסים של ${playerName} בליגת הוקי הגלגיליות הישראלית` : undefined,
    path: entityPath('players', player) || `/players/${routeKey}`,
  })

  useEffect(() => {
    if (id) loadData()
    else if (unknownRoute) { setError('השחקן לא נמצא'); setLoading(false) }
  }, [id, unknownRoute])

  // The same archived-season rows PastSeasons lists — the summary sentence totals them.
  useEffect(() => {
    let alive = true
    if (!player?.id) return
    supabase.from("player_season_stats").select("goals, games_played, team_name, season:seasons(name)").eq("player_id", player.id)
      .then(({ data }) => alive && setPastSeasons((data || []).filter(r => r.season).sort((a, b) => b.season.name.localeCompare(a.season.name))))
    return () => { alive = false }
  }, [player?.id])

  // Load claim state for this player once it (and the auth user) are known.
  useEffect(() => {
    let alive = true
    setClaimCtx(null); setClaimErr(null)
    if (!player) return
    getClaimContext(player.id).then(c => alive && setClaimCtx(c)).catch(() => alive && setClaimCtx(null))
    return () => { alive = false }
  }, [player?.id, user])

  useEffect(() => {
    let alive = true
    setTagged([])
    if (!player?.id) return
    getPlayerMentions(player.id, 10).then(rows => alive && setTagged(rows))
    return () => { alive = false }
  }, [player?.id])

  // Media wall: clips / photos / full games / stories from the games this player has a
  // box-score row in, plus posts they're @-tagged in. Hidden when empty.
  useEffect(() => {
    let alive = true
    setMedia(null)
    if (!player?.id || !games.length) return
    const played = new Set(gameStats.filter(s => s.player_id === player.id).map(s => s.game_id))
    const myGames = games.filter(g => played.has(g.id))
    const taggedPosts = tagged.filter(t => t.kind === 'post').map(t => (/^\/posts\/([^/?#]+)/.exec(t.href) || [])[1]).filter(Boolean)
    getPlayerMedia(myGames, taggedPosts)
      .then(m => { if (alive) setMedia(m) })
      .catch(e => { console.error(e); if (alive) setMedia([]) })
    return () => { alive = false }
  }, [player?.id, games, gameStats, tagged])

  // Public league-role badges for the account (if any) linked to this player.
  useEffect(() => {
    let alive = true
    setAccountBadges(null)
    if (!player?.id) return
    getPlayerRoleBadges(player.id).then(b => alive && setAccountBadges(b)).catch(() => {})
    return () => { alive = false }
  }, [player?.id])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [players, t, g, gs, champ, pt] = await Promise.all([
        getPlayers(), getTeams(), getGames(), getGameStats(),
        getLeagueSetting('champion_team_id').catch(() => null),
        getPlayerTeams().catch(() => []),
      ])
      const p = players.find(pl => pl.id === id)
      if (!p) { setError("השחקן לא נמצא"); return }
      setPlayer(p); setAllPlayers(players); setTeams(t); setGames(g); setGameStats(gs); setChampionId(champ); setPlayerTeams(pt)
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  if (loading) return <PlayerDetailSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <div className="flex gap-2">
            <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
            </button>
            <Link to="/players" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors">
              <ArrowRight className="w-3.5 h-3.5" /> חזרה לשחקנים
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const gamesMap = Object.fromEntries(games.map(g => [g.id, g]))
  const team = teamsMap[player.team_id]
  // Every team the player belongs to (one per age group), senior/primary first.
  const { byPlayer: membersByPlayer } = buildMemberMaps(playerTeams, allPlayers)
  const myTeams = (membersByPlayer.get(player.id) || [])
    .map(m => ({ team: teamsMap[m.team_id], age: m.age_group || ageOf(teamsMap[m.team_id]) }))
    .filter(x => x.team)
    .sort((a, b) => (a.age === DEFAULT_AGE ? -1 : b.age === DEFAULT_AGE ? 1 : 0))
  const isGK = player.position === 'Goalkeeper'
  const positionLabel = isGK ? 'שוער' : 'שחקן שדה'

  // Goalkeeper clean sheets — computed exactly like Statistics.jsx: every
  // COMPLETED game the player's team played where the opponent was held to 0.
  // Friendly (ידידותי) games never count toward the competitive record.
  const done = games.filter(g => g.status === 'completed' && countsForStats(g))
  const teamGames = isGK ? done.filter(g => g.home_team_id === player.team_id || g.away_team_id === player.team_id) : []
  const cleanSheets = teamGames.filter(g => (g.home_team_id === player.team_id ? g.away_score : g.home_score) === 0).length

  // Season totals — AUTHORITATIVE from the players row (never recomputed from
  // game_stats; see hockey-league-stats-backfill memory).
  const tiles = [
    { val: player.goals || 0, label: "שערים", color: "text-emerald-600 dark:text-emerald-400" },
    { val: player.games_played || 0, label: "משחקים", color: "text-slate-700 dark:text-slate-300" },
    { val: player.blue_cards || 0, label: "כחולים", color: "text-blue-600 dark:text-blue-400" },
    { val: player.red_cards || 0, label: "אדומים", color: "text-red-500 dark:text-red-400" },
  ]
  if (isGK) tiles.splice(1, 0, { val: cleanSheets, label: "נקיים", color: "text-blue-500 dark:text-blue-400" })

  // Per-game log built from recorded box scores (game_stats) joined to games.
  // May be shorter than games_played for players whose historical box scores
  // are incomplete — that's expected (see backfill memory).
  const gameLog = gameStats
    .filter(s => s.player_id === player.id)
    .map(s => ({ stat: s, game: gamesMap[s.game_id] }))
    .filter(x => x.game)
    .sort((a, b) => new Date(b.game.game_date) - new Date(a.game.game_date))

  // "על השחקן" — the same sentences api/seo.js gives search bots (one source: lib/pageSummary).
  const last = gameLog[0]?.game
  const summary = playerSummary({
    player, team,
    past: pastSeasons.map(r => ({ seasonName: r.season.name, teamName: r.team_name, goals: r.goals, games_played: r.games_played })),
    lastGame: last ? { ...last, home: teamsMap[last.home_team_id]?.name || 'בית', away: teamsMap[last.away_team_id]?.name || 'חוץ', goals: gameLog[0].stat.goals || 0 } : null,
  })

  // Result (from the player's team perspective) for a given game.
  const resultOf = (game) => {
    const isHome = game.home_team_id === player.team_id
    const my = isHome ? game.home_score : game.away_score
    const opp = isHome ? game.away_score : game.home_score
    return my > opp ? 'win' : my < opp ? 'loss' : 'tie'
  }

  // Last-5 form (most recent first), across all competitions — friendlies excluded.
  const form = gameLog.filter(x => countsForStats(x.game)).slice(0, 5).map(x => resultOf(x.game))

  // ----- Achievements & season honors (derived like the home feed) -----
  // Season titles:
  const topScorer = allPlayers
    .filter(pl => pl.position === 'Field Player' && (pl.goals || 0) > 0)
    .reduce((best, pl) => ((pl.goals || 0) > (best?.goals || 0) ? pl : best), null)
  const seasonOver = seasonMode === 'final_four' && !!championId
  const isTopScorer = seasonOver && !!topScorer && topScorer.id === player.id
  const isChampion = seasonOver && championId === player.team_id

  // Per-game scoring milestones from recorded box scores (3-4 = hat-trick, 5+ =
  // big game). Friendlies never count toward achievements/honors.
  const milestoneGames = gameLog
    .filter(x => (x.stat.goals || 0) >= 3 && countsForStats(x.game))
    .map(x => {
      const isHome = x.game.home_team_id === player.team_id
      return {
        id: x.stat.id,
        game: x.game,
        opp: teamsMap[isHome ? x.game.away_team_id : x.game.home_team_id],
        goals: x.stat.goals,
        kind: (x.stat.goals || 0) >= 5 ? 'big_game' : 'hat_trick',
      }
    })
  const hatTricks = milestoneGames.filter(m => m.kind === 'hat_trick').length
  const bigGames = milestoneGames.filter(m => m.kind === 'big_game').length

  const honors = []
  if (isChampion) honors.push({ key: 'champ', icon: Trophy, label: 'אלוף העונה', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' })
  if (isTopScorer) honors.push({ key: 'scorer', icon: Flame, label: 'מלך השערים', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' })

  const hasAchievements = honors.length > 0 || milestoneGames.length > 0 || (isGK && cleanSheets > 0)

  // Competition filter for the log.
  const comps = [
    { id: "all", label: "הכל" },
    { id: "ליגה", label: "ליגה" },
    { id: "פלייאוף", label: "פלייאוף" },
    { id: FRIENDLY_GAME_TYPE, label: "ידידותי" },
  ].filter(c => c.id === "all" || gameLog.some(x => x.game.game_type === c.id))
  const filteredLog = logFilter === "all" ? gameLog : gameLog.filter(x => x.game.game_type === logFilter)

  // ----- claim-your-player state -----
  const refreshClaim = () => getClaimContext(player.id).then(setClaimCtx).catch(() => {})
  const handleClaim = async () => {
    setClaimBusy(true); setClaimErr(null)
    try { await createClaim(player.id); await refreshClaim() }
    catch (e) { setClaimErr(linkRequestErrorMessage(e)); refreshClaim() }
    finally { setClaimBusy(false) }
  }
  const handleCancelClaim = async () => {
    if (!claimCtx?.pendingClaim) return
    setClaimBusy(true); setClaimErr(null)
    try { await cancelClaim(claimCtx.pendingClaim.id); await refreshClaim() }
    catch { setClaimErr('שגיאה בביטול הבקשה') }
    finally { setClaimBusy(false) }
  }
  const owned = claimCtx && claimCtx.profile?.player_id === player.id
  const pendingHere = claimCtx?.pendingClaim && claimCtx.pendingClaim.player_id === player.id
  // A pending NEW-card submission blocks a claim too (one open request per account).
  const pendingElsewhere = (claimCtx?.pendingClaim && claimCtx.pendingClaim.player_id !== player.id) || !!claimCtx?.pendingSubmission
  const takenByOther = claimCtx && claimCtx.playerOwnerId && claimCtx.playerOwnerId !== claimCtx.userId
  const linkedElsewhere = claimCtx && claimCtx.profile?.player_id && claimCtx.profile.player_id !== player.id
  const canClaim = claimCtx && !owned && !takenByOther && !pendingHere && !pendingElsewhere && !linkedElsewhere

  // ----- Floodlight hero -----
  const basePal = heroPalette(team)
  // A keeper's hero is always dark (the cage is drawn in white), even for a light team.
  const pal = isGK && basePal.light
    ? { c1: '#5B616B', mid: '#2A2F37', c2: '#0B0F14', light: false, ink: '#FFFFFF', tint: basePal.tint }
    : basePal
  const surf = heroSurfaces(pal)
  const heroTone = pal.light ? "light" : true
  const tint = team ? teamTint(team) : '#5B616B'
  const fullName = `${player.first_name} ${player.last_name}`.trim()
  // Completed competitive games with his team's score (chart + keeper numbers).
  const counted = gameLog
    .filter(x => x.game.status === 'completed' && countsForStats(x.game) && x.game.home_score != null)
    .map(x => {
      const isHome = x.game.home_team_id === player.team_id
      const mine = isHome ? x.game.home_score : x.game.away_score
      const theirs = isHome ? x.game.away_score : x.game.home_score
      return { ...x, mine, theirs, opp: teamsMap[isHome ? x.game.away_team_id : x.game.home_team_id] }
    })
  const conceded = counted.reduce((n, e) => n + e.theirs, 0)
  const wins = counted.filter(e => e.mine > e.theirs).length
  const gp = player.games_played || 0
  const heroStats = isGK
    ? [
        { value: gp, label: 'משחקים' },
        { value: counted.length ? conceded : '—', label: 'ספג' },
        { value: counted.length ? (conceded / counted.length).toFixed(2) : '—', label: 'ממוצע ספיגה', highlight: true },
        { value: cleanSheets, label: 'נקיים' },
      ]
    : [
        { value: gp, label: 'משחקים' },
        { value: player.goals || 0, label: 'שערים', highlight: true },
        { value: gp > 0 ? ((player.goals || 0) / gp).toFixed(2) : '—', label: 'למשחק' },
        { value: counted.length ? wins : '—', label: 'ניצחונות' },
      ]
  const roleItems = accountBadges ? deriveRoleItems({ isAdmin: accountBadges.isAdmin, roles: accountBadges.roles, teamsMap }) : []
  const heroTag = (text, key, extra = {}) => (
    <span key={key} className="text-[12px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap" style={{ background: surf.soft, ...extra }}>{text}</span>
  )
  const chartGames = counted.slice(0, 8).reverse() // oldest first = on the right (RTL)
  const chartVals = chartGames.map(e => (isGK ? e.theirs : e.stat.goals || 0))
  const chartMax = Math.max(1, ...chartVals)
  const best = isGK && chartGames.length > 1 ? Math.min(...chartVals) : null
  const avgConceded = isGK && chartGames.length ? chartVals.reduce((a, b) => a + b, 0) / chartGames.length : null
  const ddmm = (d) => format(ilDate(d), "d.M")
  // Bar plot in px: the value label sits above each bar, so heights and the average line
  // share one scale (PLOT px for the tallest bar).
  const PLOT = isGK ? 96 : 86
  const px = (v) => Math.round((v / chartMax) * PLOT)
  const milestoneTitle = (m) => (m.goals >= 5 ? 'משחק ענק' : m.goals === 4 ? 'רביעייה' : 'שלושער')

  return (
    <div className="pb-8">
      <FLTHero palette={pal} rink={!isGK} className="sm:mx-6 lg:mx-auto lg:max-w-5xl sm:mt-4 px-4 pt-4 pb-6 sm:px-6"
        style={isGK ? { backgroundImage: `linear-gradient(165deg, ${pal.c2} 0%, ${pal.mid} 55%, ${pal.c1} 100%)` } : undefined}>
        {!isGK && team?.logo_url && (
          <img src={sizedImage(team.logo_url, 300, 'contain')} alt="" aria-hidden="true"
            className={`pointer-events-none absolute -left-16 top-16 w-[300px] h-[300px] object-contain -z-10 ${pal.light ? "opacity-[0.06]" : "opacity-[0.12]"}`} />
        )}
        {isGK && <FLTGoalCage className="pointer-events-none absolute inset-x-0 top-[76px] mx-auto w-[86%] max-w-[360px] -z-10" />}

        <div className="flex items-center justify-between gap-2">
          <Link to="/players" aria-label="חזרה לשחקנים" className="size-11 rounded-full inline-flex items-center justify-center" style={{ background: surf.chip, color: pal.ink }}>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <FollowButton targetType="player" targetId={player.id} size="sm" onDark={heroTone} />
            <ShareFollowButton targetType="player" name={fullName} onDark={heroTone} />
          </div>
        </div>

        <div className={`flex flex-col items-center text-center ${isGK ? 'mt-7' : 'mt-4'}`}>
          <span className="rounded-full shadow-[0_6px_20px_rgba(0,0,0,.2)]">
            <FLTPlayerFace player={player} team={team} size={140} ring={owned && !isGK ? 'rgb(var(--fl-accent))' : '#FAF9F6'} ringWidth={4} />
          </span>
          {/* Crest + team name in a light pill (a keeper: dark pill, "שוער · <team>"). Opens the team page. */}
          {(() => {
            const chip = (
              <span className={`-mt-[18px] relative inline-flex items-center gap-1.5 h-[34px] ps-1.5 pe-3 rounded-full shadow-[0_4px_14px_rgba(0,0,0,.25)] ${isGK ? 'bg-[#11161D] text-white' : 'bg-fl-disc text-[#11161D]'}`}>
                {isGK ? <KeeperStickMark size={22} className="!text-white" title="שוער" /> : team && <TeamLogo team={team} px={26} disc={false} />}
                <span className="text-[13px] font-bold whitespace-nowrap">{isGK ? `שוער · ${team?.name || 'שחקן חופשי'}` : (team?.name || 'שחקן חופשי')}</span>
              </span>
            )
            return team ? <Link to={entityPath('teams', team)} className="min-h-[44px] inline-flex items-start">{chip}</Link> : chip
          })()}
          <h1 className="mt-2 text-[32px] sm:text-[38px] font-extrabold leading-[1.05]">{fullName}</h1>
          <div className="flex flex-wrap justify-center gap-1.5 mt-2.5 max-w-xl">
            {!isGK && heroTag('שחקן שדה', 'pos')}
            {player.og_number && <span dir="ltr" aria-label={`OG מספר ${player.og_number}`} className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-[#11161D] text-fl-accent">OG #{player.og_number}</span>}
            {owned && <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-fl-accent text-[#11161D]">הכרטיס שלי</span>}
            {team?.captain_player_id === player.id && heroTag('קפטן', 'cap')}
            {player.jersey_number != null && heroTag(<bdi dir="ltr">#{player.jersey_number}</bdi>, 'num')}
            {player.is_core && heroTag('סגל קבוע', 'core')}
            {roleItems.map(it => <RoleBadge key={it.role} role={it.role} team={it.team} />)}
            {player.is_referee && !roleItems.some(it => it.role === 'judge') && heroTag('שופט', 'ref')}
            {player.age != null && heroTag(`גיל ${player.age}`, 'age')}
            {pastSeasons.length > 0 && heroTag(`עונה ${pastSeasons.length + 1} בליגה`, 'seasons')}
            {myTeams.filter(x => x.team.id !== team?.id).map(({ team: tm, age }) => (
              <Link key={tm.id} to={entityPath('teams', tm)} className="inline-flex items-center gap-1 text-[12px] font-bold ps-1 pe-2.5 py-0.5 rounded-lg" style={{ background: surf.soft }}>
                <TeamLogo team={tm} px={20} /> {tm.name}{age !== DEFAULT_AGE ? ` · ${AGE_LABEL[age]}` : ''}
              </Link>
            ))}
          </div>
        </div>

        {/* Stat panel */}
        <div className="mt-5 rounded-[20px] py-3.5 max-w-xl mx-auto flex flex-col gap-2.5" style={{ background: surf.panel, border: `1px solid ${surf.panelBorder}` }}>
          <FLTStatsRow palette={pal} items={heroStats} />
          <div className="h-px mx-3.5" style={{ background: surf.rule }} />
          <div className="flex items-center justify-center gap-3.5 text-[12px]">
            {isGK && <span className="inline-flex items-center gap-1"><span className="fl-num text-[15px]">{player.goals || 0}</span><span style={{ color: surf.sub }}>שערים</span></span>}
            <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="w-[9px] h-3 rounded-[2px] bg-fl-blue" /><span className="fl-num text-[15px]">{player.blue_cards || 0}</span><span style={{ color: surf.sub }}>כחולים</span></span>
            <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="w-[9px] h-3 rounded-[2px] bg-fl-red" /><span className="fl-num text-[15px]">{player.red_cards || 0}</span><span style={{ color: surf.sub }}>אדומים</span></span>
          </div>
        </div>
      </FLTHero>

      <div className="px-3 sm:px-6 lg:px-8 max-w-5xl mx-auto mt-4 space-y-4">
        <FollowInvite targetType="player" targetId={player.id} name={fullName} />

        {/* Claim-your-player */}
        {!authLoading && (owned || pendingHere || takenByOther || pendingElsewhere || linkedElsewhere || canClaim || !user) && (
          <section aria-label="בקשת בעלות" className={`rounded-[18px] bg-surface p-3.5 flex items-center gap-3 ${!owned && !pendingHere && !takenByOther && !pendingElsewhere && !linkedElsewhere ? 'border-[1.5px] border-dashed border-line' : ''}`}>
            {owned ? (
              <span className="flex items-center gap-2 text-[14px] font-bold text-fg-strong">
                <Check className="w-5 h-5" aria-hidden="true" /> זה הפרופיל שלך
              </span>
            ) : pendingHere ? (
              <>
                <span className="flex-1 flex items-center gap-2 text-[14px] font-medium text-fg-strong">
                  <Hourglass className="w-5 h-5 shrink-0" /> בקשת הבעלות נשלחה — ממתינה לאישור מנהל
                </span>
                <button onClick={handleCancelClaim} disabled={claimBusy}
                  className="min-h-[44px] px-3.5 rounded-control bg-surface-sunken text-[13px] font-bold text-fg-strong disabled:opacity-50 shrink-0">
                  ביטול
                </button>
              </>
            ) : takenByOther ? (
              <span className="text-[14px] text-fg-muted">
                פרופיל זה כבר משויך לחשבון קיים
                {/* The usual cause is the same person with a second account (Apple in the
                    app, Google here) — tell them how out, instead of a dead end. */}
                {user && !claimCtx?.profile?.player_id && (
                  <span className="block text-[12px] mt-1">
                    זה הכרטיס שלך? כנראה נרשמת בעבר בדרך אחרת (Google / Apple / אימייל). התנתק/י והיכנס/י באותה דרך — או פנה/י למנהל הליגה לאיחוד החשבונות.
                  </span>
                )}
              </span>
            ) : pendingElsewhere ? (
              <span className="text-[14px] text-fg-muted">
                {claimCtx?.pendingSubmission ? "כבר הגשת כרטיס שחקן חדש לאישור" : "כבר הגשת בקשת בעלות על שחקן אחר"} — אפשר לבטל בעמוד <Link to="/me" className="underline">החשבון</Link>
              </span>
            ) : linkedElsewhere ? (
              <span className="text-[14px] text-fg-muted">החשבון שלך כבר משויך לשחקן אחר</span>
            ) : (
              <>
                <span className="size-11 shrink-0 rounded-[14px] bg-[#11161D] inline-flex items-center justify-center"><PersonClaim className="w-6 h-6" /></span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-fg-strong">{!user ? 'שיחקת בליגה?' : 'זה הכרטיס שלך?'}</span>
                  <span className="text-[12px] text-fg-muted leading-snug">{!user ? 'התחבר/י ודרוש/י בעלות על הפרופיל' : 'הכרטיס עוד לא מקושר לחשבון. מנהל הליגה מאשר כל בקשה.'}</span>
                </span>
                {!user ? (
                  <button onClick={openAuth} className="btn-primary min-h-[44px] inline-flex items-center gap-1.5 px-4 text-[13px] shrink-0">
                    <UserPlus className="w-4 h-4" /> התחברות
                  </button>
                ) : (
                  <button onClick={handleClaim} disabled={claimBusy} className="btn-primary min-h-[44px] px-4 text-[13px] shrink-0 disabled:opacity-50">
                    {claimBusy ? 'שולח…' : 'זה אני'}
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {claimErr && <p className="text-[12px] font-semibold text-fl-red -mt-2 px-1">{claimErr}</p>}

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4 min-w-0">
            {owned && (
              <section className="rounded-card bg-surface p-4">
                <h3 className="text-[13px] font-extrabold text-fg-muted">הקבוצה שלי</h3>
                <TeamMembershipCard player={player} onChange={() => getPlayers().then(ps => setPlayer(ps.find(p => p.id === id) || null)).catch(() => {})} />
              </section>
            )}

            <section aria-label="על השחקן" className="rounded-card bg-surface p-4">
              <h2 className="text-[20px] font-extrabold text-fg-strong mb-1.5">על השחקן</h2>
              <p className="text-[14px] leading-relaxed text-fg-strong/90">{summary.join(' ')}</p>
            </section>

            {/* Goals (field) / conceded (keeper) per game — oldest on the right */}
            {chartGames.length > 0 && (
              <section aria-label={isGK ? "ספיגות לפי משחק" : "שערים לפי משחק"} className="rounded-[20px] bg-surface px-3.5 pt-4 pb-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[20px] font-extrabold text-fg-strong">{isGK ? "ספיגות לפי משחק" : "שערים לפי משחק"}</h2>
                  <span className="text-[12px] text-fg-muted">{isGK ? "נמוך = טוב · מהישן לחדש" : "מהישן לחדש"}</span>
                </div>
                <div className="relative flex items-end gap-1.5 mt-4 border-b-[1.5px] border-line" style={{ height: isGK ? 130 : 120 }}>
                  {avgConceded != null && (
                    <>
                      <span aria-hidden="true" className="absolute inset-x-0 z-10 border-t-[1.5px] border-dashed border-fg-strong/50" style={{ bottom: px(avgConceded) }} />
                      <span className="absolute left-0 z-10 text-[11px] text-fg-muted bg-surface px-1" style={{ bottom: px(avgConceded) + 3 }}>ממוצע <span className="tabular-nums">{avgConceded.toFixed(2)}</span></span>
                    </>
                  )}
                  {chartGames.map((e, k) => {
                    const v = chartVals[k]
                    const win = e.mine > e.theirs
                    const isBest = best != null && v === best
                    return (
                      <div key={e.stat.id} className="flex-1 h-full flex flex-col items-center justify-end gap-1.5"
                        aria-label={`${ddmm(e.game.game_date)} מול ${e.opp?.name || ''}: ${v} ${isGK ? 'ספיגות' : 'שערים'}`}>
                        <span className={`fl-num text-[16px] ${v ? 'text-fg-strong' : 'text-fg-muted'}`}>{v}</span>
                        <span className="w-full max-w-[30px] rounded-t-lg rounded-b-sm"
                          style={{ height: Math.max(4, px(v)), background: win ? tint : '#9CA3AF', boxShadow: isBest ? '0 0 0 2px rgb(var(--fl-accent))' : undefined }} />
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-1.5 mt-2">
                  {chartGames.map(e => (
                    <div key={e.stat.id} className="flex-1 flex flex-col items-center gap-1">
                      <TeamLogo team={e.opp} px={22} disc={false} />
                      <span className="text-[10px] text-fg-muted tabular-nums" dir="ltr">{ddmm(e.game.game_date)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-3 text-[12px] text-fg-muted">
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: tint }} />ניצחון</span>
                  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[#9CA3AF]" />הפסד / תיקו</span>
                  {best != null && <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] ring-2 ring-fl-accent" style={{ background: tint }} />הטוב ביותר</span>}
                </div>
                {form.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-[12px] text-fg-muted">{form.length} משחקים אחרונים</span>
                    {form.map((r, k) => <FLTResultSquare key={k} mine={r === 'win' ? 1 : 0} theirs={r === 'loss' ? 1 : 0} />)}
                  </div>
                )}
              </section>
            )}

            {/* Achievements & season honors */}
            {hasAchievements && (
              <section aria-label="הישגים ותארים">
                <h2 className="px-1.5 pb-2.5 text-[20px] font-extrabold text-fg-strong">הישגים ותארים</h2>
                <div className="flex flex-col gap-1.5">
                  {honors.map((h, k) => (
                    <div key={h.key} className="flex items-center gap-3 min-h-[64px] px-3.5 rounded-2xl bg-surface" style={k === 0 ? rowWash(tint, 0.12, 55) : undefined}>
                      <span className="size-10 rounded-xl bg-[#11161D] inline-flex items-center justify-center"><h.icon className="w-6 h-6" /></span>
                      <span className="text-[15px] font-bold text-fg-strong">{h.label}</span>
                    </div>
                  ))}
                  {milestoneGames.map((m, k) => (
                    <Link key={m.id} to={entityPath('games', m.game)} className="flex items-center gap-3 min-h-[64px] px-3.5 rounded-2xl bg-surface hover:brightness-[.98] dark:hover:brightness-110 transition"
                      style={honors.length === 0 && k === 0 ? rowWash(tint, 0.12, 55) : undefined}>
                      <span className="size-10 shrink-0 rounded-xl bg-surface-sunken inline-flex items-center justify-center">{m.kind === 'big_game' ? <Flame className="w-6 h-6" /> : <HatTrick className="w-6 h-6" />}</span>
                      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-[15px] font-bold text-fg-strong">{milestoneTitle(m)}</span>
                        <span className="text-[12px] text-fg-muted truncate">{m.goals} שערים מול {m.opp?.name || '—'} · <bdi dir="ltr">{format(ilDate(m.game.game_date), "d.M.yy")}</bdi></span>
                      </span>
                      <FLScore home={m.game.home_score} away={m.game.away_score} size={18} className="text-fg-strong shrink-0" />
                    </Link>
                  ))}
                  {isGK && cleanSheets > 0 && (
                    <div className="flex items-center gap-3 min-h-[64px] px-3.5 rounded-2xl bg-surface">
                      <span className="size-10 shrink-0 rounded-xl bg-surface-sunken inline-flex items-center justify-center"><Goalkeeper className="w-6 h-6" /></span>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[15px] font-bold text-fg-strong">{cleanSheets === 1 ? 'שער נקי' : `${cleanSheets} שערים נקיים`}</span>
                        <span className="text-[12px] text-fg-muted">משחקים בלי ספיגה</span>
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}
            <PastSeasons playerId={player.id} />
          </div>

          <div className="space-y-4 min-w-0">
            {media && media.length > 0 && (
              <TeamMedia items={media} team={team || { id: player.team_id, name: "" }} teamsMap={teamsMap} title={fullName} />
            )}

            {/* Where this player was @-tagged (player_mentions RPC). Hidden when empty. */}
            {tagged.length > 0 && (
              <section aria-label="תויג/ה ב…" className="rounded-card bg-surface overflow-hidden">
                <h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-[17px] font-extrabold text-fg-strong">
                  <AtSign className="w-5 h-5" /> תויג/ה ב…
                </h2>
                <ul className="divide-y divide-line">
                  {tagged.map(t => (
                    <li key={t.id}>
                      <Link to={t.href} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-sunken transition-colors">
                        {t.author_avatar
                          ? <img src={sizedImage(t.author_avatar, 32)} alt="" className="size-8 rounded-full object-cover shrink-0" />
                          : <span className="size-8 rounded-full bg-fg-strong text-surface flex items-center justify-center text-sm font-bold shrink-0">{t.author_name.charAt(0)}</span>}
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] text-fg-muted">
                            <span className="font-semibold text-fg-strong">{t.author_name}</span>
                            {t.kind === 'comment' ? ' · בתגובה' : ' · בפוסט'}
                            {t.created_at && <> · <bdi dir="ltr">{format(new Date(t.created_at), "d.M.yyyy")}</bdi></>}
                          </p>
                          <p className="text-[14px] text-fg-strong line-clamp-2 break-words">{t.preview}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Per-game log */}
            <section aria-label="יומן משחקים" className="rounded-card bg-surface overflow-hidden">
              <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-[17px] font-extrabold text-fg-strong">יומן משחקים</h2>
                {gameLog.length > 0 && <span className="text-[12px] text-fg-muted"><span className="tabular-nums">{filteredLog.length}</span> מתוך <span className="tabular-nums">{gameLog.length}</span></span>}
              </div>
              {comps.length > 2 && (
                <div className="px-3 pb-2">
                  <FLTPills label="סינון משחקים" value={logFilter} onChange={setLogFilter} items={comps.map(c => ({ value: c.id, label: c.label }))} />
                </div>
              )}
              <div className="px-3 pb-3 space-y-1.5">
                {filteredLog.length === 0 && <p className="text-center text-fg-muted py-8 text-sm">אין משחקים מתועדים</p>}
                {filteredLog.map(({ stat, game }) => {
                  const isHome = game.home_team_id === player.team_id
                  const opp = teamsMap[isHome ? game.away_team_id : game.home_team_id]
                  const myScore = isHome ? game.home_score : game.away_score
                  const oppScore = isHome ? game.away_score : game.home_score
                  return (
                    <Link key={stat.id} to={entityPath('games', game)} className="flex items-center gap-2.5 min-h-[56px] px-2.5 rounded-xl bg-surface-page/60 hover:bg-surface-sunken transition-colors">
                      {myScore != null && <FLTResultSquare mine={myScore} theirs={oppScore} />}
                      <TeamLogo team={opp} px={30} disc={false} />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[14px] font-semibold text-fg-strong">{opp?.name || '—'}</span>
                        <span className="block text-[12px] text-fg-muted">
                          {format(ilDate(game.game_date), "EEEE · d.M.yyyy", { locale: he })} · {isHome ? 'בית' : 'חוץ'}
                          {game.game_type === FRIENDLY_GAME_TYPE && <> · ידידותי (לא נספר)</>}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {stat.goals > 0 && <span className="inline-flex items-center gap-0.5 text-[13px] font-bold text-fg-strong"><Ball className="w-5 h-5 -my-1" /><span className="fl-num">{stat.goals}</span></span>}
                        {stat.blue_cards > 0 && <span className="inline-flex items-center gap-0.5 text-[13px] font-bold text-fg-strong"><BlueCard className="w-5 h-5 -my-1" />{stat.blue_cards}</span>}
                        {stat.red_cards > 0 && <span className="inline-flex items-center gap-0.5 text-[13px] font-bold text-fg-strong"><RedCard className="w-5 h-5 -my-1" />{stat.red_cards}</span>}
                        {isGK && stat.clean_sheet && <Goalkeeper className="w-5 h-5" title="שער נקי" />}
                        {game.home_score != null && <FLScore home={game.home_score} away={game.away_score} size={16} className="text-fg-strong" />}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
