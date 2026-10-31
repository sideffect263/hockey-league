import { useState, useEffect, useCallback } from "react"
import { GoalIcon as Ball, BlueCard, RedCard, Calendar, CalendarClock, Flame, MatchFallback as Swords, Referee, MonitorPlay, CalendarCheck, Squad, PersonClaim, TrendUp as TrendingUp, GameForm as ClipboardCheck } from "@/components/icons/BrandIcons"
import { useParams, Link, useLocation } from "react-router-dom"
import { getGameStatsByGameId, getTeams, getPlayers, getReferees, getGames, getGameAnySeason, getArchivedGames } from "@/lib/api"
import { getLiveGame, subscribeLiveGame } from "@/lib/live"
import { useAuth } from "@/lib/AuthContext"
import { ArrowRight, ArrowLeft, RefreshCw, LogIn } from "lucide-react"
import GameVideo from "@/components/GameVideo"
import GamePosts from "@/components/games/GamePosts"
import GameAvailability from "@/components/GameAvailability"
import LoanInvite from "@/components/LoanInvite"
import GameSquads from "@/components/GameSquads"
import GameBroadcast from "@/components/GameBroadcast"
import { PlayerLink } from "@/components/EntityLinks"
import { CrestDisc, TeamLink } from "@/components/fl/Floodlight"
import { useSeo } from "@/lib/seo"
import { useSlugId, entityPath } from "@/lib/slugs"
import { FRIENDLY_GAME_TYPE } from "@/lib/leagueStats"
import GameChangeRequestModal from "@/components/GameChangeRequestModal"
import GameChangeOpponentCard from "@/components/GameChangeOpponentCard"
import OfficialSelfSubmit from "@/components/OfficialSelfSubmit"
import { getGameOfficialsPublic } from "@/lib/officials"
import GameFormExport from "@/components/GameFormExport"
import GameFormCard from "@/components/games/GameFormCard"
import GameMvp from "@/components/GameMvp"
import GameMarketCard from "@/components/games/GameMarketCard"
import GameFans from "@/components/games/GameFans"
import { usePinSeason } from "@/components/SeasonPicker"
import GameStory from "@/components/games/GameStory"
import GameMediaUpload from "@/components/games/GameMediaUpload"
import { MATCH_STATS_GAMES } from "@/lib/matchStats"
import { getMyGameChangeRequest, cancelGameChangeRequest } from "@/lib/gameRequests"
import { canEnterResults, isAwaitingResult } from "@/lib/gameFormResult"
import { getGameReportRow } from "@/lib/gameFormData"
import { getVenues } from "@/lib/venues"
import { headToHead, formBefore, gameSummary } from "@/lib/pageSummary"
import { resultText, SHARE_ORIGIN } from "@/lib/shareLinks"
import GameHero from "@/components/fl/games/GameHero"
import GameLiveBand, { GameTimeline } from "@/components/fl/games/GameLiveBand"
import { FLSection, GameQuickActions, BroadcastNote, PostponedCards, KioskAndNotes, GoalsList } from "@/components/fl/games/GamePieces"
import { GameDetailSkeletonFL } from "@/components/fl/games/GamesSkeletons"
import { getGameHeroPhoto } from "@/components/fl/games/gameCover"
import { useIsDesktop } from "@/components/fl/games/useIsDesktop"
import {
  STAGE, resolveStage, isPlayedStage, isLiveStage, chipText, roundsOf, dayAndDate, timeOf, shortDate, buildTimeline,
} from "@/components/fl/games/flGamesKit"

const resultLabel = (r) => (r === 'win' ? 'ניצחון' : r === 'loss' ? 'הפסד' : 'תיקו')
const formTone = (r) => (r === 'win' ? 'bg-emerald-600 text-white' : r === 'loss' ? 'bg-fl-red text-white' : 'bg-fg-muted text-surface')

// One player's line in a box score.
function StatPills({ stat }) {
  return (
    <span className="flex gap-1.5 shrink-0 items-center">
      {stat.goals > 0 && <span className="inline-flex items-center gap-0.5 fl-num text-[15px] text-fg-strong" aria-label={`${stat.goals} שערים`}><Ball className="w-5 h-5" /><span dir="ltr">{stat.goals}</span></span>}
      {stat.blue_cards > 0 && <span className="inline-flex items-center gap-0.5 fl-num text-[15px] text-fl-blue" aria-label={`${stat.blue_cards} כחולים`}><BlueCard className="w-5 h-5" /><span dir="ltr">{stat.blue_cards}</span></span>}
      {stat.red_cards > 0 && <span className="inline-flex items-center gap-0.5 fl-num text-[15px] text-fl-red" aria-label={`${stat.red_cards} אדומים`}><RedCard className="w-5 h-5" /><span dir="ltr">{stat.red_cards}</span></span>}
    </span>
  )
}

const toolBtn = "inline-flex items-center gap-1.5 min-h-11 text-[13px] font-bold px-3.5 rounded-control transition-colors"

export default function GameDetail() {
  const { id: routeKey } = useParams()
  const { id, notFound: unknownRoute } = useSlugId('games', routeKey)
  const { user, isAdmin, isDeveloper, isJudgeRole, isLeagueManager, profile, coachTeamIds, openAuth } = useAuth()
  const { hash } = useLocation()
  const isDesktop = useIsDesktop()
  const [game, setGame] = useState(null)
  const [stats, setStats] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [referees, setReferees] = useState([])
  const [games, setGames] = useState([])
  const [live, setLive] = useState(null)
  const [venues, setVenues] = useState([])
  const [report, setReport] = useState(null)       // game_reports row → the goals' minutes
  const [heroPhoto, setHeroPhoto] = useState(null)
  const [now, setNow] = useState(() => new Date())
  // An old-season game wears that season's palette + badge, like its /archive page.
  const pastSeason = usePinSeason(game?.season_id)
  const [officials, setOfficials] = useState([])   // confirmed judge(s) + medic (game_officials)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [myRequest, setMyRequest] = useState(null)   // this coach's latest change request for the game
  const [showChangeModal, setShowChangeModal] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [shared, setShared] = useState(false)

  // Computed before the early returns so the hooks below (useSeo) always run.
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const playersMap = Object.fromEntries(players.map(p => [p.id, p]))
  const home = game ? teamsMap[game.home_team_id] : null
  const away = game ? teamsMap[game.away_team_id] : null

  useSeo({
    title: home && away ? `${home.name} נגד ${away.name}` : 'משחק',
    description: home && away
      ? `תוצאה, הרכבים וסטטיסטיקות מהמשחק בין ${home.name} ל${away.name} בליגת הוקי הגלגיליות הישראלית`
      : undefined,
    path: entityPath('games', game) || `/games/${routeKey}`,
  })

  useEffect(() => {
    // `id` is null only while a Hebrew slug is being resolved into the row's
    // UUID; `unknownRoute` means that resolution came back empty.
    if (id) loadData()
    else if (unknownRoute) { setError('notfound'); setLoading(false) } // sentinel, see the error branch below
  }, [id, unknownRoute])

  // The stage follows the clock (game day → kick-off) without a reload.
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(iv)
  }, [])

  // The live row: realtime for any game that is not over (the judge can start the board
  // a little early); a DELETE (finished / abandoned) delivers null.
  const gameDone = game?.status === 'completed'
  useEffect(() => {
    if (!id || !game || gameDone) return
    return subscribeLiveGame(id, (row) => setLive(row))
  }, [id, !!game, gameDone])

  // Venue (pin + address for ניווט), the board's archived play-by-play, the hero photo.
  useEffect(() => {
    if (!id) return
    let alive = true
    getVenues().then(v => alive && setVenues(v)).catch(() => {})
    getGameReportRow(id).then(r => alive && setReport(r)).catch(() => {})
    getGameHeroPhoto(id).then(u => alive && setHeroPhoto(u)).catch(() => {})
    return () => { alive = false }
  }, [id])

  // A coach of either team may have an outstanding change request for this game.
  // Refetch when the game or the viewer's coach scope resolves (auth loads async).
  const refreshMyRequest = () => getMyGameChangeRequest(id).then(setMyRequest).catch(() => {})
  useEffect(() => {
    const coachOfThis = game && (coachTeamIds || []).some(tid => tid === game.home_team_id || tid === game.away_team_id)
    if (coachOfThis) refreshMyRequest()
    else setMyRequest(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, (coachTeamIds || []).join(',')])

  // Officials come from game_officials (public names via game_officials_public). A failed
  // read leaves the list empty and the referee_id fallback below still shows the judge.
  useEffect(() => {
    if (!id) return
    getGameOfficialsPublic(id).then(setOfficials).catch(() => {})
  }, [id])
  const judges = officials.filter(o => o.role === 'judge')
  const medics = officials.filter(o => o.role === 'medic')

  const cancelMyRequest = async () => {
    if (!myRequest) return
    setCancelling(true)
    try { await cancelGameChangeRequest(myRequest.id); await refreshMyRequest() }
    catch (e) { alert(e.message || 'שגיאה בביטול הבקשה') }
    finally { setCancelling(false) }
  }

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      // A game from an archived season is hidden from the table reads by RLS; that one
      // game + its box score come from game_any_season instead (stats: null = live season).
      const [cur, s, t, p, r, allGames, lg] = await Promise.all([
        getGameAnySeason(id), getGameStatsByGameId(id), getTeams(), getPlayers(), getReferees(), getGames(), getLiveGame(id),
      ])
      if (!cur) { setError('notfound'); return }
      // An archived game's form + head-to-head come from ITS season — getGames() only
      // sees the live one, which left both sections empty on every 2025-26 game.
      const seasonGames = cur.stats ? await getArchivedGames(cur.game.season_id).catch(() => allGames) : allGames
      setGame(cur.game); setStats(cur.stats ?? s ?? []); setTeams(t); setPlayers(p); setReferees(r); setGames(seasonGames); setLive(lg)
    } catch (err) {
      console.error(err)
      setError(err?.code === 'PGRST116' ? 'notfound' : 'error')
    } finally { setLoading(false) }
  }

  const share = useCallback(async () => {
    if (!game) return
    const url = `${SHARE_ORIGIN}${entityPath('games', game)}`
    const done = game.status === 'completed' && game.home_score != null
    const text = done ? resultText(home?.name, game.home_score, game.away_score, away?.name)
      : `${home?.name || 'בית'} נגד ${away?.name || 'חוץ'} · ${dayAndDate(game.game_date)} ${timeOf(game.game_date)}`
    try {
      if (navigator.share) { await navigator.share({ title: text, text, url }); return }
    } catch (e) { if (e?.name === 'AbortError') return }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); setShared(true); setTimeout(() => setShared(false), 2000) }
    catch { window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener,noreferrer') }
  }, [game, home, away])

  if (loading) return <GameDetailSkeletonFL />

  if (error || !game) {
    const notFound = error === 'notfound' || !game
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="fl-card p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <Calendar className="w-12 h-12" />
          <h2 className="text-lg font-extrabold text-fg-strong">{notFound ? 'המשחק לא נמצא' : 'שגיאה בטעינת המשחק'}</h2>
          <p className="text-sm text-fg-muted">{notFound ? 'ייתכן שהמשחק הוסר או שהקישור שגוי' : 'משהו השתבש, נסו שוב'}</p>
          <div className="flex gap-2 mt-1">
            {!notFound && (
              <button onClick={loadData} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /> נסה שוב</button>
            )}
            <Link to="/games" className="btn btn-primary"><ArrowRight className="w-4 h-4" /> חזרה למשחקים</Link>
          </div>
        </div>
      </div>
    )
  }

  // ---- Derived match state ----
  // Score is only "real" once a game is completed (the whole app gates it on that).
  const done = game.status === 'completed'
  const stage = resolveStage(game, live, now)
  const liveStage = isLiveStage(stage)
  const played = done && game.home_score != null && game.away_score != null
  const scores = played ? [game.home_score, game.away_score]
    : (stage === STAGE.justEnded && live && live.home_score != null) ? [live.home_score, live.away_score] : null
  const round = roundsOf(games)[game.id] || null
  // Officials (judge/admin) get an in-page entry to run the scoreboard + go live.
  const canOfficiate = isAdmin || isJudgeRole
  // Played without the game clock → referee / LM enters it from the handwritten form.
  const canEnterFromForm = canEnterResults({ isAdmin, isJudgeRole, isLeagueManager }) && isAwaitingResult(game) && !live

  // #3 / attendance: the viewer's linked player (if rostered in this game); which teams
  // they may see as an OFFICIAL (admin → both, coach → their own team) with full roster +
  // indicators; and (for a plain player) their own team's basic in/out list.
  const inThisGame = (tid) => tid === game.home_team_id || tid === game.away_team_id
  const myPlayer = profile?.player_id ? playersMap[profile.player_id] : null
  const myAvailPlayerId = (myPlayer && inThisGame(myPlayer.team_id)) ? myPlayer.id : null
  const officialTeamIds = isAdmin ? [game.home_team_id, game.away_team_id] : (coachTeamIds || []).filter(inThisGame)
  const playerTeamId = (myPlayer && inThisGame(myPlayer.team_id) && !officialTeamIds.includes(myPlayer.team_id)) ? myPlayer.team_id : null
  // Any signed-in viewer sees both squads' answers (status only); a coach — or an admin /
  // league manager, for either side — can also push a reminder to the silent ones.
  const nudgeTeamIds = (isAdmin || isLeagueManager) ? [game.home_team_id, game.away_team_id] : (coachTeamIds || []).filter(inThisGame)
  const showAvailability = game.status === "scheduled" && (!!user || myAvailPlayerId || officialTeamIds.length > 0 || playerTeamId)
  const isPlayoff = game.game_type === 'פלייאוף'
  const isFriendly = game.game_type === FRIENDLY_GAME_TYPE
  const typeLabel = isPlayoff ? (game.series_game ? `פלייאוף · משחק ${game.series_game}` : 'פלייאוף') : isFriendly ? game.game_type : null

  const refName = (() => {
    if (judges.length) return judges.map(j => j.name).filter(Boolean).join(', ') || null
    if (!game.referee_id) return null
    const pool = game.referee_type === 'player' ? players : referees
    const r = pool.find(x => x.id === game.referee_id)
    return r ? `${r.first_name} ${r.last_name}` : null
  })()
  const judgeNames = judges.length ? judges.map(j => j.name).filter(Boolean) : (refName ? [refName] : [])
  const venue = venues.find(v => v.name?.trim() === game.venue?.trim()) || null

  // ---- Box score / stat derivations ----
  // A loaned player's line carries the side he played for (played_for_team_id).
  const sideOf = (s) => s.played_for_team_id || playersMap[s.player_id]?.team_id
  const loanFrom = (s) => (s.played_for_team_id && playersMap[s.player_id]?.team_id !== s.played_for_team_id)
    ? teamsMap[playersMap[s.player_id]?.team_id] : null
  const teamStats = (tid) => stats.filter(s => sideOf(s) === tid)
  const guestStats = stats.filter(s => s.is_guest_player)
  const scorers = [...stats].filter(s => (s.goals || 0) > 0).sort((a, b) => (b.goals || 0) - (a.goals || 0))
  // Own goals live on the game row, not in game_stats: render them as their own line.
  const ownGoalsFor = (tid) =>
    (tid === game.home_team_id ? game.home_own_goals
      : tid === game.away_team_id ? game.away_own_goals : 0) || 0
  const ownGoalTotal = ownGoalsFor(game.home_team_id) + ownGoalsFor(game.away_team_id)
  const ownGoalLabel = (n) => (n > 1 ? 'שערים עצמיים' : 'שער עצמי')
  const blueCards = stats.reduce((sum, s) => sum + (s.blue_cards || 0), 0)
  const redCards = stats.reduce((sum, s) => sum + (s.red_cards || 0), 0)
  const nameOfStat = (s) => {
    if (s.is_guest_player) return s.guest_player_name || 'אורח'
    const p = playersMap[s.player_id]
    return p ? `${p.first_name} ${p.last_name}` : '—'
  }

  const tiles = played ? [
    { val: game.home_score + game.away_score, label: "סה״כ שערים", color: "text-fg-strong" },
    { val: game.home_score, label: "שערי הבית", color: "text-fg-strong" },
    { val: game.away_score, label: "שערי החוץ", color: "text-fg-strong" },
    { val: blueCards, label: "כרטיסים כחולים", color: "text-fl-blue" },
    { val: redCards, label: "כרטיסים אדומים", color: "text-fl-red" },
  ] : []

  // ---- "שערים": the board's play-by-play when it adds up to the score, else the box score.
  const timeline = buildTimeline(report?.events || [], report?.period_ms || undefined)
  const tlGoals = timeline.filter(e => e.kind === 'goal')
  const tlAddsUp = tlGoals.length > 0 && scores &&
    tlGoals.filter(e => e.home).length === scores[0] && tlGoals.filter(e => !e.home).length === scores[1]
  const goalRows = !isPlayedStage(stage) ? [] : tlAddsUp
    ? tlGoals.map(e => ({ id: e.id, home: e.home, who: e.ownGoal ? 'שער עצמי' : (e.player || 'שער'), minute: e.minute, score: e.scoreAfter }))
    : [
      ...scorers.filter(s => !s.is_guest_player || s.played_for_team_id)
        .map(s => ({ id: s.id, home: sideOf(s) === game.home_team_id, who: nameOfStat(s), count: s.goals, minute: null }))
        .sort((a, b) => (a.home === b.home ? 0 : a.home ? -1 : 1)),
      ...[game.home_team_id, game.away_team_id].filter(t => ownGoalsFor(t) > 0)
        .map(t => ({ id: `og-${t}`, home: t === game.home_team_id, who: ownGoalLabel(ownGoalsFor(t)), count: ownGoalsFor(t), minute: null })),
    ]

  // ---- Head-to-head + pre-match form (competitive games only) ----
  const h2h = headToHead(games, game)
  const homeForm = formBefore(games, game, game.home_team_id)
  const awayForm = formBefore(games, game, game.away_team_id)

  // "על המשחק" — the same sentences api/seo.js gives search bots (keep them one source).
  const summary = gameSummary({
    game, home, away, h2h, seasonName: pastSeason?.name || null,
    cards: { blue: blueCards, red: redCards },
    scorers: scorers.map(s => {
      const p = playersMap[s.player_id]
      const side = sideOf(s) === game.home_team_id ? 'home' : sideOf(s) === game.away_team_id ? 'away' : null
      return { name: s.is_guest_player ? s.guest_player_name : (p ? `${p.first_name} ${p.last_name}` : null), goals: s.goals, side }
    }).filter(s => s.name && s.side),
  })

  // A coach of either team may request a reschedule while the game is still upcoming.
  const isTeamCoach = (coachTeamIds || []).some(tid => tid === game.home_team_id || tid === game.away_team_id)
  const canRequestChange = isTeamCoach && (game.status === 'scheduled' || game.status === 'postponed')
  const gcOpen = ['pending', 'pending_opponent', 'pending_manager'].includes(myRequest?.status)

  // ================= sections (each null when it has nothing to show) =================
  const S = {}

  S.season = pastSeason && (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-4 py-3 border border-line">
      <p className="text-sm font-semibold text-fg-strong">משחק מעונת <bdi dir="ltr">{pastSeason.name}</bdi> — עונה שהסתיימה</p>
      <Link to={`/archive/${encodeURIComponent(pastSeason.slug || pastSeason.id)}`} className="text-[13px] font-bold text-fg-strong underline underline-offset-4">לעמוד העונה ←</Link>
    </div>
  )

  // Officials' tools for this game (judge board, control room, result from form, form export).
  S.tools = (
    <>
      {canOfficiate && !done && (
        <Link to={`/judge/${id}`} className={`${toolBtn} bg-brand text-brand-fg hover:bg-brand-hover`}><Referee className="w-5 h-5" /> לוח שיפוט</Link>
      )}
      {isAdmin && !done && (
        <Link to={`/games/${id}/control`} className={`${toolBtn} border border-line bg-surface text-fg-strong hover:bg-surface-sunken`}><MonitorPlay className="w-5 h-5" /> חדר שידור</Link>
      )}
      {canEnterFromForm && (
        <Link to={`/games/${id}/result`} className={`${toolBtn} border border-line bg-surface text-fg-strong hover:bg-surface-sunken`}><ClipboardCheck className="w-5 h-5" /> הזנת תוצאה מטופס</Link>
      )}
      <GameFormExport game={game} home={home} away={away} players={players} stats={stats} refereeName={refName} />
    </>
  )

  S.hero = !liveStage && (
    <GameHero game={game} home={home} away={away} stage={stage} round={round} scores={scores}
      chip={shared ? 'הקישור הועתק' : chipText(game, stage, { live, now, round })}
      judges={judgeNames} address={venue?.address || null} photoUrl={isPlayedStage(stage) ? heroPhoto : null}
      onShare={share} typeLabel={typeLabel} />
  )

  const canNav = !!game.venue?.trim() && (game.status === 'scheduled' || liveStage)
  S.quick = !pastSeason && (game.status === 'scheduled' || liveStage) && (
    <GameQuickActions game={game} teamsMap={teamsMap} venue={venue}
      showCalendar={game.status === 'scheduled'} showNav={canNav} />
  )

  S.liveBand = liveStage && <GameLiveBand home={home} away={away} live={live} />
  S.liveMeta = liveStage && (
    <div className="text-center -mt-1">
      <p className="text-[12.5px] text-fg-muted">
        {dayAndDate(game.game_date)} · <span dir="ltr">{timeOf(game.game_date)}</span>{game.venue ? ` · מגרש ${game.venue}` : ''}
      </p>
      {venue?.address && <p className="text-[11px] text-fg-subtle">{venue.address}</p>}
    </div>
  )
  // The timeline stays on a just-ended game until the live row goes away.
  S.timeline = live && (liveStage || stage === STAGE.justEnded) && (
    <GameTimeline events={live.state?.events || []} periodMS={live.state?.periodMS} home={home} away={away} over={!liveStage} />
  )
  S.video = <GameVideo game={game} home={home} away={away} players={players} />
  S.postponed = stage === STAGE.postponed && <PostponedCards />
  S.broadcastNote = stage === STAGE.gameDay && <BroadcastNote />
  S.goals = goalRows.length > 0 && <GoalsList rows={goalRows} home={home} away={away} />
  S.kiosk = <KioskAndNotes game={game} />

  S.medics = medics.length > 0 && (
    <p className="fl-card px-3.5 py-3 text-[13px] text-fg-strong">חובש: {medics.map(m => m.name).filter(Boolean).join(', ')}</p>
  )

  S.about = summary.length > 0 && (
    <FLSection title="על המשחק">
      <p className="text-[14px] leading-relaxed text-fg-soft">{summary.join(' ')}</p>
    </FLSection>
  )

  // סיפור המשחק — written story (published, or a draft for editors)
  S.story = done && <GameStory gameId={game.id} home={home} away={away} />
  // raw footage from coaches / officials / editors → the timeline pipeline
  S.mediaUpload = (done || game.status === 'in_progress') && <GameMediaUpload gameId={game.id} />

  // COACH: request a reschedule (date/venue) → manager approves
  S.changeRequest = canRequestChange && (
    <div className="fl-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[15px] font-extrabold text-fg-strong flex items-center gap-2">
          <CalendarClock className="w-5 h-5" /> שינוי מועד או מגרש
        </p>
        {gcOpen ? (
          <p className="text-[13px] text-amber-700 dark:text-amber-400 mt-1">
            בקשתך {myRequest.status === 'pending_opponent' ? 'ממתינה לאישור המאמן היריב' : 'ממתינה לאישור מנהל הליגה'}
            {myRequest.proposed_venue && <> · {myRequest.proposed_venue}</>}
          </p>
        ) : myRequest?.status === 'rejected' ? (
          <p className="text-[13px] text-fl-red mt-1">
            בקשתך האחרונה נדחתה{myRequest.decision_note ? ` — ${myRequest.decision_note}` : ''}. ניתן לשלוח בקשה חדשה.
          </p>
        ) : myRequest?.status === 'approved' ? (
          <p className="text-[13px] text-emerald-700 dark:text-emerald-400 mt-1">בקשתך האחרונה אושרה — המשחק עודכן.</p>
        ) : (
          <p className="text-[13px] text-fg-muted mt-1">הבקשה תישלח למנהל הליגה לאישור</p>
        )}
      </div>
      <div className="shrink-0">
        {gcOpen ? (
          <button onClick={cancelMyRequest} disabled={cancelling} className="btn btn-secondary">
            {cancelling ? 'מבטל…' : 'ביטול הבקשה'}
          </button>
        ) : (
          <button onClick={() => setShowChangeModal(true)} className="btn btn-primary">
            <CalendarClock className="w-5 h-5" /> בקשת שינוי
          </button>
        )}
      </div>
    </div>
  )

  // MATCH SHEET: captains + digital signatures of the טופס שיפוט
  S.formCard = <GameFormCard game={game} home={home} away={away} players={players} stats={stats} />
  // OPPONENT COACH: respond to a reschedule request
  S.opponent = <GameChangeOpponentCard game={game} coachTeamIds={coachTeamIds} onResponded={refreshMyRequest} />
  // FANS: each side's fans + "אני בא/ה לצפות"
  S.fans = <GameFans game={game} home={home} away={away} />
  // OFFICIAL SELF-SUBMIT (judge/medic apply for an upcoming game)
  S.selfSubmit = <OfficialSelfSubmit game={game} />

  // MATCH CENTRE: stats from the video — preview, devs + admins only for now
  S.matchCentre = (isAdmin || isDeveloper) && MATCH_STATS_GAMES.has(game.id) && (
    <Link to={`${entityPath('games', game)}/stats`} className="fl-card p-4 flex items-center gap-3 hover:bg-surface-sunken transition-colors">
      <span className="size-11 rounded-control bg-surface-sunken flex items-center justify-center shrink-0"><TrendingUp className="w-6 h-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold text-[15px] text-fg-strong">מרכז המשחק · סטטיסטיקות מהווידאו</span>
        <span className="block text-[12.5px] text-fg-muted">אחזקה, בעיטות, מסירות, מפת חום ושחקנים — חושב אוטומטית מהצילום (תצוגה מקדימה)</span>
      </span>
      <ArrowLeft className="w-4 h-4 text-fg-muted shrink-0" />
    </Link>
  )

  // HIGHLIGHTS & POSTS attached to this game — hidden when none
  S.posts = <GamePosts game={game} teamsMap={teamsMap} playersMap={playersMap} />
  // LOAN INVITE — a coach of another team asked this player for this game
  S.loan = game.status === "scheduled" && profile?.player_id && <LoanInvite gameId={game.id} />

  // AVAILABILITY. #availability is the target of shared sign-up links (/games/next, the
  // coach's copied link): it must exist for every viewer, so a guest arriving from WhatsApp
  // lands on a way in rather than on nothing.
  S.availability = showAvailability ? (
    <div id="availability" className="scroll-mt-20">
      <GameAvailability game={game} myPlayerId={myAvailPlayerId} officialTeamIds={officialTeamIds} playerTeamId={playerTeamId} publicView={!!user} nudgeTeamIds={nudgeTeamIds} teamsMap={teamsMap} playersMap={playersMap} />
    </div>
  ) : game.status === "postponed" ? (
    // Postponed: PostponedCards carries #availability and the explanation
    // (game-postpone-reconfirm.sql: a new date re-asks everyone who said מגיע).
    null
  ) : game.status === "scheduled" && (!user || hash === "#availability") ? (
    <div id="availability" className="fl-card p-4 scroll-mt-20 flex items-center gap-3 flex-wrap">
      <CalendarCheck className="w-6 h-6 shrink-0" />
      <p className="flex-1 min-w-[12rem] text-[14px] text-fg-strong">
        {!user ? "משחק בקבוצה שלך? התחברו כדי לאשר הגעה."
          : !profile?.player_id ? "כדי לאשר הגעה יש לשייך את החשבון לכרטיס השחקן שלך."
          : "אישור הגעה פתוח לשחקני שתי הקבוצות במשחק בלבד."}
      </p>
      {!user ? (
        <button onClick={openAuth} className="btn btn-primary"><LogIn className="w-4 h-4" /> התחברות</button>
      ) : !profile?.player_id && (
        <Link to="/me" className="btn btn-primary"><PersonClaim className="w-5 h-5" /> שיוך לשחקן</Link>
      )}
    </div>
  ) : null

  // LM broadcast — renders only for admin / league manager
  S.lmBroadcast = <GameBroadcast game={game} />

  S.tiles = tiles.length > 0 && (
    <FLSection title="סיכום המשחק">
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-3 gap-2">
        {tiles.map(({ val, label, color }) => (
          <div key={label} className="rounded-[14px] bg-surface-sunken py-3 px-1 text-center">
            <p className={`fl-num text-[26px] ${color}`}>{val}</p>
            <p className="text-[11px] font-medium text-fg-muted mt-1 truncate">{label}</p>
          </div>
        ))}
      </div>
    </FLSection>
  )

  // MVP — picked by an official, shown to everyone once picked.
  S.mvp = done && (
    <GameMvp game={game} stats={stats} playersMap={playersMap} teamsMap={teamsMap}
      canPick={isAdmin || isLeagueManager || isJudgeRole}
      onChanged={(pid) => setGame(g => ({ ...g, mvp_player_id: pid }))} />
  )

  // BOX SCORE — הרכבים וסטטיסטיקות (home column on the RIGHT)
  S.boxScore = done && (
    <FLSection title="הרכבים וסטטיסטיקות">
      {stats.length === 0 && ownGoalTotal === 0 ? (
        <p className="text-center text-[14px] text-fg-muted py-6">לא הוזנו סטטיסטיקות למשחק זה</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
            {[game.home_team_id, game.away_team_id].map(tid => {
              const rows = teamStats(tid)
              return (
                <div key={tid} className="min-w-0">
                  <TeamLink team={teamsMap[tid]} className="flex items-center gap-2 mb-2">
                    <CrestDisc team={teamsMap[tid]} size={28} />
                    <span className="text-[14px] font-extrabold text-fg-strong truncate">{teamsMap[tid]?.name || '—'}</span>
                    <span className="text-[12px] text-fg-muted">{tid === game.home_team_id ? 'בית' : 'חוץ'}</span>
                  </TeamLink>
                  <ul className="divide-y divide-line">
                    {rows.length === 0 && ownGoalsFor(tid) === 0 && <li className="text-[13px] text-fg-muted py-2">אין נתונים</li>}
                    {rows.map(stat => {
                      const p = playersMap[stat.player_id]
                      return (
                        <li key={stat.id} className="flex items-center justify-between gap-2 min-h-11 py-1">
                          <PlayerLink playerId={stat.player_id} className="text-[14px] text-fg-strong hover:underline truncate min-w-0">
                            {p ? `${p.first_name} ${p.last_name}` : '—'}
                            {loanFrom(stat) && <span className="text-[12px] text-fg-muted"> (בהשאלה מ{loanFrom(stat).name})</span>}
                          </PlayerLink>
                          <StatPills stat={stat} />
                        </li>
                      )
                    })}
                    {ownGoalsFor(tid) > 0 && (
                      <li className="flex items-center justify-between gap-2 min-h-11 py-1">
                        <span className="text-[14px] text-fg-muted truncate min-w-0">{ownGoalLabel(ownGoalsFor(tid))}</span>
                        <span className="inline-flex items-center gap-0.5 fl-num text-[15px] text-fg-muted"><Ball className="w-5 h-5" /><span dir="ltr">{ownGoalsFor(tid)}</span></span>
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
          {guestStats.length > 0 && (
            <div className="mt-4 pt-3 border-t border-line">
              <h3 className="text-[13px] font-bold text-fg-muted mb-1">אורחים</h3>
              <ul className="divide-y divide-line">
                {guestStats.map(stat => (
                  <li key={stat.id} className="flex items-center justify-between gap-2 min-h-11 py-1">
                    {/* Guests have no player_id → PlayerLink degrades to inert text */}
                    <PlayerLink playerId={stat.player_id} className="text-[14px] text-fg-strong truncate min-w-0">
                      {stat.guest_player_name}
                      {stat.guest_player_original_team && <span className="text-fg-muted"> ({stat.guest_player_original_team})</span>}
                    </PlayerLink>
                    <StatPills stat={stat} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </FLSection>
  )

  // Who signed up for each side — kept on the page after the final whistle.
  S.squads = done && user && <GameSquads game={game} teamsMap={teamsMap} playersMap={playersMap} />

  // SCORERS — כובשי השערים. When "שערים" already lists the box score (no minutes) the two
  // would be the same list, so it shows only next to the board's minute-by-minute goals.
  S.scorers = (scorers.length > 0 || ownGoalTotal > 0) && (tlAddsUp || !isPlayedStage(stage)) && (
    <FLSection title="כובשי השערים">
      <ul className="divide-y divide-line">
        {scorers.map(stat => {
          const p = playersMap[stat.player_id]
          const team = p ? teamsMap[sideOf(stat)] : null
          return (
            <li key={stat.id} className="flex items-center justify-between gap-3 min-h-12 py-1">
              <span className="flex items-center gap-2.5 min-w-0">
                {team ? <CrestDisc team={team} size={28} /> : <span className="size-7 rounded-full bg-surface-sunken flex items-center justify-center text-[11px] text-fg-muted shrink-0">א</span>}
                <PlayerLink playerId={stat.player_id} className="font-semibold text-[14px] text-fg-strong truncate hover:underline">{nameOfStat(stat)}</PlayerLink>
              </span>
              <span className="inline-flex items-center gap-0.5 fl-num text-[17px] text-fg-strong shrink-0"><span dir="ltr">{stat.goals}</span><Ball className="w-5 h-5" /></span>
            </li>
          )
        })}
        {[game.home_team_id, game.away_team_id].map(tid => ownGoalsFor(tid) > 0 && (
          <li key={`og-${tid}`} className="flex items-center justify-between gap-3 min-h-12 py-1">
            <span className="flex items-center gap-2.5 min-w-0">
              <CrestDisc team={teamsMap[tid]} size={28} />
              <span className="font-semibold text-[14px] text-fg-muted truncate">{ownGoalLabel(ownGoalsFor(tid))}</span>
            </span>
            <span className="inline-flex items-center gap-0.5 fl-num text-[17px] text-fg-muted shrink-0"><span dir="ltr">{ownGoalsFor(tid)}</span><Ball className="w-5 h-5" /></span>
          </li>
        ))}
      </ul>
    </FLSection>
  )

  // BEFORE THE GAME: recent form + head-to-head (מפגשים קודמים)
  S.preGame = (
    <FLSection title="לפני המשחק">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-bold text-fg-strong">כושר אחרון</h3>
          <p className="text-[11.5px] text-fg-muted">5 משחקים אחרונים · נ ניצחון · ת תיקו · ה הפסד</p>
        </div>
        {[{ team: home, form: homeForm, side: 'בית' }, { team: away, form: awayForm, side: 'חוץ' }].map(({ team, form, side }) => (
          <div key={side} className="flex items-center justify-between gap-3 p-2.5 rounded-[14px] bg-surface-sunken">
            <TeamLink team={team} className="flex items-center gap-2.5 min-w-0">
              <CrestDisc team={team} size={36} />
              <span className="min-w-0">
                <span className="block font-bold text-[14px] text-fg-strong truncate">{team?.name || '—'}</span>
                <span className="block text-[11.5px] text-fg-muted">{side}</span>
              </span>
            </TeamLink>
            {form.length > 0 ? (
              <span className="flex gap-1 shrink-0">
                {form.map((r, i) => (
                  <span key={i} title={resultLabel(r)} aria-label={resultLabel(r)}
                    className={`size-7 rounded-lg flex items-center justify-center text-[12px] font-bold ${formTone(r)}`}>
                    {r === 'win' ? 'נ' : r === 'loss' ? 'ה' : 'ת'}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-[11.5px] text-fg-muted shrink-0">אין משחקים קודמים</span>
            )}
          </div>
        ))}
      </div>

      {/* Head-to-head: only when the two teams actually met before */}
      {h2h.length > 0 && (
        <div className="flex flex-col gap-1 pt-3 mt-3 border-t border-line">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-fg-strong"><Swords className="w-5 h-5" /> מפגשים קודמים</h3>
            <p className="text-[11.5px] text-fg-muted">מנקודת מבט {home?.name || 'הבית'}</p>
          </div>
          {h2h.map(g => {
            const wasHome = g.home_team_id === game.home_team_id
            const my = wasHome ? g.home_score : g.away_score
            const opp = wasHome ? g.away_score : g.home_score
            const result = my > opp ? 'win' : my < opp ? 'loss' : 'tie'
            const gh = teamsMap[g.home_team_id], ga = teamsMap[g.away_team_id]
            return (
              <Link key={g.id} to={entityPath('games', g)} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 min-h-12 px-1 rounded-xl hover:bg-surface-sunken transition-colors">
                <span dir="ltr" className="text-[12.5px] text-fg-muted tabular-nums">{shortDate(g.game_date)}</span>
                {/* Home RIGHT: crest · score · score · crest, physical left→right = away … home. */}
                <span dir="ltr" className="flex items-center justify-center gap-2" aria-label={`${gh?.name} ${g.home_score}, ${ga?.name} ${g.away_score}`}>
                  <CrestDisc team={ga} size={26} />
                  <span className="fl-num text-[17px] text-fg-strong">{g.away_score}</span>
                  <span className="text-fg-muted">:</span>
                  <span className="fl-num text-[17px] text-fg-strong">{g.home_score}</span>
                  <CrestDisc team={gh} size={26} />
                </span>
                <span className={`text-[11.5px] font-bold px-2 py-1 rounded-md ${formTone(result)}`}>{resultLabel(result)}</span>
              </Link>
            )
          })}
        </div>
      )}
    </FLSection>
  )

  // סטופר מרקט: the predictions — % view-only for everyone; predicting is 18+ (RPC gate)
  S.market = <GameMarketCard game={game} teamsMap={teamsMap} />

  // TEAM PAGE LINKS — home on the RIGHT
  S.teamLinks = (
    <div className="grid grid-cols-2 gap-2">
      {[home, away].map((team, i) => (
        <TeamLink key={i} team={team} className="fl-card min-h-14 flex items-center justify-center gap-2 px-3 text-[14px] font-bold text-fg-strong hover:bg-surface-sunken transition-colors">
          <CrestDisc team={team} size={28} />
          <span className="truncate">{team?.name || '—'}</span>
          <ArrowLeft className="w-4 h-4 shrink-0 text-fg-muted" />
        </TeamLink>
      ))}
    </div>
  )

  // ================= order, by stage (iOS GameDetailView.content) =================
  const upcoming = stage === STAGE.before || stage === STAGE.gameDay || stage === STAGE.postponed
  let phone, main, side
  if (liveStage) {
    phone = ['tools', 'video', 'liveBand', 'liveMeta', 'quick', 'timeline', 'kiosk', 'fans', 'market', 'mediaUpload', 'formCard', 'lmBroadcast', 'posts', 'medics', 'preGame', 'teamLinks']
    main = ['video', 'liveBand', 'liveMeta', 'quick', 'timeline', 'posts', 'mediaUpload']
    side = ['tools', 'kiosk', 'fans', 'market', 'formCard', 'lmBroadcast', 'medics', 'preGame', 'teamLinks']
  } else if (upcoming) {
    phone = ['postponed', 'quick', 'broadcastNote', 'video', 'kiosk', 'loan', 'availability', 'market', 'fans', 'preGame', 'changeRequest', 'opponent', 'selfSubmit', 'formCard', 'lmBroadcast', 'medics', 'about', 'posts', 'teamLinks']
    main = ['postponed', 'broadcastNote', 'video', 'loan', 'availability', 'posts', 'about']
    side = ['quick', 'kiosk', 'market', 'fans', 'preGame', 'changeRequest', 'opponent', 'selfSubmit', 'formCard', 'lmBroadcast', 'medics', 'teamLinks']
  } else {
    phone = ['video', 'goals', 'timeline', 'kiosk', 'about', 'story', 'tiles', 'formCard', 'posts', 'mvp', 'boxScore', 'scorers', 'matchCentre', 'market', 'squads', 'fans', 'mediaUpload', 'lmBroadcast', 'medics', 'preGame', 'teamLinks']
    main = ['video', 'goals', 'timeline', 'story', 'posts', 'boxScore', 'squads', 'mediaUpload']
    side = ['kiosk', 'about', 'tiles', 'mvp', 'scorers', 'matchCentre', 'market', 'fans', 'formCard', 'lmBroadcast', 'medics', 'preGame', 'teamLinks']
  }
  const stack = (keys) => keys.map(k => S[k] ? <SectionSlot key={k} name={k} className={k === 'tools' ? 'flex flex-wrap items-center gap-2' : ''}>{S[k]}</SectionSlot> : null)

  return (
    <div className="max-w-6xl mx-auto lg:px-8 lg:pt-6 pb-6">
      {S.season && <div className="px-3 pt-3 lg:px-0 lg:pt-0 lg:mb-4">{S.season}</div>}
      {isDesktop && <div className="mb-4 flex flex-wrap items-center justify-end gap-2 empty:hidden">{S.tools}</div>}
      {S.hero}
      {isDesktop ? (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-6 items-start">
          <div className="flex flex-col gap-4 min-w-0">{stack(main)}</div>
          <aside className="flex flex-col gap-4 min-w-0">{stack(side.filter(k => k !== 'tools'))}</aside>
        </div>
      ) : (
        <div className={`flex flex-col gap-3.5 px-3 ${liveStage ? 'pt-3' : 'pt-4'}`}>{stack(phone)}</div>
      )}

      {showChangeModal && (
        <GameChangeRequestModal
          game={game} home={home} away={away}
          onClose={() => setShowChangeModal(false)}
          onSubmitted={refreshMyRequest}
        />
      )}
    </div>
  )
}

/** A stack slot: keeps the section's own markup; empty children (a component that
 * rendered nothing) collapse so they leave no gap. */
function SectionSlot({ name, className = '', children }) {
  return <div data-section={name} className={`empty:hidden min-w-0 ${className}`}>{children}</div>
}
