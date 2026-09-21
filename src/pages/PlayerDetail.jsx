import { useState, useEffect } from "react"
import { useParams, Link } from "react-router-dom"
import { getPlayers, getTeams, getGames, getGameStats, getLeagueSetting, getPlayerRoleBadges } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { AGE_LABEL, DEFAULT_AGE, ageOf } from "@/lib/ageGroups"
import { countsForStats, FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { useAuth } from "@/lib/AuthContext"
import { useSeasonMode } from "@/App"
import { getClaimContext, createClaim, cancelClaim } from "@/lib/claims"
import { ArrowRight, Shirt, Shield, Calendar, RefreshCw, UserPlus, Check, Clock, Award, Trophy, Flame } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import TeamLogo from "@/components/TeamLogo"
import PlayerAvatar from "@/components/PlayerAvatar"
import TeamMembershipCard from "@/components/TeamMembershipCard"
import { RoleBadge, deriveRoleItems } from "@/components/RoleBadges"
import { BRAND_ORANGE } from '@/lib/brand'
import { useSeo } from '@/lib/seo'
import { useSlugId, entityPath } from '@/lib/slugs'
import FollowButton from "@/components/FollowButton"
import { PlayerDetailSkeleton } from "@/components/skeletons/PageSkeletons"

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

  // Load claim state for this player once it (and the auth user) are known.
  useEffect(() => {
    let alive = true
    setClaimCtx(null); setClaimErr(null)
    if (!player) return
    getClaimContext(player.id).then(c => alive && setClaimCtx(c)).catch(() => alive && setClaimCtx(null))
    return () => { alive = false }
  }, [player?.id, user])

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
  const isTopScorer = !!topScorer && topScorer.id === player.id
  const isChampion = seasonMode === 'final_four' && !!championId && championId === player.team_id

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
    catch (e) { setClaimErr(e.message === 'not-authenticated' ? 'יש להתחבר תחילה' : 'שגיאה בשליחת הבקשה') }
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
  const pendingElsewhere = claimCtx?.pendingClaim && claimCtx.pendingClaim.player_id !== player.id
  const takenByOther = claimCtx && claimCtx.playerOwnerId && claimCtx.playerOwnerId !== claimCtx.userId
  const linkedElsewhere = claimCtx && claimCtx.profile?.player_id && claimCtx.profile.player_id !== player.id
  const canClaim = claimCtx && !owned && !takenByOther && !pendingHere && !pendingElsewhere && !linkedElsewhere

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <Link to="/players" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> חזרה לשחקנים
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <PlayerAvatar player={player} team={team} size={20} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="page-title truncate">{player.first_name} {player.last_name}</h1>
              {/* P5 — follow this player (feed ranking); the bell is a separate opt-in */}
              <FollowButton targetType="player" targetId={player.id} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
              {myTeams.length ? myTeams.map(({ team: tm, age }) => (
                <Link key={tm.id} to={entityPath('teams', tm)} className="flex items-center gap-2 group w-fit">
                  <TeamLogo team={tm} size={6} />
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400 group-hover:text-brand transition-colors">{tm.name}</span>
                  {age !== DEFAULT_AGE && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{AGE_LABEL[age]}</span>
                  )}
                </Link>
              )) : (
                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">—</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <span className={`stat-pill ${isGK ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                <Shield className="w-3.5 h-3.5" /> {positionLabel}
              </span>
              {player.age != null && (
                <span className="stat-pill bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">גיל {player.age}</span>
              )}
              {player.jersey_number != null && (
                <span className="stat-pill bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  <Shirt className="w-3.5 h-3.5" /> {player.jersey_number}
                </span>
              )}
              {player.is_core && <span className="stat-pill bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light">ליבה</span>}
              {player.is_referee && <span className="stat-pill bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">שופט</span>}
              {accountBadges && deriveRoleItems({
                isAdmin: accountBadges.isAdmin,
                roles: accountBadges.roles,
                teamsMap: Object.fromEntries(teams.map(t => [t.id, t])),
              })
                // The referee flag above already covers judge — don't double it.
                .filter(it => !(it.role === "judge" && player.is_referee))
                .map(it => <RoleBadge key={it.role} role={it.role} team={it.team} />)}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Claim-your-player */}
      {!authLoading && (owned || pendingHere || takenByOther || pendingElsewhere || linkedElsewhere || canClaim || !user) && (
        <div className="card p-3.5 flex items-center justify-between gap-3">
          {owned ? (
            <span className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4" /> זה הפרופיל שלך
            </span>
          ) : pendingHere ? (
            <>
              <span className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                <Clock className="w-4 h-4" /> בקשת הבעלות נשלחה — ממתינה לאישור מנהל
              </span>
              <button onClick={handleCancelClaim} disabled={claimBusy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shrink-0">
                ביטול
              </button>
            </>
          ) : takenByOther ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">פרופיל זה כבר משויך לחשבון קיים</span>
          ) : pendingElsewhere ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">כבר הגשת בקשת בעלות על שחקן אחר</span>
          ) : linkedElsewhere ? (
            <span className="text-sm text-slate-500 dark:text-slate-400">החשבון שלך כבר משויך לשחקן אחר</span>
          ) : !user ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">שיחקת בליגה? דרוש/י בעלות על הפרופיל</span>
              <button onClick={openAuth}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors shrink-0">
                <UserPlus className="w-3.5 h-3.5" /> התחברות
              </button>
            </>
          ) : ( /* canClaim */
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">זה אתה?</span>
              <button onClick={handleClaim} disabled={claimBusy}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50 shrink-0">
                <UserPlus className="w-3.5 h-3.5" /> {claimBusy ? 'שולח...' : 'בקש בעלות על הפרופיל'}
              </button>
            </>
          )}
        </div>
      )}
      {claimErr && <p className="text-xs text-red-500 -mt-3">{claimErr}</p>}

      {owned && (
        <div className="card p-4">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">הקבוצה שלי</h3>
          <TeamMembershipCard player={player} onChange={() => getPlayers().then(ps => setPlayer(ps.find(p => p.id === id) || null)).catch(() => {})} />
        </div>
      )}

      {/* Season totals */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 uppercase tracking-wide">סיכום עונה</h2>
        <div className={`grid gap-2.5 ${tiles.length === 5 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {tiles.map(({ val, label, color }) => (
            <div key={label} className="card p-4 text-center">
              <p className={`text-2xl font-extrabold ${color}`}>{val}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        {form.length > 0 && (
          <div className="flex items-center gap-2.5 mt-3">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{form.length} משחקים אחרונים</span>
            <div className="flex gap-1">
              {form.map((r, i) => (
                <span key={i} title={r === 'win' ? 'ניצחון' : r === 'loss' ? 'הפסד' : 'תיקו'}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white ${r === 'win' ? 'bg-emerald-500' : r === 'loss' ? 'bg-red-500' : 'bg-slate-400 dark:bg-slate-600'}`}>
                  {r === 'win' ? 'נ' : r === 'loss' ? 'ה' : 'ת'}
                </span>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Achievements & season honors */}
      {hasAchievements && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card p-5 space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide">
            <Award className="w-4 h-4 text-brand" /> הישגים ותארים
          </h2>

          {/* Titles + summary counts */}
          <div className="flex flex-wrap gap-2">
            {honors.map(h => (
              <span key={h.key} className={`stat-pill font-bold ${h.cls}`}>
                <h.icon className="w-3.5 h-3.5" /> {h.label}
              </span>
            ))}
            {bigGames > 0 && <span className="stat-pill bg-brand/10 text-brand-strong dark:bg-brand/20 dark:text-brand-light">🔥 {bigGames} משחקי ענק</span>}
            {hatTricks > 0 && <span className="stat-pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">🎩 {hatTricks} שלושערים</span>}
            {isGK && cleanSheets > 0 && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">🧤 {cleanSheets} שערים נקיים</span>}
          </div>

          {/* Individual milestone games */}
          {milestoneGames.length > 0 && (
            <div className="space-y-2">
              {milestoneGames.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base leading-none shrink-0">{m.kind === 'big_game' ? '🔥' : '🎩'}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {m.kind === 'big_game' ? 'משחק ענק' : 'שלושער'} · {m.goals} שערים
                      </p>
                      <Link to={m.opp ? entityPath('teams', m.opp) : '#'} className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-brand transition-colors">
                        מול {m.opp?.name || '—'} · {format(new Date(m.game.game_date), "d/M/yyyy")}
                      </Link>
                    </div>
                  </div>
                  {/* dir=ltr keeps the standalone score stable (see rtl-score gotcha) */}
                  <span dir="ltr" className="text-sm font-bold px-2 py-1 rounded-md tabular-nums bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                    {m.game.away_score}:{m.game.home_score}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Per-game log */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
            <Calendar className="w-4 h-4 text-brand" /> יומן משחקים
          </h2>
          <div className="flex items-center gap-3">
            {comps.length > 2 && (
              <div className="flex gap-1">
                {comps.map(c => (
                  <button key={c.id} onClick={() => setLogFilter(c.id)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${logFilter === c.id ? 'bg-slate-900 dark:bg-brand text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {gameLog.length > 0 && <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{filteredLog.length} מתוך {gameLog.length}</span>}
          </div>
        </div>
        <div className="p-4 space-y-2">
          {filteredLog.length === 0 && (
            <p className="text-center text-slate-500 dark:text-slate-400 py-8 text-sm">אין משחקים מתועדים</p>
          )}
          {filteredLog.map(({ stat, game }) => {
            const isHome = game.home_team_id === player.team_id
            const opp = teamsMap[isHome ? game.away_team_id : game.home_team_id]
            const myScore = isHome ? game.home_score : game.away_score
            const oppScore = isHome ? game.away_score : game.home_score
            const result = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'tie'
            const resultCls =
              result === 'win' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : result === 'loss' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            return (
              <div key={stat.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                {/* Opponent + meta (right side in RTL) */}
                <Link to={opp ? entityPath('teams', opp) : '#'} className="flex items-center gap-2.5 min-w-0 group">
                  <TeamLogo team={opp} size={8} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{opp?.name || '—'}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {format(new Date(game.game_date), "d/M/yyyy")} · {isHome ? 'בית' : 'חוץ'}
                      {game.game_type === FRIENDLY_GAME_TYPE && (
                        <span className="text-violet-500 dark:text-violet-400 font-medium"> · ידידותי (לא נספר)</span>
                      )}
                    </p>
                  </div>
                </Link>
                {/* Player's per-game contribution + result score (left side in RTL) */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {stat.goals > 0 && <span className="stat-pill bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 !py-0.5 !px-1.5">⚽ {stat.goals}</span>}
                  {stat.blue_cards > 0 && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 !py-0.5 !px-1.5">🟦 {stat.blue_cards}</span>}
                  {stat.red_cards > 0 && <span className="stat-pill bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 !py-0.5 !px-1.5">🟥 {stat.red_cards}</span>}
                  {isGK && stat.clean_sheet && <span className="stat-pill bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 !py-0.5 !px-1.5">🧤</span>}
                  {/* RTL score: away_score first, home_score last so each score lands
                      beside its team (see hockey-league-rtl-score-gotcha memory). */}
                  <span className={`text-sm font-bold px-2 py-1 rounded-md tabular-nums ${resultCls}`} title={result === 'win' ? 'ניצחון' : result === 'loss' ? 'הפסד' : 'תיקו'}>
                    {game.away_score}:{game.home_score}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
