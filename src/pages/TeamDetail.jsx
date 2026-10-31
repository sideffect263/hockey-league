import { useState, useEffect } from "react"
import { Captain, Medical, EditIcon as Pencil } from "@/components/icons/BrandIcons"
import { useParams, Link } from "react-router-dom"
import { getTeams, getPlayers, getGames } from "@/lib/api"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import { useAuth } from "@/lib/AuthContext"
import { requestTeamJoin, joinErrorText } from "@/lib/teamMembership"
import { standingsComparator } from "@/lib/utils"
import { ageOf, DEFAULT_AGE, AGE_LABEL } from "@/lib/ageGroups"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import { ArrowRight, RefreshCw } from "lucide-react"
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
import { ilDate } from "@/lib/ilTime"
import { teamTint } from "@/lib/flTeam"
import { CrestDisc, TeamBlend, FLScore, LiveChip } from "@/components/fl/Floodlight"
import {
  heroPalette, heroSurfaces, FLTHero, FLTStatsRow, FLTPills, FLTTag, FLTOgTag, FLTPlayerFace,
  KeeperStickMark, isKeeper, rowWash, fmtDiff, FLTResultSquare,
} from "@/components/fl/teams/FLTeamsKit"

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
  // סקירה / סגל / משחקים / מדיה (board Team + TeamSquad). #squad etc. deep-links a tab.
  const [tab, setTab] = useState(() => ({ "#squad": "squad", "#games": "games", "#media": "media" })[typeof window !== "undefined" ? window.location.hash : ""] || "overview")
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

  const form = results.filter(g => g.game_type !== FRIENDLY_GAME_TYPE).slice(0, 5)
  const leaders = roster.filter(p => ownGoals(p) > 0).slice(0, 3)
  const mediaWall = media && media.length > 0 && <TeamMedia items={media} team={team} teamsMap={teamsMap} />
  const pal = heroPalette(team)
  const surf = heroSurfaces(pal)
  const heroTone = pal.light ? "light" : true
  const keepers = roster.filter(isKeeper)
  const field = roster.filter(p => !isKeeper(p))
  const tint = teamTint(team)
  const goalsLine = `${team.goals_for || 0}:${team.goals_against || 0}`
  const mineFirst = (g) => (g.home_team_id === id ? 'בית' : 'חוץ')
  const scoreOf = (g) => ({ mine: g.home_team_id === id ? g.home_score : g.away_score, theirs: g.home_team_id === id ? g.away_score : g.home_score })
  const ddmm = (d) => format(ilDate(d), "d.M")
  const goTab = (t) => { setTab(t); requestAnimationFrame(() => document.getElementById('team-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }

  const squadRow = (player, i, list) => {
    const me = profile?.player_id === player.id
    const loan = loanGoals[player.id]?.goals || 0
    return (
      <Link key={player.id} to={entityPath('players', player)}
        className={`grid grid-cols-[minmax(0,1fr)_52px_52px] items-center min-h-[64px] px-3.5 py-1.5 transition-colors hover:bg-surface-sunken/60 ${i < list.length - 1 ? 'border-b border-line' : ''}`}
        style={me ? { background: `${tint}1A` } : undefined}>
        <span className="flex items-center gap-3 min-w-0">
          <FLTPlayerFace player={player} team={team} size={44} ring={me ? tint : undefined} />
          <span className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-[15px] font-bold text-fg-strong">{player.first_name} {player.last_name}</span>
              {isKeeper(player) && <KeeperStickMark size={22} />}
              {team.captain_player_id === player.id && <span title="קפטן הקבוצה" aria-label="קפטן" className="shrink-0"><Captain className="w-5 h-5" /></span>}
            </span>
            <span className="flex flex-wrap items-center gap-1 min-h-[18px]">
              {me && <FLTTag className="bg-fl-accent text-[#11161D]">אני</FLTTag>}
              {player.jersey_number != null && <FLTTag style={{ background: tint, color: '#fff' }}><bdi dir="ltr">#{player.jersey_number}</bdi></FLTTag>}
              <FLTOgTag number={player.og_number} />
              {player.is_core && <FLTTag>סגל קבוע</FLTTag>}
              {player.is_referee && <FLTTag>שופט</FLTTag>}
              {loan > 0 && (
                <FLTTag title={`שערים במשחקי השאלה לקבוצות אחרות (${loanGoals[player.id].games} מש׳)`}>
                  <bdi dir="ltr">+{loan}</bdi>&nbsp;בהשאלה
                </FLTTag>
              )}
              {canEdit && (
                medicalApproved.has(player.id)
                  ? <span title="בדיקה רפואית מאושרת" aria-label="בדיקה רפואית מאושרת" className="inline-flex items-center rounded-md px-1 bg-[#1B7A2A]/15"><Medical className="w-4 h-4" /></span>
                  : <span title="אין בדיקה רפואית מאושרת" aria-label="אין בדיקה רפואית מאושרת" className="inline-flex items-center rounded-md px-1 bg-fl-accent/30"><Medical className="w-4 h-4" /></span>
              )}
            </span>
          </span>
          {canSetCaptain && (
            <button onClick={(e) => toggleCaptain(e, player.id)} disabled={captainBusy}
              title={team.captain_player_id === player.id ? "הסר קפטן" : "קבע כקפטן"}
              aria-label={team.captain_player_id === player.id ? "הסר קפטן" : "קבע כקפטן"}
              className={`ms-auto shrink-0 size-11 inline-flex items-center justify-center rounded-full transition hover:bg-surface-sunken ${team.captain_player_id === player.id ? '' : 'opacity-30 grayscale hover:opacity-100 hover:grayscale-0'}`}>
              <Captain className="w-5 h-5" />
            </button>
          )}
        </span>
        <span className={`fl-num text-center text-[20px] ${player.games_played ? 'text-fg-strong' : 'text-fg-muted/60'}`}>{player.games_played || 0}</span>
        <span className={`fl-num text-center text-[24px] ${ownGoals(player) ? 'text-fg-strong' : 'text-fg-muted/60'}`}>{ownGoals(player)}</span>
      </Link>
    )
  }

  const squadGroup = (title, list) => list.length > 0 && (
    <section aria-label={title}>
      <div className="grid grid-cols-[minmax(0,1fr)_52px_52px] items-end px-3.5 pb-2">
        <h3 className="text-[20px] font-extrabold text-fg-strong">{title} <span className="fl-num text-[16px] text-fg-muted">{list.length}</span></h3>
        <span className="text-[11px] font-semibold text-fg-muted text-center">משחקים</span>
        <span className="text-[11px] font-semibold text-fg-muted text-center">שערים</span>
      </div>
      <div className="rounded-[18px] bg-surface overflow-hidden">{list.map(squadRow)}</div>
    </section>
  )

  const nextGameCard = nextGame && (() => {
    const live = nextGame.status === 'in_progress'
    const home = teamsMap[nextGame.home_team_id], away = teamsMap[nextGame.away_team_id]
    const opp = nextGame.home_team_id === id ? away : home
    return (
      <section aria-label={live ? "משחק עכשיו" : "המשחק הבא"}>
        <h2 className="px-1.5 pb-2.5 text-[22px] font-extrabold text-fg-strong">{live ? "משחק עכשיו" : "המשחק הבא"}</h2>
        <TeamBlend as={Link} to={entityPath('games', nextGame)} home={home} away={away}
          className={`block rounded-card p-4 ${live ? 'ring-2 ring-fl-live' : ''}`}>
          {/* Home on the RIGHT, like every scoreboard. */}
          <div dir="rtl" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            {[home, null, away].map((t, k) => k === 1 ? (
              <div key="mid" className="flex flex-col items-center gap-1 text-center">
                {live ? <LiveChip /> : null}
                {live && nextGame.home_score != null
                  ? <FLScore home={nextGame.home_score} away={nextGame.away_score} size={34} />
                  : <span className="fl-num text-[34px]" dir="ltr">{format(ilDate(nextGame.game_date), "HH:mm")}</span>}
                <span className="text-[12px] opacity-85">{format(ilDate(nextGame.game_date), "EEEE d.M", { locale: he })}{nextGame.venue ? ` · ${nextGame.venue}` : ''}</span>
              </div>
            ) : (
              <div key={t?.id || k} className="flex flex-col items-center gap-1.5 min-w-0">
                <CrestDisc team={t} size={54} />
                <span className="text-[13px] font-bold text-center leading-tight line-clamp-2">{t?.name || '—'}</span>
              </div>
            ))}
          </div>
          <p className="text-center text-[12px] mt-2.5 opacity-85">
            {nextGame.home_team_id === id ? 'משחק בית' : 'משחק חוץ'}{opp ? ` · נגד ${opp.name}` : ''}
          </p>
        </TeamBlend>
      </section>
    )
  })()

  const upcomingRow = (game) => {
    const opp = teamsMap[game.home_team_id === id ? game.away_team_id : game.home_team_id]
    return (
      <Link key={game.id} to={entityPath('games', game)}
        className="grid grid-cols-[58px_30px_minmax(0,1fr)_40px_54px] items-center gap-x-2.5 min-h-[56px] px-3.5 rounded-2xl bg-surface hover:brightness-[.98] dark:hover:brightness-110 transition"
        style={rowWash(opp ? teamTint(opp) : '#5B616B', 0.15)}>
        <span className="fl-num text-[20px] text-fg-strong" dir="ltr">{ddmm(game.game_date)}</span>
        <TeamLogo team={opp} px={30} disc={false} />
        <span className="truncate text-[14px] font-semibold text-fg-strong">{opp?.name || '—'}</span>
        <span className="text-[12px] text-fg-muted text-center">{mineFirst(game)}</span>
        <span className="fl-num text-[20px] text-fg-muted text-left" dir="ltr">{format(ilDate(game.game_date), "HH:mm")}</span>
      </Link>
    )
  }

  const resultRow = (game) => {
    const opp = teamsMap[game.home_team_id === id ? game.away_team_id : game.home_team_id]
    const { mine, theirs } = scoreOf(game)
    return (
      <div key={game.id} className="flex items-center gap-3 min-h-[56px] px-3.5 rounded-2xl bg-surface">
        <FLTResultSquare mine={mine} theirs={theirs} size={24} />
        {/* TeamLink, not a bare Link: `opp` can be missing and then renders inert text. */}
        <TeamLink team={opp} className="flex items-center gap-2.5 min-w-0 flex-1">
          <TeamLogo team={opp} px={30} disc={false} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-fg-strong">{opp?.name || '—'}</span>
            <span className="block text-[12px] text-fg-muted">
              <bdi dir="ltr">{format(ilDate(game.game_date), "d.M.yyyy")}</bdi> · {mineFirst(game)}
              {game.game_type === FRIENDLY_GAME_TYPE && <> · ידידותי</>}
            </span>
          </span>
        </TeamLink>
        <Link to={entityPath('games', game)} aria-label="לעמוד המשחק" className="shrink-0 min-h-[44px] inline-flex items-center px-1">
          <FLScore home={game.home_score} away={game.away_score} size={20} className="text-fg-strong" />
        </Link>
      </div>
    )
  }

  const scorersBlock = leaders.length > 0 && (
    <section aria-label="הכובשים שלנו">
      <h2 className="px-1.5 pb-2.5 text-[22px] font-extrabold text-fg-strong">הכובשים שלנו</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {leaders.map(p => (
          <Link key={p.id} to={entityPath('players', p)} className="rounded-[18px] bg-surface p-3.5 flex flex-col gap-2.5 hover:brightness-[.98] dark:hover:brightness-110 transition">
            <span className="flex items-center justify-between gap-2">
              <FLTPlayerFace player={p} team={team} size={48} />
              <span className="flex items-baseline gap-1"><span className="fl-num text-[40px] text-fg-strong">{ownGoals(p)}</span><span className="text-[12px] text-fg-muted">שערים</span></span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold text-fg-strong">{p.first_name} {p.last_name}</span>
              <span className="block text-[12px] text-fg-muted">{p.games_played || 0} משחקים{p.og_number ? ` · OG #${p.og_number}` : ''}{p.jersey_number != null ? ` · #${p.jersey_number}` : ''}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )

  const rosterPreview = (
    <section aria-label="הסגל">
      <div className="flex items-baseline justify-between px-1.5 pb-2">
        <h2 className="text-[22px] font-extrabold text-fg-strong">הסגל <span className="fl-num text-[18px] text-fg-muted">{roster.length}</span></h2>
        <button onClick={() => goTab('squad')} className="min-h-[44px] px-1 text-[13px] font-semibold text-fg-strong underline-offset-2 hover:underline">לכל הסגל</button>
      </div>
      {roster.length === 0
        ? <p className="rounded-[18px] bg-surface text-center text-fg-muted py-8 text-sm">אין שחקנים</p>
        : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {roster.slice(0, 8).map(p => (
              <Link key={p.id} to={entityPath('players', p)} className="rounded-2xl bg-surface px-1 py-2.5 flex flex-col items-center gap-1.5 text-center hover:brightness-[.98] dark:hover:brightness-110 transition">
                <FLTPlayerFace player={p} team={team} size={54} />
                <span className="text-[12px] font-bold leading-tight text-fg-strong line-clamp-2">{p.first_name} {p.last_name}</span>
                <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                  {isKeeper(p) ? <><KeeperStickMark size={16} /> שוער</> : team.captain_player_id === p.id ? 'קפטן' : p.jersey_number != null ? <bdi dir="ltr">#{p.jersey_number}</bdi> : 'שחקן'}
                </span>
              </Link>
            ))}
          </div>
        )}
    </section>
  )

  const gamesLists = (all) => (
    <>
      {laterGames.length > 0 && (
        <section aria-label="משחקים הבאים" className="space-y-1.5">
          <h2 className="px-1.5 pb-1 text-[20px] font-extrabold text-fg-strong">משחקים הבאים</h2>
          {(all || allUpcoming ? laterGames : laterGames.slice(0, SHOW_GAMES)).map(upcomingRow)}
          {!all && !allUpcoming && laterGames.length > SHOW_GAMES && (
            <button onClick={() => setAllUpcoming(true)} className="w-full min-h-[44px] text-[13px] font-bold text-fg-strong hover:underline">כל {laterGames.length} המשחקים</button>
          )}
        </section>
      )}
      <section aria-label="תוצאות אחרונות" className="space-y-1.5">
        <h2 className="px-1.5 pb-1 text-[20px] font-extrabold text-fg-strong">תוצאות אחרונות</h2>
        {results.length === 0 && <p className="rounded-2xl bg-surface text-center text-fg-muted py-8 text-sm">אין תוצאות</p>}
        {(all || allResults ? results : results.slice(0, SHOW_GAMES)).map(resultRow)}
        {!all && !allResults && results.length > SHOW_GAMES && (
          <button onClick={() => setAllResults(true)} className="w-full min-h-[44px] text-[13px] font-bold text-fg-strong hover:underline">כל {results.length} התוצאות</button>
        )}
      </section>
    </>
  )

  return (
    <div className="pb-8">
      {/* Hero — the crest WITHOUT its disc on the team's own colours. A light team
          (קריית מוצקין) keeps its white → grey with dark ink. */}
      <FLTHero palette={pal} className="sm:mx-6 lg:mx-auto lg:max-w-5xl sm:mt-4 px-4 pt-4 pb-5 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <Link to="/teams" aria-label="חזרה לקבוצות" className="size-11 rounded-full inline-flex items-center justify-center" style={{ background: surf.chip, color: pal.ink }}>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </Link>
          {(onThisTeam || canEdit) && (
            <span className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: surf.chip }}>
              {onThisTeam ? 'הקבוצה שלך' : 'את/ה מאמן/ת'}
            </span>
          )}
          {canEdit ? (
            <button onClick={() => setEditing(true)} aria-label="עריכת הקבוצה"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 rounded-full text-[13px] font-bold" style={{ background: surf.chip, color: pal.ink }}>
              <Pencil className="w-4 h-4" /> עריכה
            </button>
          ) : <span className="size-11" aria-hidden="true" />}
        </div>

        <div className="flex flex-col items-center gap-2 mt-3 text-center">
          <CrestDisc team={team} size={150} disc={false} shadow className="max-[379px]:!size-[120px]" />
          <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-[1.05]">{team.name}</h1>
          <p className="text-[13px]" style={{ color: surf.sub }}>
            {[team.city, team.founded_year ? `נוסדה ${team.founded_year}` : null].filter(Boolean).join(' · ')}
            {!isSeniorTeam && <> · {AGE_LABEL[ageOf(team)]}</>}
          </p>
        </div>

        {/* Stat box */}
        <div className="mt-5 rounded-[20px] p-4 flex flex-col gap-3.5 max-w-xl mx-auto" style={{ background: surf.panel, border: `1px solid ${surf.panelBorder}` }}>
          <div className="flex items-center gap-3.5">
            <div className="size-[76px] shrink-0 rounded-[18px] flex flex-col items-center justify-center gap-0.5"
              style={{ background: pal.light ? '#11161D' : 'rgb(var(--fl-accent))', color: pal.light ? '#FFFFFF' : '#11161D' }}>
              {isSeniorTeam
                ? <><span className="fl-num text-[40px] leading-none">{rank}</span><span className="text-[11px] font-bold">בטבלה</span></>
                : <span className="text-[13px] font-extrabold text-center px-1">{AGE_LABEL[ageOf(team)]}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <FLTStatsRow palette={pal} items={[
                { value: team.points || 0, label: 'נקודות' },
                { value: goalsLine, label: 'שערים' },
                { value: fmtDiff(gd), label: 'הפרש' },
              ]} />
            </div>
          </div>
          <div className="h-px" style={{ background: surf.rule }} />
          <div className="flex items-center gap-2 overflow-x-auto nav-scroll">
            <span className="text-[12px] w-11 shrink-0" style={{ color: surf.sub }}>כושר</span>
            {form.length === 0 && <span className="text-[12px]" style={{ color: surf.sub }}>עוד אין תוצאות</span>}
            {form.map(g => {
              const { mine, theirs } = scoreOf(g)
              const o = mine > theirs ? 'ניצחון' : mine < theirs ? 'הפסד' : 'תיקו'
              return (
                <Link key={g.id} to={entityPath('games', g)} aria-label={`${o}: ${teamsMap[g.home_team_id]?.name} ${g.home_score}, ${teamsMap[g.away_team_id]?.name} ${g.away_score}`}
                  className="shrink-0 inline-flex items-center gap-1.5 h-[34px] ps-1.5 pe-2 rounded-[10px]" style={{ background: surf.soft }}>
                  <FLTResultSquare mine={mine} theirs={theirs} />
                  {/* home crest + score on the RIGHT */}
                  <span dir="rtl" className="inline-flex items-center gap-1 fl-num text-[15px]">
                    <TeamLogo team={teamsMap[g.home_team_id]} px={22} />
                    <span>{g.home_score}</span><span className="opacity-55">:</span><span>{g.away_score}</span>
                    <TeamLogo team={teamsMap[g.away_team_id]} px={22} />
                  </span>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          <FollowButton targetType="team" targetId={team.id} onDark={heroTone} />
          <ShareFollowButton targetType="team" name={team.name} onDark={heroTone} />
          {!canEdit && isLinkedPlayer && <TeamCoachRequest teamId={team.id} tone={pal.light ? "light" : "dark"} />}
        </div>
      </FLTHero>

      <div className="px-3 sm:px-6 lg:px-8 max-w-5xl mx-auto">
        <div className="mt-4"><FollowInvite targetType="team" targetId={team.id} name={team.name} /></div>

        <div id="team-tabs" className="pt-4 pb-1 scroll-mt-20">
          <FLTPills label="עמוד הקבוצה" value={tab} onChange={setTab} items={[
            { value: 'overview', label: 'סקירה' },
            { value: 'squad', label: 'סגל', count: roster.length },
            { value: 'games', label: 'משחקים' },
            { value: 'media', label: 'מדיה' },
          ]} />
        </div>

        {tab === 'overview' && (
          <div className="mt-3 grid gap-6 lg:grid-cols-2 lg:items-start">
            <div className="space-y-6 min-w-0">
              {nextGameCard}
              {laterGames.length > 0 && (
                <div className="space-y-1.5 -mt-4">{laterGames.slice(0, 2).map(upcomingRow)}</div>
              )}
              {scorersBlock}
              {(canEdit || isLeagueManager) && <TeamFanStats teamId={team.id} />}
            </div>
            <div className="space-y-6 min-w-0">
              {rosterPreview}
              {mediaWall}
              {media && media.length === 0 && <TeamMediaEmpty team={team} nextGame={nextGame} teamsMap={teamsMap} />}
              <PastSeasons teamId={team.id} />
            </div>
          </div>
        )}

        {tab === 'squad' && (
          <div className="mt-3 space-y-5 max-w-3xl">
            {isLinkedPlayer && !onThisTeam && (
              <div className="flex items-center justify-between gap-3 rounded-[18px] bg-surface px-3.5 py-2.5">
                <span className="text-[13px] text-fg-muted">משחק/ת בקבוצה?</span>
                {joinState === 'sent'
                  ? <span className="text-[13px] font-bold text-fg-strong">הבקשה נשלחה ✓</span>
                  : joinState === 'pending'
                    ? <span className="text-[13px] font-bold text-fg-strong">בקשה ממתינה</span>
                    : <div className="flex flex-col items-end gap-1">
                        <button onClick={doJoin} disabled={joinState === 'sending'} className="btn-primary min-h-[44px] px-4 text-[13px] disabled:opacity-50">
                          {joinState === 'sending' ? 'שולח…' : 'בקש להצטרף'}
                        </button>
                        {joinError && <span className="text-[12px] font-semibold text-fl-red max-w-[220px] text-left">{joinError}</span>}
                      </div>}
              </div>
            )}
            {roster.length === 0 && <p className="rounded-[18px] bg-surface text-center text-fg-muted py-8 text-sm">אין שחקנים</p>}
            {squadGroup('שוערים', keepers)}
            {squadGroup('שחקני שדה', field)}

            {/* A submitted player card, before it becomes a real player. RLS returns these
                only to the team's coach, the submitter, an admin or an LM. Not a Link. */}
            {submissions.length > 0 && (
              <section aria-label="כרטיסים ממתינים" className="rounded-[18px] bg-surface overflow-hidden">
                {submissions.map(s => {
                  const rejected = s.status === "rejected"
                  return (
                    <div key={s.id} className="flex items-center justify-between min-h-[52px] px-3.5 border-b border-line last:border-0">
                      <span className="flex items-center gap-2 min-w-0 text-fg-muted text-[14px]">
                        <span className="truncate">{s.first_name} {s.last_name}</span>
                        {s.jersey_number != null && <span className="text-[12px] tabular-nums">#{s.jersey_number}</span>}
                      </span>
                      <span title={rejected && s.decision_note ? s.decision_note : undefined}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 ${rejected ? "bg-fl-red text-white" : "bg-fl-accent text-[#11161D]"}`}>
                        {rejected ? "נדחה" : "ממתין לאישור"}
                      </span>
                    </div>
                  )
                })}
              </section>
            )}
          </div>
        )}

        {tab === 'games' && (
          <div className="mt-3 grid gap-6 lg:grid-cols-2 lg:items-start">
            {nextGameCard && <div className="lg:col-span-2 max-w-xl">{nextGameCard}</div>}
            {gamesLists(true)}
          </div>
        )}

        {tab === 'media' && (
          <div className="mt-3 space-y-4">
            {mediaWall}
            {media && media.length === 0 && <TeamMediaEmpty team={team} nextGame={nextGame} teamsMap={teamsMap} />}
            {media == null && <p className="text-center text-fg-muted py-8 text-sm">טוען…</p>}
          </div>
        )}
      </div>

      {editing && <TeamEditModal team={team} onClose={() => setEditing(false)} onSaved={loadData} />}
    </div>
  )
}
