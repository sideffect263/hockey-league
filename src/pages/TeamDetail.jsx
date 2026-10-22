import { useState, useEffect } from "react"
import { Ball } from '../components/icons/HockeyIcons'
import { useParams, Link } from "react-router-dom"
import { getTeams, getPlayers, getGames } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { useAuth } from "@/lib/AuthContext"
import { requestTeamJoin, joinErrorText } from "@/lib/teamMembership"
import { standingsComparator } from "@/lib/utils"
import { ageOf, DEFAULT_AGE, AGE_LABEL } from "@/lib/ageGroups"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { ArrowRight, Users, Calendar, Clock, RefreshCw, Pencil, HeartPulse, Crown, ChevronDown, Radio, Star } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { he } from "date-fns/locale"
import TeamLogo from "@/components/TeamLogo"
import PastSeasons from "@/components/PastSeasons"
import TeamEditModal from "@/components/TeamEditModal"
import TeamCoachRequest from "@/components/TeamCoachRequest"
import { useSeo } from "@/lib/seo"
import { useSlugId, entityPath } from "@/lib/slugs"
import { TeamLink } from "@/components/EntityLinks"
import { getApprovedMedicalPlayerIds } from "@/lib/medical"
import { getTeamSubmissions } from "@/lib/playerSubmissions"
import { setTeamCaptain } from "@/lib/gameFormData"
import { getPlayerLoanGoals } from "@/lib/loans"
import FollowButton from "@/components/FollowButton"
import TeamFanStats from "@/components/TeamFanStats"
import { ShareFollowButton, FollowInvite } from "@/components/ShareFollow"
import { TeamDetailSkeleton } from "@/components/skeletons/PageSkeletons"
import TeamMedia, { TeamMediaEmpty } from "@/components/TeamMedia"
import { getTeamMedia } from "@/lib/teamMedia"
import { sizedImage } from "@/lib/imageSize"
import { ilDate } from "@/lib/ilTime"

// Header gradient from the team's own colours. Its text and buttons are white, so
// every stop is darkened until white reads on it (WCAG luminance cap), whatever a
// coach picks — #ffffff turns charcoal, #15f919 a deep green. A grey/white primary
// hands the lead to a saturated secondary (white + orange → orange).
const hex2rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "")
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const saturation = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0 }
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// Darken by `k`, then keep darkening until luminance ≤ max (0.06 ≈ 10:1 against white).
function deepen(rgb, k, max = 0.06) {
  let c = rgb.map(v => v * (1 - k))
  while (luminance(c) > max) c = c.map(v => v * 0.9)
  return `rgb(${c.map(Math.round).join(",")})`
}
function heroBackground(team) {
  let p = hex2rgb(team.primary_color), s = hex2rgb(team.secondary_color)
  if (p && s && saturation(p) < 0.15 && saturation(s) >= 0.15) [p, s] = [s, p]
  if (!p) return "linear-gradient(135deg, #1E2A78 0%, #141b4d 55%, #0b1024 100%)"
  return `linear-gradient(135deg, ${deepen(p, 0.3)} 0%, ${deepen(p, 0.6)} 55%, ${deepen(s || p, 0.6, 0.05)} 100%)`
}
const SHOW_GAMES = 3

export default function TeamDetail() {
  const { id: routeKey } = useParams()
  const { id, notFound: unknownRoute } = useSlugId('teams', routeKey)
  const { profile, isAdmin, isLeagueManager, coachTeamIds } = useAuth()
  const [captainBusy, setCaptainBusy] = useState(false)
  const [joinState, setJoinState] = useState(null)
  const [joinError, setJoinError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [games, setGames] = useState([])
  const [playerTeams, setPlayerTeams] = useState([])
  const [medicalApproved, setMedicalApproved] = useState(new Set())
  const [submissions, setSubmissions] = useState([])
  // Goals each player scored on loan for another team — shown apart from his goals here.
  const [loanGoals, setLoanGoals] = useState({})
  useEffect(() => {
    let alive = true
    if (players.length) getPlayerLoanGoals(players.map(p => p.id)).then(m => { if (alive) setLoanGoals(m) })
    return () => { alive = false }
  }, [players])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // null = still loading, so the "no videos yet" card never flashes before the wall.
  const [media, setMedia] = useState(null)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [allUpcoming, setAllUpcoming] = useState(false)
  const [allResults, setAllResults] = useState(false)
  useEffect(() => {
    let alive = true
    setMedia(null)
    if (!id || !games.length) return
    const mine = games.filter(g => g.home_team_id === id || g.away_team_id === id)
    getTeamMedia(id, mine).then(m => { if (alive) setMedia(m) }).catch(e => { console.error(e); if (alive) setMedia([]) })
    return () => { alive = false }
  }, [id, games])

  const teamName = teams.find(t => t.id === id)?.name
  useSeo({
    title: teamName || 'קבוצה',
    description: teamName ? `סגל, תוצאות וסטטיסטיקות של ${teamName} בליגת הוקי הגלגיליות הישראלית` : undefined,
    path: entityPath('teams', teams.find(t => t.id === id)) || `/teams/${routeKey}`,
  })

  // Roles resolve asynchronously in AuthContext, usually *after* the first paint. Without
  // them in the deps a coach landing directly on their own team page loads before
  // coachTeamIds fills in, and the medical indicators silently never appear.
  useEffect(() => {
    // `id` is null only while a Hebrew slug is being resolved into the row's
    // UUID; `unknownRoute` means that resolution came back empty.
    if (id) loadData()
    else if (unknownRoute) { setError('הקבוצה לא נמצאה'); setLoading(false) }
  }, [id, unknownRoute, isAdmin, coachTeamIds.join(',')])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const [t, p, g, pt, subs] = await Promise.all([getTeams(), getPlayers(), getGames(), getPlayerTeams().catch(() => []), getTeamSubmissions(id)])
      if (!t.find(tm => tm.id === id)) { setError("הקבוצה לא נמצאה"); return }
      setTeams(t); setPlayers(p); setGames(g); setPlayerTeams(pt); setSubmissions(subs)
      // Medical status is private — only fetch (and later render) it for this team's
      // coach or an admin; RLS returns nothing for anyone else regardless.
      if (isAdmin || coachTeamIds.includes(id)) {
        const { byTeam } = buildMemberMaps(pt, p)
        const rosterIds = p.filter(pl => byTeam.get(id)?.has(pl.id)).map(pl => pl.id)
        setMedicalApproved(await getApprovedMedicalPlayerIds(rosterIds))
      }
    } catch (err) { console.error(err); setError("שגיאה בטעינת הנתונים") }
    finally { setLoading(false) }
  }

  const doJoin = async () => {
    setJoinState('sending')
    try { await requestTeamJoin(id); setJoinState('sent') }
    // Show WHY it was refused. "already in age group" is the common one now that a
    // player may hold only one team per age group — a generic failure would read as a bug.
    catch (e) {
      if (e?.message === 'join-already-pending') setJoinState('pending')
      else { setJoinError(joinErrorText(e)); setJoinState('error') }
    }
  }

  if (loading) return <TeamDetailSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <div className="flex gap-2">
            <button onClick={loadData} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
            </button>
            <Link to="/teams" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors">
              <ArrowRight className="w-3.5 h-3.5" /> חזרה לקבוצות
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const team = teams.find(t => t.id === id)
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const canEdit = !!team && (isAdmin || coachTeamIds.includes(team.id))
  // Season captain: the coach, an LM or an admin names one; each game can override it.
  const canSetCaptain = canEdit || isLeagueManager
  const toggleCaptain = async (e, playerId) => {
    e.preventDefault(); e.stopPropagation()
    if (captainBusy) return
    const next = team.captain_player_id === playerId ? null : playerId
    setCaptainBusy(true)
    try {
      await setTeamCaptain(team.id, next)
      setTeams(ts => ts.map(t => (t.id === team.id ? { ...t, captain_player_id: next } : t)))
    } catch (err) { console.error(err) }
    finally { setCaptainBusy(false) }
  }
  // League rank is senior only; a youth-tournament team isn't in the league
  // table, so it shows its age-group badge instead of a bogus rank.
  const isSeniorTeam = ageOf(team) === DEFAULT_AGE
  const rank = isSeniorTeam
    ? [...teams].filter(t => ageOf(t) === DEFAULT_AGE).sort(standingsComparator).findIndex(t => t.id === id) + 1
    : null
  const { byTeam: membersByTeam } = buildMemberMaps(playerTeams, players)
  // players.goals is his whole season, loan games included. On HIS team's page the goals
  // number is what he scored for this team; loan goals get their own chip.
  const ownGoals = (p) => Math.max(0, (p.goals || 0) - (loanGoals[p.id]?.goals || 0))
  const roster = players.filter(p => membersByTeam.get(id)?.has(p.id)).sort((a, b) => ownGoals(b) - ownGoals(a))
  const isLinkedPlayer = !!profile?.player_id
  const onThisTeam = isLinkedPlayer && roster.some(p => p.id === profile.player_id)
  const gd = (team.goals_for || 0) - (team.goals_against || 0)

  const results = games
    .filter(g => g.status === 'completed' && (g.home_team_id === id || g.away_team_id === id) && g.home_score != null)
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))

  const upcoming = games
    .filter(g => ['scheduled', 'in_progress', 'waiting_result'].includes(g.status) && (g.home_team_id === id || g.away_team_id === id))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
  // The first upcoming game gets its own card up top; the list below starts after it.
  const nextGame = upcoming[0] || null
  const laterGames = upcoming.slice(1)
  const outcome = (g) => {
    const mine = g.home_team_id === id ? g.home_score : g.away_score
    const theirs = g.home_team_id === id ? g.away_score : g.home_score
    return mine > theirs ? 'w' : mine < theirs ? 'l' : 't'
  }
  const form = results.filter(g => g.game_type !== FRIENDLY_GAME_TYPE).slice(0, 5)
  const leaders = roster.filter(p => ownGoals(p) > 0).slice(0, 3)
  const showRoster = rosterOpen || canEdit
  const mediaWall = media && media.length > 0 && <TeamMedia items={media} team={team} teamsMap={teamsMap} />

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <Link to="/teams" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
        <ArrowRight className="w-4 h-4" /> חזרה לקבוצות
      </Link>

      <FollowInvite targetType="team" targetId={team.id} name={team.name} />

      {/* Header — the transparent crest on the team's own colours */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl p-5 sm:p-6 text-white shadow-lg" style={{ background: heroBackground(team) }}>
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_10%,rgba(255,255,255,0.10),transparent_60%)]" />
        <div className="relative flex items-center gap-4">
          {team.logo_url
            ? <img src={sizedImage(team.logo_url, 96, 'contain')} alt={team.name} className="w-20 h-20 sm:w-24 sm:h-24 object-contain shrink-0 drop-shadow-[0_6px_14px_rgba(0,0,0,0.35)]" />
            : <TeamLogo team={team} size={14} />}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black leading-tight truncate">{team.name}</h1>
            <p className="text-sm text-white/80 mt-0.5">{team.city}{team.founded_year ? ` · נוסדה ${team.founded_year}` : ''}</p>
            <div className="mt-2.5 flex items-center gap-1.5 flex-wrap text-xs font-bold">
              {isSeniorTeam
                ? <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20">מקום {rank} בטבלה</span>
                : <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20">{AGE_LABEL[ageOf(team)]}</span>}
              <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20">{team.points || 0} נק׳</span>
              <span className="px-2.5 py-1 rounded-full bg-white/15 border border-white/20 tabular-nums">{team.wins || 0}נ · {team.ties || 0}ת · {team.losses || 0}ה</span>
            </div>
          </div>
          {canEdit ? (
            <button onClick={() => setEditing(true)}
              className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs font-semibold transition-colors shrink-0">
              <Pencil className="w-3.5 h-3.5" /> עריכה
            </button>
          ) : null}
        </div>
        <div className="relative mt-4 flex items-center gap-2 flex-wrap">
          <FollowButton targetType="team" targetId={team.id} size="sm" onDark />
          <ShareFollowButton targetType="team" name={team.name} onDark />
          {!canEdit && isLinkedPlayer && <TeamCoachRequest teamId={team.id} />}
        </div>
      </motion.div>

      {/* Next game — turns into a live strip while it's on */}
      {nextGame && (() => {
        const isHome = nextGame.home_team_id === id
        const opp = teamsMap[isHome ? nextGame.away_team_id : nextGame.home_team_id]
        const live = nextGame.status === 'in_progress'
        const home = teamsMap[nextGame.home_team_id], away = teamsMap[nextGame.away_team_id]
        return (
          <Link to={entityPath('games', nextGame)}
            className={`card block p-4 transition-colors ${live ? 'ring-2 ring-rose-500/70 hover:bg-rose-50/40 dark:hover:bg-rose-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                {live ? <><Radio className="w-4 h-4 text-rose-500" /> משחק עכשיו</> : <><Calendar className="w-4 h-4 text-brand" /> המשחק הבא</>}
              </h2>
              {live
                ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-600 text-white animate-pulse">LIVE</span>
                : <span className="text-xs text-slate-500 dark:text-slate-400">{format(ilDate(nextGame.game_date), "EEEE d/M", { locale: he })}</span>}
            </div>
            {/* RTL: home on the right, away on the left — same as every scoreboard here. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
              {[home, null, away].map((t, k) => k === 1 ? (
                <div key="mid" className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
                  <span dir="ltr" className="block text-lg font-extrabold text-slate-900 dark:text-white tabular-nums">
                    {live && nextGame.home_score != null ? `${nextGame.away_score}:${nextGame.home_score}` : format(ilDate(nextGame.game_date), "HH:mm")}
                  </span>
                  {isHome ? 'בית' : 'חוץ'}{nextGame.venue ? ` · ${nextGame.venue}` : ''}
                </div>
              ) : (
                <div key={t?.id || k} className="flex flex-col items-center gap-1.5 min-w-0">
                  <TeamLogo team={t} size={12} />
                  <span className={`text-xs font-bold truncate max-w-full ${t?.id === id ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t?.name || '—'}</span>
                </div>
              ))}
            </div>
            {!live && opp && <span className="sr-only">מול {opp.name}</span>}
          </Link>
        )
      })()}

      {/* Media leads when there is any; otherwise the team at a glance comes first */}
      {mediaWall}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white"><Star className="w-4 h-4 text-brand" /> במבט מהיר</h2>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            [isSeniorTeam ? rank : '—', 'מקום'],
            [`${team.goals_for || 0}–${team.goals_against || 0}`, 'שערים'],
            [team.points || 0, 'נקודות'],
          ].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 py-2.5 text-center">
              <p dir="ltr" className="text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">{v}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{l}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="me-1">כושר:</span>
          {/* newest on the right (RTL reading order) */}
          {Array.from({ length: 5 }, (_, k) => form[k]).map((g, k) => {
            const o = g && outcome(g)
            return (
              <span key={k} title={g ? `${o === 'w' ? 'ניצחון' : o === 'l' ? 'הפסד' : 'תיקו'} · ${format(ilDate(g.game_date), "d/M")}` : undefined}
                className={`w-6 h-6 rounded-md grid place-items-center text-[11px] font-extrabold ${
                  o === 'w' ? 'bg-emerald-500 text-white' : o === 'l' ? 'bg-red-500 text-white' : o === 't' ? 'bg-slate-400 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                {o === 'w' ? 'נ' : o === 'l' ? 'ה' : o === 't' ? 'ת' : '–'}
              </span>
            )
          })}
        </div>
        {leaders.length > 0 && (
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700/60">
            {leaders.map(p => (
              <Link key={p.id} to={entityPath('players', p)} className="flex items-center gap-3 py-2 group">
                <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-extrabold bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light tabular-nums">{p.jersey_number ?? '–'}</span>
                <span className="flex-1 font-semibold text-sm text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{p.first_name} {p.last_name}</span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-white tabular-nums">{ownGoals(p)} <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">שערים</span></span>
              </Link>
            ))}
          </div>
        )}
      </motion.div>

      {/* Fans over time — coaches, league managers and admins only */}
      {(canEdit || isLeagueManager) && <TeamFanStats teamId={team.id} />}

      {media && media.length === 0 && <TeamMediaEmpty team={team} nextGame={nextGame} teamsMap={teamsMap} />}

      {/* Roster */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card overflow-hidden">
        <div className={`px-5 py-4 flex items-center justify-between gap-3 ${showRoster ? 'border-b border-slate-100 dark:border-slate-700' : ''}`}>
          <button onClick={() => setRosterOpen(o => !o)} disabled={canEdit} aria-expanded={showRoster}
            className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white disabled:cursor-default">
            <Users className="w-4 h-4 text-brand" /> סגל
            {!canEdit && <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showRoster ? 'rotate-180' : ''}`} />}
          </button>
          <div className="flex items-center gap-3 shrink-0">
            {isLinkedPlayer && !onThisTeam && (
              joinState === 'sent'
                ? <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">הבקשה נשלחה ✓</span>
                : joinState === 'pending'
                  ? <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">בקשה ממתינה</span>
                  : <div className="flex flex-col items-end gap-1">
                      <button onClick={doJoin} disabled={joinState === 'sending'}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
                        {joinState === 'sending' ? 'שולח…' : 'בקש להצטרף'}
                      </button>
                      {joinError && <span className="text-[10px] text-red-600 dark:text-red-400 max-w-[200px] text-left">{joinError}</span>}
                    </div>
            )}
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{roster.length} שחקנים</span>
          </div>
        </div>
        {showRoster && <div className="p-3 sm:p-4 space-y-1">
          {roster.length === 0 && <p className="text-center text-slate-500 dark:text-slate-400 py-8 text-sm">אין שחקנים</p>}
          {roster.map(player => (
            <Link key={player.id} to={entityPath('players', player)}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-sm">
              <div className="flex items-center gap-2 min-w-0">
                {player.is_core && <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0" />}
                <span className="font-medium text-slate-900 dark:text-white truncate">{player.first_name} {player.last_name}</span>
                {player.jersey_number != null && <span className="text-[10px] text-slate-400 font-mono shrink-0">#{player.jersey_number}</span>}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${player.position === 'Goalkeeper' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                  {player.position === 'Goalkeeper' ? 'GK' : 'FP'}
                </span>
                {player.is_referee && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">REF</span>}
                {team.captain_player_id === player.id && (
                  <span title="קפטן הקבוצה" className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Crown className="w-3 h-3" />C</span>
                )}
                {canEdit && (
                  medicalApproved.has(player.id)
                    ? <span title="בדיקה רפואית מאושרת" className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"><HeartPulse className="w-3 h-3" /></span>
                    : <span title="אין בדיקה רפואית מאושרת" className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"><HeartPulse className="w-3 h-3" /></span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs shrink-0">
                {canSetCaptain && (
                  <button onClick={(e) => toggleCaptain(e, player.id)} disabled={captainBusy}
                    title={team.captain_player_id === player.id ? "הסר קפטן" : "קבע כקפטן"}
                    aria-label={team.captain_player_id === player.id ? "הסר קפטן" : "קבע כקפטן"}
                    className={`p-1 rounded-md transition-colors ${team.captain_player_id === player.id ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600 hover:text-amber-500'}`}>
                    <Crown className="w-3.5 h-3.5" />
                  </button>
                )}
                {ownGoals(player) > 0 && <span dir="ltr" className="inline-flex items-center gap-0.5 font-bold text-emerald-600 dark:text-emerald-400"><span>{ownGoals(player)}</span><Ball className="w-3.5 h-3.5" /></span>}
                {(loanGoals[player.id]?.goals || 0) > 0 && (
                  <span title={`שערים במשחקי השאלה לקבוצות אחרות (${loanGoals[player.id].games} מש׳)`}
                    className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    <span dir="ltr">+{loanGoals[player.id].goals}</span> בהשאלה
                  </span>
                )}
                <span className="text-slate-400">{player.games_played || 0} מש׳</span>
              </div>
            </Link>
          ))}

          {/* Row 29 — a submitted player card, before it becomes a real player.
              RLS returns these only to the team's coach, the submitter, an admin or a
              league manager, so an unapproved card never shows on the public page.
              Not a Link: there is no player page to go to yet. */}
          {submissions.map(s => {
            const rejected = s.status === "rejected"
            return (
              <div key={s.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg text-sm opacity-75">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-500 dark:text-slate-400 truncate">
                    {s.first_name} {s.last_name}
                  </span>
                  {s.jersey_number != null && (
                    <span className="text-[11px] text-slate-400 tabular-nums">#{s.jersey_number}</span>
                  )}
                </div>
                <span
                  title={rejected && s.decision_note ? s.decision_note : undefined}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                    rejected
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  }`}>
                  {rejected ? "נדחה" : "ממתין לאישור"}
                </span>
              </div>
            )
          })}
        </div>}
      </motion.div>

      {/* Upcoming games */}
      {laterGames.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }} className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
              <Calendar className="w-4 h-4 text-brand" /> משחקים הבאים
            </h2>
          </div>
          <div className="p-4 space-y-2">
            {(allUpcoming ? laterGames : laterGames.slice(0, SHOW_GAMES)).map(game => {
              const isHome = game.home_team_id === id
              const opp = teamsMap[isHome ? game.away_team_id : game.home_team_id]
              return (
                <Link key={game.id} to={entityPath('games', game)}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <TeamLogo team={opp} size={8} />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{opp?.name || '—'}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {format(ilDate(game.game_date), "d/M/yyyy")} · {isHome ? 'בית' : 'חוץ'}{game.venue ? ` · ${game.venue}` : ''}
                      </p>
                    </div>
                  </div>
                  <span dir="ltr" className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md bg-brand/10 text-brand dark:bg-brand/20 dark:text-brand-light shrink-0 tabular-nums">
                    <Clock className="w-3 h-3" /> {format(ilDate(game.game_date), "HH:mm")}
                  </span>
                </Link>
              )
            })}
            {!allUpcoming && laterGames.length > SHOW_GAMES && (
              <button onClick={() => setAllUpcoming(true)} className="w-full pt-1 text-xs font-bold text-brand dark:text-brand-light hover:underline">כל {laterGames.length} המשחקים</button>
            )}
          </div>
        </motion.div>
      )}

      {/* Recent results */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
            <Calendar className="w-4 h-4 text-brand" /> תוצאות אחרונות
          </h2>
        </div>
        <div className="p-4 space-y-2">
          {results.length === 0 && <p className="text-center text-slate-500 dark:text-slate-400 py-8 text-sm">אין תוצאות</p>}
          {(allResults ? results : results.slice(0, SHOW_GAMES)).map(game => {
            const isHome = game.home_team_id === id
            const opp = teamsMap[isHome ? game.away_team_id : game.home_team_id]
            const myScore = isHome ? game.home_score : game.away_score
            const oppScore = isHome ? game.away_score : game.home_score
            const result = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'tie'
            const resultCls =
              result === 'win' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : result === 'loss' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            return (
              <div key={game.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                {/* TeamLink, not a bare Link: `opp` can be missing (a game whose
                    opponent row didn't load) and this then renders inert text
                    instead of a link to nowhere. */}
                <TeamLink team={opp} className="flex items-center gap-2.5 min-w-0 group">
                  <TeamLogo team={opp} size={8} />
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{opp?.name || '—'}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {format(ilDate(game.game_date), "d/M/yyyy")} · {isHome ? 'בית' : 'חוץ'}
                      {game.game_type === FRIENDLY_GAME_TYPE && (
                        <span className="text-violet-500 dark:text-violet-400 font-medium"> · ידידותי</span>
                      )}
                    </p>
                  </div>
                </TeamLink>
                {/* RTL score: away_score first, home_score last so each score lands
                    beside its team (see hockey-league-rtl-score-gotcha memory). */}
                <span className={`text-sm font-bold px-2 py-1 rounded-md tabular-nums shrink-0 ${resultCls}`} title={result === 'win' ? 'ניצחון' : result === 'loss' ? 'הפסד' : 'תיקו'}>
                  {game.away_score}:{game.home_score}
                </span>
              </div>
            )
          })}
          {!allResults && results.length > SHOW_GAMES && (
            <button onClick={() => setAllResults(true)} className="w-full pt-1 text-xs font-bold text-brand dark:text-brand-light hover:underline">כל {results.length} התוצאות</button>
          )}
        </div>
      </motion.div>

      {team && <PastSeasons teamId={team.id} />}

      {editing && <TeamEditModal team={team} onClose={() => setEditing(false)} onSaved={loadData} />}
    </div>
  )
}
