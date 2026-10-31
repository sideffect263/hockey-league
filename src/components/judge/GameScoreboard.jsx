import { useState, useRef, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useGameEngine, clearEngineDraft } from "@/lib/game/useGameEngine"
import { saveGameResultReliably } from "@/lib/judge"
import { getGameAvailabilityForOfficial } from "@/lib/availability"
import { broadcastGameState, buildLiveEvents, setGameStatus } from "@/lib/live"
import { clockString } from "@/lib/game/format"
import { Phase, TeamSide, CardType, GameFormat, GameRules, BreakKind, isPenaltyFoul, isWarningFoul } from "@/lib/game/rules"
import { issueSuspension, revokeRedCardSuspension, getGamePlayerEligibility } from "@/lib/suspensions"
import { eligibilityMap, ineligibleReasons, isBlocked } from "@/lib/eligibility"
import { useAuth } from "@/lib/AuthContext"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import LineupEditor, { loadLineup, saveLineup, emptyLineup } from "@/components/judge/LineupEditor"
import { EligibilityChips, OverrideButton, EligibilityWarning } from "@/components/judge/Eligibility"
import { RotateCcw, Settings as SettingsIcon, SkipForward, Undo2, Plus, Minus, X, Maximize, Minimize, Loader2, Check, Flag, Pencil, Megaphone, AlertTriangle, ArrowDownToLine, Timer, Smartphone } from "lucide-react"
import { Squad as Users, GoalIcon } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { RinkDrawing } from "@/components/fl/Floodlight"
import { JL, nameTint, glowOf, panelFill, periodName, boardTitle, nextPeriodNote, eventMinute, cardWho, cardClock, useBoardScale, loadYellows, saveYellows } from "@/components/fl/tools/judgeLook"

/* ============================================================================
 * Web judge board (Floodlight, boards JudgeBoard / JudgeScorer / JudgeCard /
 * JudgeConfirm / JudgeSettings) — mirrors the iOS `ScoreboardView` on branch floodlight.
 *   • ALWAYS landscape (a portrait phone gets a "סובבו את הטלפון" prompt), sized for a TV.
 *   • HOME ON THE RIGHT (board pinned LTR: away left · centre · home right).
 *   • Tap the CLOCK to start/pause (or skip a break).
 *   • Tap a team's SCORE → scorer picker; LONG-PRESS undoes the last goal.
 *   • Tap FOULS to add; long-press to undo.
 *   • Yellow / blue / red card buttons → card picker; long-press takes back that side's
 *     last card of that colour. ONLY blue cards get a board timer, stacked under the
 *     clock on the carded team's side (long-press a timer to remove it). Red keeps its
 *     engine timer (box score / suspension) but is never drawn; yellow has no timer.
 *   • Yellow cards are UI-local (kept per game on this device): the save RPC and the
 *     live broadcast have no yellow field yet (needs backend).
 *   • 2 timeouts per period (tap = call, long-press = undo), the 45 s passive pill.
 *   • Control bar: reset (double-tap) · edit time · horn · lineup · settings · end game.
 * The engine, broadcast, save and eligibility logic is unchanged from the pre-Floodlight
 * board; only the look and layout moved.
 * ==========================================================================*/

const byJersey = (a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)
const toRef = (p) => ({ id: p.id, number: p.jersey_number ?? 0, name: `${p.first_name} ${p.last_name}` })
const HOLD_MS = 400
const TOUCH = { touchAction: "manipulation", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: "pointer" }

const HE = {
  fouls: "עבירות", timeout: "פסק זמן",
  tapToStart: "הקש על השעון כדי להתחיל", paused: "מושהה",
  namePlaceholder: "שם", minutes: "דק׳", seconds: "שנ׳",
  skipBreak: "דלג על ההפסקה", endTimeout: "סיים פסק זמן",
  timeoutsUsed: (n, max) => `פסקי זמן במחצית: ${n}/${max}`,
  settings: "הגדרות", format: "פורמט משחק", formatHalves: "שתי מחציות", formatThirds: "שלישים",
  periodLength: "אורך מחצית", overtime: "הארכה בתיקו", overtimeLength: "אורך הארכה", breakLength: "אורך מנוחה",
  passivePlay: "שעון משחק פסיבי", theme: "מראה הלוח", themeLed: "LED · זוהר", themeModern: "פלודלייט",
  resetGame: "אפס משחק", done: "סיום", cancel: "ביטול", noPlayer: "ללא שיוך לשחקן", later: "אשלים אחר כך", ownGoal: "שער עצמי",
  ownGoalHint: "שחקן היריבה הבקיע לשער של קבוצתו",
  saveResult: "שמירת התוצאה", abandon: "החזר למצב 'טרם החל'",
  abandonConfirm: "להחזיר את המשחק למצב 'טרם החל'?", abandonYes: "כן, החזר",
  endGame: "סיום משחק", endGameTitle: "לסיים את המשחק עכשיו?", endGameYes: "סיום משחק",
  endGameBody: "השעון נעצר והתוצאה הזאת תישמר. אפשר עוד לתקן לפני השמירה.",
  fullscreen: "מסך מלא",
}

/* Board themes. LED = the running clock glows cyan and the scores carry their team's
 * glow; פלודלייט = the same dark board, no glow. `T` keeps the keys the lineup editor
 * and eligibility chips read (accent / panel / cardBlue / cardRed / strike / passive). */
const THEMES = {
  led: { led: true, bg: JL.page, panel: JL.panel, primaryText: "#ffffff", secondaryText: JL.sub, accent: JL.accent,
    cardBlue: JL.blue, cardRed: JL.red, strike: JL.foul, passive: JL.passive },
  modern: { led: false, bg: JL.page, panel: JL.panel, primaryText: "#ffffff", secondaryText: JL.sub, accent: JL.accent,
    cardBlue: JL.blue, cardRed: JL.red, strike: JL.foul, passive: JL.passive },
}

// One shared AudioContext for the buzzer — different tone per buzz kind, mirroring
// the iOS BuzzerPlayer so a judge hears goals vs. foul penalties.
let _actx = null
function beep(kind) {
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)()
    const ctx = _actx
    // passiveStart is a light tick that must not be mistaken for a whistle; passiveEnd
    // sits between a foul warning and the period-end blast — it stops play, but it is
    // not the end of anything.
    const freq = kind === "teamFoulPenalty" ? 880 : kind === "teamFoulWarning" ? 660
      : kind === "goal" ? 520 : kind === "card" ? 380
      : kind === "passiveStart" ? 1046 : kind === "passiveEnd" ? 784 : 700
    const dur = kind === "teamFoulPenalty" ? 0.55 : (kind === "periodEnd" || kind === "gameEnd") ? 0.7
      : kind === "passiveStart" ? 0.07 : kind === "passiveEnd" ? 0.45 : 0.18
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = "square"; o.frequency.value = freq
    g.gain.setValueAtTime(0.12, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    o.connect(g); g.connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + dur)
  } catch { /* audio unavailable — non-critical */ }
}

// Tap vs. long-press on one element (add on tap, undo on hold) — the iOS
// onTapGesture + onLongPressGesture model. Suppresses the tap after a hold fires.
// Keyboard: Enter/Space = tap (the element is a role=button div or a <button>).
function useHold(onTap, onHold, ms = HOLD_MS) {
  const timer = useRef(null)
  const held = useRef(false)
  const start = () => { held.current = false; timer.current = setTimeout(() => { held.current = true; onHold?.() }, ms) }
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClick: () => { if (!held.current) onTap?.() },
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap?.() } },
    onContextMenu: (e) => e.preventDefault(),
  }
}

/** A card as the board draws it: a small upright rectangle in the card's colour. */
function CardChip({ color, w }) {
  return <span aria-hidden="true" className="inline-block shrink-0" style={{ width: w, height: w * 1.36, borderRadius: Math.max(2, w * 0.14), background: color, boxShadow: "0 1px 0 rgba(255,255,255,.25) inset" }} />
}

/* ---------- team column: crest + name · score · fouls · cards · timeout ---------- */
function TeamColumn({ side, engine, T, team, k, v, reserveCorner, setPicker, undoCard }) {
  const s = engine._side(side)
  const isHome = side === TeamSide.home
  const editing = engine.phase === Phase.editing
  const tint = nameTint(team)
  const scoreHold = useHold(() => setPicker({ side, kind: "goal" }), () => engine.removeGoal(side))
  const foulHold = useHold(() => engine.addStrike(side, null), () => engine.removeStrike(side))
  // Timeout: tap to call (running/paused only), hold to undo a mis-tap. Not a disabled
  // <button> — a disabled one swallows the long-press, and undo matters most at 2/2.
  const timeoutHold = useHold(() => { if (engine.canTimeout(side)) engine.requestTimeout(side) }, () => engine.removeTimeout(side))
  const canTimeout = engine.canTimeout(side)
  const displayScore = isHome ? engine.homeDisplayScore : engine.guestDisplayScore
  const lost = engine.phase === Phase.over && engine.result && engine.result !== "tie" && engine.result !== (isHome ? "homeWin" : "guestWin")
  const n = s.strikes
  const hot = isWarningFoul(n) || isPenaltyFoul(n)
  const name = s.name || team?.name || ""
  // iOS: 31/25/22pt by length, then shrink to fit (minimumScaleFactor 0.5).
  const nameAvail = 232 * k - (team ? 60 * k : 0) - (reserveCorner ? 52 : 0)
  const nameBase = (name.length <= 9 ? 31 : name.length <= 12 ? 25 : 22) * k
  const nameSize = Math.max(nameBase * 0.5, Math.min(nameBase, nameAvail / Math.max(1, name.length * 0.55)))
  const crest = team ? <TeamLogo team={team} px={Math.round(52 * k)} /> : null
  const glow = T.led && team && !lost ? glowOf(team) : null

  return (
    <div className="flex flex-col shrink-0" style={{ width: 232 * k, gap: 4 * v, opacity: editing ? 0.6 : 1 }}>
      {/* header: home = [name, crest] hugging the RIGHT edge; away = [crest, name] on the left */}
      <div className="flex items-center min-w-0" style={{ height: 58 * v, gap: 8 * k, paddingLeft: reserveCorner ? 52 : 0, justifyContent: isHome ? "flex-end" : "flex-start" }}>
        {!isHome && crest}
        {editing ? (
          <input dir="rtl" value={s.name} onChange={(e) => { engine._side(side).name = e.target.value; engine._changed() }} placeholder={HE.namePlaceholder}
            aria-label={isHome ? "שם קבוצת הבית" : "שם קבוצת החוץ"}
            className="min-w-0 flex-1 text-center rounded-lg px-2 font-bold outline-none border"
            style={{ height: Math.max(40, 40 * v), fontSize: 18 * k, color: "#fff", background: JL.raised, borderColor: JL.line }} />
        ) : (
          <span dir="rtl" className="font-extrabold leading-tight truncate min-w-0" style={{ color: tint, fontSize: nameSize }}>{name}</span>
        )}
        {isHome && crest}
      </div>

      {/* score — tap: scorer picker · hold: undo the last goal */}
      <div {...scoreHold} role="button" tabIndex={0} aria-label={`${name} ${s.score}. הקשה: שער · לחיצה ארוכה: ביטול השער האחרון`}
        className="fl-num flex items-center justify-center leading-none select-none rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2B233]"
        style={{ ...TOUCH, height: 132 * v, fontSize: 136 * k, color: lost ? JL.faint : "#fff", textShadow: glow ? `0 0 14px ${glow}, 0 0 28px ${glow}88` : "none" }}>
        <span dir="ltr">{displayScore}</span>
      </div>

      {/* fouls — tap: +1 · hold: −1. Turns red one foul before a penalty and on it. */}
      <div {...foulHold} role="button" tabIndex={0} aria-label={`${HE.fouls} ${name} ${n}. הקשה: עבירה · לחיצה ארוכה: ביטול`}
        dir="rtl" className="flex items-center justify-center rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2B233]"
        style={{ ...TOUCH, height: 66 * v, gap: 12 * k, background: "rgba(17,23,31,.55)" }}>
        <span className="font-extrabold" style={{ fontSize: 16 * k, color: JL.sub }}>{HE.fouls}</span>
        <span className="fl-num leading-none" style={{ fontSize: 58 * k, color: hot ? JL.passiveWarn : JL.foul }}>{n}</span>
      </div>

      {/* cards — yellow · blue · red. Tap: card picker · hold: take back that colour's last card */}
      <div className="flex" style={{ height: 48 * v, gap: 6 * k }}>
        {[["yellow", JL.yellow, "צהוב"], ["blue", JL.blue, "כחול"], ["red", JL.red, "אדום"]].map(([kind, color, label]) => (
          <CardButton key={kind} color={color} k={k} label={`כרטיס ${label} ל${name}. לחיצה ארוכה: ביטול הכרטיס ה${label} האחרון`}
            onTap={() => setPicker({ side, kind })} onHold={() => undoCard(side, kind)} />
        ))}
      </div>

      {/* timeout — one dot per allowed timeout this period (filled = taken) */}
      <div {...timeoutHold} role="button" tabIndex={0} aria-disabled={!canTimeout || undefined}
        aria-label={`${HE.timeout} ${name}. ${HE.timeoutsUsed(s.timeoutsThisPeriod, GameRules.maxTimeoutsPerPeriod)}. לחיצה ארוכה: ביטול`}
        dir="rtl" className="flex items-center justify-center rounded-xl font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2B233]"
        style={{ ...TOUCH, height: Math.max(44, 44 * v), gap: 8 * k, background: JL.panel, color: tint, opacity: canTimeout ? 1 : 0.3, fontSize: 13 * k }}>
        <span>{HE.timeout}</span>
        <span className="inline-flex items-center" style={{ gap: 5 }} aria-hidden="true">
          {Array.from({ length: GameRules.maxTimeoutsPerPeriod }, (_, i) => (
            <span key={i} className="inline-block rounded-full" style={{ width: 9 * k, height: 9 * k, border: `1.5px solid ${tint}`, background: i < s.timeoutsThisPeriod ? tint : "transparent" }} />
          ))}
        </span>
      </div>
    </div>
  )
}

function CardButton({ color, k, label, onTap, onHold }) {
  const hold = useHold(onTap, onHold)
  return (
    <div {...hold} role="button" tabIndex={0} aria-label={label}
      className="flex-1 flex items-center justify-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2B233]"
      style={{ ...TOUCH, background: "rgba(17,23,31,.55)", minHeight: 44 }}>
      <CardChip color={color} w={22 * k} />
    </div>
  )
}

/* ---------- a side's running BLUE cards, shortest first (3 shown, then +N) ---------- */
function CardStack({ side, engine, k, v, onRemove }) {
  const cards = engine.cards.filter(c => c.side === side && c.type === CardType.blue && (c.remainingMS ?? (c.remainingS ?? 0) * 1000) > 0)
    .sort((a, b) => (a.remainingMS ?? 0) - (b.remainingMS ?? 0))
  return (
    <div className="flex flex-col min-w-0" style={{ gap: 4 * v }}>
      {cards.slice(0, 3).map(c => <BlueTimer key={c.id} card={c} k={k} v={v} onRemove={() => onRemove(c.id)} />)}
      {cards.length > 3 && (
        <span className="fl-num flex items-center justify-center rounded-lg" style={{ fontSize: 13 * k, minHeight: 24 * v, border: `1.5px solid ${JL.blue}` }}>+{cards.length - 3}</span>
      )}
    </div>
  )
}

function BlueTimer({ card, k, v, onRemove }) {
  const hold = useHold(undefined, onRemove)
  return (
    <div {...hold} role="button" tabIndex={0} aria-label={`כרטיס כחול ${cardWho(card.player)} ${cardClock(card.remainingS)}. לחיצה ארוכה: ביטול הכרטיס`}
      dir="rtl" className="flex items-center justify-between rounded-[9px] text-white min-w-0"
      style={{ ...TOUCH, background: JL.blue, height: Math.max(30, 34 * v), padding: `0 ${10 * k}px`, gap: 6 }}>
      <span className="font-extrabold truncate min-w-0" style={{ fontSize: 15 * k }}>{cardWho(card.player)}</span>
      <span dir="ltr" className="fl-num shrink-0" style={{ fontSize: 23 * k }}>{cardClock(card.remainingS)}</span>
    </div>
  )
}

/* ---------- 45 s passive-play pill (tap resets to 45) ---------- */
function PassivePill({ engine, k, v }) {
  if (!engine.settings.passivePlayEnabled) return <div style={{ height: 44 * v }} />
  const warn = engine.passiveIsWarning
  return (
    <button type="button" onClick={() => engine.resetPassive()} aria-label={`משחק פסיבי ${engine.passiveSeconds}. הקשה מאפסת ל־45`}
      className="w-full flex items-center justify-center rounded-full motion-safe:transition-transform motion-safe:duration-200"
      style={{ ...TOUCH, minHeight: Math.max(44, 44 * v), gap: 6, color: warn ? JL.passiveWarn : JL.passive, transform: warn && engine.isRunning ? "scale(1.12)" : "none" }}>
      <Timer style={{ width: 17 * k, height: 17 * k }} strokeWidth={2.5} aria-hidden="true" />
      <span className="fl-num leading-none" style={{ fontSize: 26 * k }}>{engine.passiveSeconds}</span>
    </button>
  )
}

function ControlBtn({ icon: Icon, onClick, on = false, k, v, label, disabled = false, children }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} disabled={disabled}
      className="flex items-center justify-center rounded-xl transition-colors disabled:opacity-35"
      style={{ width: Math.max(44, 48 * k), height: Math.max(44, 44 * v), background: on ? JL.accent : JL.panel, color: on ? JL.onAccent : JL.muted }}>
      {children || <Icon style={{ width: 19 * k, height: 19 * k }} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  )
}

export default function GameScoreboard({ game, home, guest, players, teams = [] }) {
  const engine = useGameEngine(game, home, guest)
  const { k, v, w: boardW, portrait } = useBoardScale()
  const { isAdmin, isLeagueManager } = useAuth()
  const canOverride = isAdmin || isLeagueManager
  // Who may play (suspension / valid medical). undefined = loading, null = failed →
  // block nobody but say so; Map = loaded. See src/lib/eligibility.js.
  const [elig, setElig] = useState(undefined)
  // Sign-ups keep changing after the judge opens the board — a coach approves a loan, a
  // player pulls out — so eligibility (which also carries each loan's side) and attendance
  // are re-read every minute. A failed RE-read keeps what we had; only the first one can
  // leave the board without data.
  const [squadTick, setSquadTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSquadTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    let alive = true
    getGamePlayerEligibility(game.id)
      .then(rows => { if (alive) setElig(eligibilityMap(rows)) })
      .catch(e => { console.warn("eligibility unavailable", e); if (alive && squadTick === 0) setElig(null) })
    return () => { alive = false }
  }, [game.id, squadTick])
  const [attendingIds, setAttendingIds] = useState(null) // Set of confirmed player_ids; null until loaded
  const [showAllRoster, setShowAllRoster] = useState(false)
  // Rosters come from player_teams (a player can be on one team per age group), with
  // each player's primary team_id as a fallback until the memberships load.
  const [memberRows, setMemberRows] = useState([])
  useEffect(() => {
    let alive = true
    getPlayerTeams().then(rows => { if (alive) setMemberRows(rows) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const { byTeam } = buildMemberMaps(memberRows, players)
  // Game-day lineup: the judge can hide squad players, borrow a player from another
  // team, or add a free-text guest. Kept per game on this device (like the engine draft).
  const [lineup, setLineupState] = useState(() => loadLineup(game.id))
  const setLineup = (next) => { setLineupState(next); saveLineup(game.id, next) }
  const [lineupSide, setLineupSide] = useState(null) // TeamSide being edited, or null
  const playersById = new Map(players.map(p => [p.id, p]))
  const sideKey = (side) => (side === TeamSide.home ? "home" : "guest")
  // Ids an admin / league manager let play despite a block — per side, kept in the lineup.
  const allowedFor = (side) => lineup[sideKey(side)]?.allowed || []
  const blockedOn = (side, id) => isBlocked(elig, id, allowedFor(side))
  const allowPlayer = (side, id) => {
    if (!canOverride || !id) return
    const k = sideKey(side), l = lineup[k]
    setLineup({ ...lineup, [k]: { ...l, allowed: [...(l.allowed || []).filter(x => x !== id), id] } })
  }
  const squadFor = (side) => {
    const teamId = side === TeamSide.home ? game.home_team_id : game.away_team_id
    const own = byTeam.get(teamId) || new Set()
    // Loans: a player signed up for this side (an accepted loan invite / ask, or a coach's
    // direct add) is on neither roster, so the roster alone left him off the board and the
    // judge typed his goals on a teammate (10/10). game_player_eligibility returns the
    // sign-up's side; only those still marked coming count.
    const loaned = elig instanceof Map
      ? [...elig.values()]
          .filter(r => r.team_id === teamId && !own.has(r.player_id)
            && (!attendingIds || attendingIds.has(r.player_id)))
          .map(r => r.player_id)
      : []
    return [...own, ...loaned].map(id => playersById.get(id)).filter(Boolean)
  }
  // C4: default the roster to confirmed attendees; the judge can switch to the full
  // squad. Borrowed players and guests are always shown. GK clean-sheet detection
  // uses the FULL lineup minus free-text guests (see doSave).
  // Decided PER SIDE: a team with no sign-ups shows its full squad. Deciding once for
  // the whole game blanked the other team whenever only one side had signed up.
  const sideHasAttendees = (side) => !!attendingIds && squadFor(side).some(p => attendingIds.has(p.id))
  const useAttending = !showAllRoster && !!attendingIds && attendingIds.size > 0
  const rosterOf = (side, { attendingOnly = false, withGuests = true } = {}) => {
    const l = lineup[sideKey(side)] || emptyLineup().home
    const hidden = new Set(l.hidden)
    const filterSide = attendingOnly && sideHasAttendees(side)
    const squad = squadFor(side).filter(p => !hidden.has(p.id) && (!filterSide || attendingIds.has(p.id)))
    const squadIds = new Set(squad.map(p => p.id))
    const borrowed = l.added.map(id => playersById.get(id)).filter(p => p && !squadIds.has(p.id))
    const guests = !withGuests ? [] : l.guests.map(g => ({
      id: null, _key: g.key, _guest: true, first_name: g.name, last_name: "", jersey_number: g.number ?? null, position: "Field Player",
    }))
    return [...squad, ...borrowed, ...guests].sort(byJersey)
  }
  // Blocked players can't have played → no clean sheet for an ineligible GK.
  const fullHomeRoster = rosterOf(TeamSide.home, { withGuests: false }).filter(p => !blockedOn(TeamSide.home, p.id))
  const fullGuestRoster = rosterOf(TeamSide.guest, { withGuests: false }).filter(p => !blockedOn(TeamSide.guest, p.id))
  const homeRoster = rosterOf(TeamSide.home, { attendingOnly: useAttending })
  const guestRoster = rosterOf(TeamSide.guest, { attendingOnly: useAttending })
  const homeScore = engine.homeFinalScore
  const awayScore = engine.guestFinalScore

  const navigate = useNavigate()
  const [picker, setPicker] = useState(null)      // { side, kind: 'goal'|'yellow'|'blue'|'red' }
  const [themeKind, setThemeKind] = useState("led")
  const [resetArmed, setResetArmed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [confirmAbandon, setConfirmAbandon] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [isFs, setIsFs] = useState(false)
  const wrapRef = useRef(null)
  const T = THEMES[themeKind]
  // Yellow cards: UI-local, kept per game on this device (no backend field yet — see judgeLook.js).
  const [yellows, setYellowsState] = useState(() => loadYellows(game.id))
  const setYellows = (next) => { setYellowsState(next); saveYellows(game.id, next) }
  // The short line after every action ("עבירה 4 · בלג אריות"), with its undo hint.
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = (text) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const [buzzFlash, setBuzzFlash] = useState(false)
  const sideName = (side) => engine._side(side).name || (side === TeamSide.home ? home : guest)?.name || ""
  const openPicker = (p) => setPicker(p)
  // Long-press a card button: take back that side's LAST card of that colour.
  const undoCard = (side, kind) => {
    if (kind === "yellow") {
      const idx = yellows.map(y => y.side).lastIndexOf(side)
      if (idx >= 0) { setYellows(yellows.filter((_, i) => i !== idx)); showToast(`כרטיס צהוב בוטל · ${sideName(side)}`) }
      return
    }
    const type = kind === "red" ? CardType.red : CardType.blue
    const last = [...engine.cardLog].reverse().find(c => c.side === side && c.type === type)
    if (last) { removeCard(last.id); showToast(`כרטיס ${kind === "red" ? "אדום" : "כחול"} בוטל · ${sideName(side)}`) }
  }

  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", h)
    return () => document.removeEventListener("fullscreenchange", h)
  }, [])

  // Load who confirmed attendance → default the player picker to attendees (C4).
  useEffect(() => {
    let alive = true
    getGameAvailabilityForOfficial(game.id).then(rows => {
      if (alive) setAttendingIds(new Set(rows.filter(r => r.status === "available").map(r => r.player_id)))
    }).catch(() => { if (alive && squadTick === 0) setAttendingIds(new Set()) })
    return () => { alive = false }
  }, [game.id, squadTick])

  // Buzzer sound on every engine buzz (goal / card / foul / manual / period-end).
  const lastBuzz = useRef(-1)
  useEffect(() => {
    const seq = engine.buzzSeq ?? 0
    if (lastBuzz.current === -1) { lastBuzz.current = seq; return }
    if (seq !== lastBuzz.current) {
      lastBuzz.current = seq; beep(engine.lastBuzzKind)
      setBuzzFlash(true); setTimeout(() => setBuzzFlash(false), 300)
    }
  }, [engine.buzzSeq, engine.lastBuzzKind])

  // Live broadcast — one push on mount, then only on the significant signature
  // (score / running / phase / period); never per clock tick.
  const lastSig = useRef(null)
  useEffect(() => {
    if (game.status === "completed") return
    // Event counts are in the signature so a card/foul (which changes neither score
    // nor phase) still pushes a broadcast — that's what carries the play-by-play.
    const sig = () => [engine.homeFinalScore, engine.guestFinalScore, engine.isRunning, engine.phase, engine.periodLabel, engine.goals.length, engine.strikes.length, engine.cardLog.length, engine.breaks.length].join("|")
    lastSig.current = sig()
    // Skip broadcasting an untouched board: it would flip the game to "live" and
    // overwrite an existing live row (including a snapshot we might still recover
    // from) before the judge acts. The first real change broadcasts via subscribe.
    if (!engine.isPristine()) broadcastGameState(engine, game.id)
    return engine.subscribe(() => {
      const s = sig()
      if (s === lastSig.current) return
      lastSig.current = s
      broadcastGameState(engine, game.id)
    })
  }, [engine, game.id, game.status])

  // A break clock (timeout / halftime) runs too — it gets the heartbeat as well.
  const clockTicking = engine.isRunning || engine.phase === Phase.breakTime
  // Heartbeat: while the clock is running, re-broadcast every 10s so `updated_at`
  // stays fresh. If the judge disconnects (tab closed / phone dead), the heartbeat
  // stops and spectators freeze the clock ("ממתין לשופט") instead of it running
  // down to 0 with nobody officiating (see LiveGame.jsx judgeGone()).
  useEffect(() => {
    if (game.status === "completed" || !clockTicking) return
    const iv = setInterval(() => broadcastGameState(engine, game.id), 10000)
    return () => clearInterval(iv)
  }, [engine, clockTicking, game.id, game.status])

  const doAbandon = async () => {
    setAbandoning(true); setSaveErr(null)
    try {
      await setGameStatus(game.id, "scheduled")
      clearEngineDraft(game.id)
      navigate("/judge")
    } catch { setSaveErr("שגיאה בהחזרת המשחק למצב 'טרם החל'"); setAbandoning(false) }
  }

  const toggleFs = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else {
        await wrapRef.current?.requestFullscreen?.()
        try { await window.screen?.orientation?.lock?.("landscape") } catch { /* unsupported */ }
      }
    } catch { /* ignore */ }
  }
  const closeBoard = async () => {
    if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* ignore */ } }
    navigate("/judge")
  }

  const rosterFor = (side) => (side === TeamSide.home ? homeRoster : guestRoster)
  // Own goal: counts for the TAPPED side (the one that benefits), no scorer.
  const resolveOwnGoal = () => {
    if (!picker || picker.kind !== "goal") return
    engine.addGoal(picker.side, null, { ownGoal: true })
    showToast(`שער עצמי · ${sideName(picker.side)}`)
    setPicker(null)
  }
  const resolvePick = (p) => {
    if (!picker) return
    if (p?.id && blockedOn(picker.side, p.id)) return // ineligible — needs an admin override first
    const ref = p ? toRef(p) : null
    const who = p ? `${p.jersey_number != null ? `#${p.jersey_number} ` : ""}${p.first_name}` : ""
    if (picker.kind === "goal") { engine.addGoal(picker.side, ref); showToast(`שער ל${sideName(picker.side)}${who ? ` · ${who}` : ""}`) }
    else if (picker.kind === "yellow") {
      // Board-only record (see judgeLook.js): no timer, nothing drawn, not saved to the server.
      setYellows([...yellows, { id: `y${Date.now()}`, side: picker.side, player: ref, timeMS: engine.clock.remainingMS, half: engine.currentHalf }])
      showToast(`כרטיס צהוב · ${who || sideName(picker.side)}`)
    }
    else {
      engine.addCard(picker.side, ref, picker.kind === "red" ? CardType.red : CardType.blue)
      // Sheet rows 5/15: a red card blocks the player's NEXT game. Issued here, as it
      // happens, rather than derived from the scoresheet afterwards — the judge is the
      // one who saw it. Only for a real player card (a free-text guest has nothing to
      // block), and best-effort: a failure here must never disrupt officiating.
      if (picker.kind === "red" && p?.id) {
        issueSuspension(p.id, { gameId: game.id, reason: `כרטיס אדום · ${p.first_name} ${p.last_name}` })
          .catch(() => {})
      }
      showToast(`כרטיס ${picker.kind === "red" ? "אדום" : "כחול"} · ${who || sideName(picker.side)}`)
    }
    setPicker(null)
  }

  // Removing a red card on the board also lifts the suspension it filed for this game.
  // Best-effort, like the issue: officiating must never stall on it.
  const revokeRed = (playerId) => {
    if (playerId == null || !game?.id) return
    revokeRedCardSuspension(game.id, playerId).catch(() => {})
  }
  const removeCard = (id) => {
    const card = engine.removeCard(id)
    if (card?.type === CardType.red && card.player?.id != null && !engine.hasRedCard(card.player.id)) revokeRed(card.player.id)
  }
  // A reset discards the match, red cards included → lift the suspensions they filed.
  const resetBoard = () => {
    const reds = new Set(engine.cardLog.filter(c => c.type === CardType.red && c.player?.id != null).map(c => c.player.id))
    engine.resetGame()
    setYellows([])
    for (const pid of reds) revokeRed(pid)
  }
  const handleReset = () => {
    if (resetArmed) { setResetArmed(false); resetBoard() }
    else { setResetArmed(true); setTimeout(() => setResetArmed(false), 1200) }
  }
  const updateSettings = (patch) => { Object.assign(engine.settings, patch); engine._changed() }

  const doSave = async () => {
    setSaving(true); setSaveErr(null)
    try {
      const map = new Map(engine.boxScore().map(r => [r.player_id, { clean_sheet: false, ...r }]))
      const gks = [...fullHomeRoster.map(p => [p, awayScore]), ...fullGuestRoster.map(p => [p, homeScore])]
      for (const [p, conceded] of gks) {
        if (p.position !== "Goalkeeper" || !p.id) continue
        const cs = conceded === 0
        if (!map.has(p.id) && !cs) continue
        const r = map.get(p.id) || { player_id: p.id, goals: 0, blue_cards: 0, red_cards: 0, clean_sheet: false }
        r.clean_sheet = cs
        map.set(p.id, r)
      }
      // Who played: the server adds every "מגיע" sign-up to the box score
      // (supabase/judge-save-full-lineup.sql). The board adds what only it knows — a
      // borrowed player played (0-goal row), a squad player the judge hid or who is
      // blocked did not ({ absent: true }). Before 10/25 only scorers and carded players
      // were saved, and everyone else was missing from the game page and his game log.
      for (const [side, l] of [[TeamSide.home, lineup.home], [TeamSide.guest, lineup.guest]]) {
        for (const id of l?.added || []) {
          if (!map.has(id)) map.set(id, { player_id: id, goals: 0, blue_cards: 0, red_cards: 0, clean_sheet: false })
        }
        const out = new Set([...(l?.hidden || []), ...squadFor(side).filter(p => blockedOn(side, p.id)).map(p => p.id)])
        for (const id of out) if (id && !map.has(id)) map.set(id, { player_id: id, absent: true })
      }
      // A player borrowed in the lineup editor is on neither roster: tell the server which
      // side he played for, so his goals land there (game_stats.played_for_team_id).
      for (const r of map.values()) {
        if (lineup.home?.added?.includes(r.player_id)) r.played_for_team_id = game.home_team_id
        else if (lineup.guest?.added?.includes(r.player_id)) r.played_for_team_id = game.away_team_id
      }
      // The match report travels WITH the save (same transaction): the full, uncapped
      // play-by-play, the engine snapshot and the half length → game_reports. The final
      // broadcast below just refreshes spectators; it is best-effort and capped at 3s so
      // a bad connection can't hold the save hostage.
      const report = { events: buildLiveEvents(engine, { max: Infinity }), snapshot: engine.serialize(), periodMS: engine.settings.periodMS, ownGoals: engine.ownGoals() }
      await Promise.race([broadcastGameState(engine, game.id), new Promise(r => setTimeout(r, 3000))])
      await saveGameResultReliably(game.id, homeScore, awayScore, [...map.values()], report)
      clearEngineDraft(game.id)
      setSaved(true)
    } catch (e) {
      // The local draft is NOT cleared — a reload keeps the whole match for another try.
      setSaveErr(e?.message === "game already completed" ? "המשחק כבר הסתיים"
        : "השמירה נכשלה — בדוק את החיבור ונסה שוב. המשחק נשמר במכשיר ולא יאבד.")
    } finally { setSaving(false) }
  }

  const over = engine.phase === Phase.over
  const editing = engine.phase === Phase.editing
  const inBreak = engine.phase === Phase.breakTime
  const inTimeout = inBreak && (engine.breakKind === BreakKind.homeTimeout || engine.breakKind === BreakKind.guestTimeout)
  const showTenths = engine.clock.showTenths
  const pristine = engine.isPristine() && yellows.length === 0
  const title = boardTitle(engine, Phase)
  const titleHot = inBreak || over || editing
  const clockColor = engine.phase === Phase.running ? (T.led ? JL.ledClock : "#fff") : over ? JL.faint : JL.accent
  const clockGlow = T.led && engine.phase === Phase.running
  const clockText = clockString(engine.clock.remainingMS, showTenths)
  // Shrink the clock to fit the centre column ("00:59.3" in a timeout is 7 glyphs, not 5).
  const clockSize = Math.max(112 * k * 0.4, Math.min(112 * k, (boardW - 476 * k) / (clockText.length * 0.62)))
  const glowA = glowOf(guest), glowH = glowOf(home)

  if (saved) {
    return (
      <div className="fixed inset-0 z-50 !m-0 flex flex-col items-center justify-center gap-3 text-center p-8" style={{ background: JL.page, color: "#fff" }} dir="rtl">
        <div className="w-16 h-16 rounded-full flex items-center justify-center fl-pop" style={{ background: JL.okBg }}>
          <Check className="w-8 h-8" style={{ color: JL.okFg }} aria-hidden="true" />
        </div>
        <h3 className="text-2xl font-extrabold">התוצאה נשמרה ופורסמה</h3>
        <div className="flex items-center gap-3 text-lg font-bold">
          <span>{home?.name || engine.home.name}</span>
          <span dir="rtl" className="fl-num text-3xl inline-flex gap-2"><span>{homeScore}</span><span className="opacity-60">:</span><span>{awayScore}</span></span>
          <span>{guest?.name || engine.guest.name}</span>
        </div>
        <p className="text-sm" style={{ color: JL.sub }}>הטבלה עודכנה.</p>
        <div className="flex gap-2 mt-2">
          <Link to="/judge" className="min-h-[44px] inline-flex items-center px-5 rounded-control text-sm font-extrabold" style={{ background: JL.accent, color: JL.onAccent }}>חזרה לרשימה</Link>
          <Link to={`/games/${game.id}`} className="min-h-[44px] inline-flex items-center px-5 rounded-control text-sm font-bold border" style={{ borderColor: JL.line, color: "#fff" }}>לדף המשחק</Link>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapRef} dir="ltr"
      className="fixed inset-0 z-50 !m-0 overflow-hidden"
      style={{
        background: JL.page, color: "#fff",
        paddingTop: "max(8px, env(safe-area-inset-top))", paddingBottom: "max(4px, env(safe-area-inset-bottom))",
        paddingLeft: "max(8px, env(safe-area-inset-left))", paddingRight: "max(8px, env(safe-area-inset-right))",
      }}>
      {/* backdrop: each team's soft glow from its own edge (away left, home right) + a faint rink */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {glowA && <div className="absolute inset-0" style={{ background: `radial-gradient(420px 420px at 0% 40%, ${glowA}59, transparent 70%)` }} />}
        {glowH && <div className="absolute inset-0" style={{ background: `radial-gradient(420px 420px at 100% 40%, ${glowH}59, transparent 70%)` }} />}
        <RinkDrawing strength={0.1} className="absolute inset-y-[6px] inset-x-10 w-[calc(100%-80px)] h-[calc(100%-12px)] opacity-[.1]" />
      </div>
      {/* the board's edge flashes with every buzzer */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 transition-opacity duration-200 z-20" style={{ boxShadow: `inset 0 0 0 6px ${JL.accent}`, opacity: buzzFlash ? 1 : 0 }} />

      {/* close (top-left corner, kept clear by the away header) */}
      <button type="button" onClick={closeBoard} aria-label="סגירת הלוח" title="סגירת הלוח"
        className="absolute z-10 flex items-center justify-center rounded-xl"
        style={{ top: "max(10px, env(safe-area-inset-top))", left: "max(10px, env(safe-area-inset-left))", width: 44, height: 44, background: JL.panel, color: JL.muted }}>
        <X className="w-5 h-5" aria-hidden="true" />
      </button>

      <div className="relative h-full flex items-start">
        <TeamColumn side={TeamSide.guest} engine={engine} T={T} team={guest} k={k} v={v} reserveCorner setPicker={openPicker} undoCard={undoCard} />

        {/* centre: period · clock · mode area · control bar */}
        <div className="relative flex-1 min-w-0 h-full flex flex-col items-center" style={{ padding: `0 ${6 * k}px`, gap: 4 * v }}>
          <div dir="rtl" className="flex items-center justify-center min-w-0 max-w-full" style={{ height: 46 * v, gap: 10 * k }}>
            <span className="font-extrabold truncate" style={{ fontSize: (title.length > 16 ? 19 : 27) * k, color: titleHot ? JL.accent : JL.soft }}>{title}</span>
            {engine.settings.format === GameFormat.threeThirds && (
              <span className="flex items-center gap-1 rounded-lg px-2 py-0.5 font-bold shrink-0" style={{ background: "#141B25", fontSize: 13 * k }}>
                <span style={{ color: JL.sub }}>שלישים</span>
                <span dir="rtl" className="fl-num inline-flex gap-1 text-white"><span>{engine.home.thirds}</span><span>:</span><span>{engine.guest.thirds}</span></span>
              </span>
            )}
            {game && !editing && !over && !pristine && (
              <span className="flex items-center gap-1.5 shrink-0 font-bold" style={{ fontSize: 12 * k, color: "#FF6B60" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: JL.red }} aria-hidden="true" /> בשידור
              </span>
            )}
          </div>

          {/* CLOCK — tap to start/pause (or skip a break) */}
          <button type="button" onClick={() => (inBreak ? engine.skipBreak() : engine.toggleClock())}
            className="w-full flex items-center justify-center fl-num leading-none select-none rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F2B233]"
            style={{ ...TOUCH, height: 124 * v, fontSize: clockSize, color: showTenths ? JL.foul : clockColor,
              textShadow: clockGlow ? `0 0 18px ${JL.ledClock}, 0 0 36px ${JL.ledClock}80` : "none" }}
            aria-label={`שעון ${clockText}`}>
            <span dir="ltr">{clockText}</span>
          </button>

          {/* mode area */}
          <div className="w-full flex flex-col items-center" style={{ gap: 6 * v }}>
            {abandoning ? (
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: JL.accent }} aria-label="מחזיר…" />
            ) : editing ? (
              <TimeStepper engine={engine} k={k} />
            ) : inTimeout ? (
              <>
                {/* A timeout is ended early all the time (the team is ready) → a big, obvious button */}
                <button type="button" onClick={() => engine.skipBreak()} className="flex items-center gap-2 font-extrabold rounded-full"
                  style={{ ...TOUCH, background: JL.accent, color: JL.onAccent, fontSize: 17 * k, height: Math.max(44, 50 * v), padding: `0 ${26 * k}px` }}>
                  {HE.endTimeout}
                </button>
                <span dir="rtl" className="font-semibold truncate max-w-full" style={{ fontSize: 13 * k, color: JL.sub }}>
                  שעון המשחק עצר ב־<span dir="ltr" className="fl-num" style={{ fontSize: 15 * k }}>{clockString(engine._preBreakRemainingMS ?? 0)}</span> וחוזר לשם
                </span>
              </>
            ) : inBreak ? (
              <>
                <span dir="rtl" className="font-bold truncate max-w-full" style={{ fontSize: 15 * k, color: JL.sub }}>{nextPeriodNote(engine)}</span>
                <button type="button" onClick={() => engine.skipBreak()} className="flex items-center gap-1.5 font-bold rounded-full border-[1.5px]"
                  style={{ ...TOUCH, color: JL.accent, borderColor: JL.accent, fontSize: 14 * k, height: Math.max(44, 44 * v), padding: `0 ${20 * k}px` }}>
                  <SkipForward className="w-[1.1em] h-[1.1em] -scale-x-100" aria-hidden="true" /> {HE.skipBreak}
                </button>
              </>
            ) : over ? (
              game && (
                saving ? <Loader2 className="w-7 h-7 animate-spin" style={{ color: JL.accent }} aria-label="שומר…" />
                  : <>
                    {saveErr && <span dir="rtl" className="text-center font-bold rounded-xl px-3.5 py-1.5" style={{ background: JL.errorBg, color: JL.errorFg, fontSize: 13.5 * k }}>{saveErr}</span>}
                    <button type="button" onClick={doSave} dir="rtl" className="flex items-center gap-2 font-extrabold rounded-full"
                      style={{ ...TOUCH, background: JL.accent, color: JL.onAccent, fontSize: 17 * k, height: Math.max(44, (saveErr ? 44 : 52) * v), padding: `0 ${26 * k}px` }}>
                      <ArrowDownToLine style={{ width: 18 * k, height: 18 * k }} strokeWidth={2.6} aria-hidden="true" /> {saveErr ? "נסה שוב" : HE.saveResult}
                    </button>
                    {!saveErr && <span dir="rtl" className="font-semibold truncate max-w-full" style={{ fontSize: 12 * k, color: JL.muted }}>עוד אפשר לתקן: לחיצה ארוכה על תוצאה או עבירה מבטלת</span>}
                  </>
              )
            ) : (
              <>
                <div dir="rtl" className="flex items-center justify-center font-bold truncate max-w-full" style={{ height: 20 * v, fontSize: 14 * k }}>
                  {(engine.phase === Phase.ready || engine.phase === Phase.readyOvertime) && (
                    <span style={{ color: JL.sub }}>{engine.phase === Phase.readyOvertime ? "תיקו · הקש על השעון להתחלת ההארכה" : HE.tapToStart}</span>
                  )}
                  {engine.phase === Phase.paused && <span style={{ color: JL.foul }}>{HE.paused} · הקש על השעון להמשך</span>}
                </div>
                <div className="w-full flex items-start" style={{ gap: 6 * k }}>
                  <div className="flex-1 min-w-0"><CardStack side={TeamSide.guest} engine={engine} k={k} v={v} onRemove={removeCard} /></div>
                  <div className="shrink-0" style={{ width: 76 * k }}><PassivePill engine={engine} k={k} v={v} /></div>
                  <div className="flex-1 min-w-0"><CardStack side={TeamSide.home} engine={engine} k={k} v={v} onRemove={removeCard} /></div>
                </div>
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* action toast */}
          {toast && (
            <div dir="rtl" role="status" className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-4 whitespace-nowrap pointer-events-none fl-fade-in z-10"
              style={{ bottom: Math.max(44, 44 * v) + 10, height: 40 * v, background: "#F4F2EC", boxShadow: "0 8px 24px rgba(0,0,0,.45)", fontSize: 13.5 * k }}>
              <span className="font-bold" style={{ color: "#0B0F14" }}>{toast}</span>
              <span className="font-semibold" style={{ color: "#5B616B" }}>· לחיצה ארוכה מבטלת</span>
            </div>
          )}

          {/* control bar */}
          <div className="flex items-center justify-center" style={{ gap: 6 * k, paddingBottom: 2 }}>
            <ControlBtn icon={resetArmed ? AlertTriangle : RotateCcw} on={resetArmed} k={k} v={v} label={resetArmed ? "לחיצה נוספת מאפסת" : "איפוס"} onClick={handleReset} />
            <ControlBtn icon={editing ? Check : Pencil} on={editing} k={k} v={v} label={editing ? "סיום עריכה" : "עריכת זמן"} onClick={() => (editing ? engine.endEditing() : engine.beginEditing())} />
            <ControlBtn icon={Megaphone} on={buzzFlash} k={k} v={v} label="צופר" onClick={() => engine.buzz()} />
            <ControlBtn k={k} v={v} label="הרכב למשחק" onClick={() => setLineupSide(TeamSide.home)}>
              <Users style={{ width: 22 * k, height: 22 * k }} aria-hidden="true" />
            </ControlBtn>
            <ControlBtn icon={SettingsIcon} k={k} v={v} label={HE.settings} onClick={() => setShowSettings(true)} />
            <ControlBtn icon={Flag} k={k} v={v} label={HE.endGame} disabled={!engine.canEndNow()} onClick={() => { setSaveErr(null); setConfirmEnd(true) }} />
          </div>
        </div>

        <TeamColumn side={TeamSide.home} engine={engine} T={T} team={home} k={k} v={v} reserveCorner={false} setPicker={openPicker} undoCard={undoCard} />
      </div>

      {/* portrait phone: the board is landscape-only */}
      {portrait && (
        <div dir="rtl" className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 p-8 text-center" style={{ background: JL.page }}>
          <Smartphone className="w-14 h-14 rotate-90 motion-safe:transition-transform" style={{ color: JL.accent }} aria-hidden="true" />
          <h2 className="text-2xl font-extrabold">סובבו את הטלפון</h2>
          <p className="text-sm max-w-xs" style={{ color: JL.sub }}>לוח השיפוט עובד לרוחב בלבד — כך הוא גם נראה בטלוויזיה ליד המגרש.</p>
          <button type="button" onClick={toggleFs} className="min-h-[44px] px-5 rounded-control font-extrabold" style={{ background: JL.accent, color: JL.onAccent }}>מסך מלא לרוחב</button>
          <button type="button" onClick={closeBoard} className="min-h-[44px] px-5 rounded-control font-bold border" style={{ borderColor: JL.line, color: "#fff" }}>חזרה לרשימה</button>
        </div>
      )}

      {/* player picker (goal / card) */}
      {picker && (
        <PickerSheet picker={picker} setPicker={setPicker} engine={engine} T={T} team={picker.side === TeamSide.home ? home : guest}
          roster={rosterFor(picker.side)} elig={elig} blockedOn={blockedOn} canOverride={canOverride} allowPlayer={allowPlayer}
          playersById={playersById} squadFor={squadFor} resolvePick={resolvePick} resolveOwnGoal={resolveOwnGoal}
          openLineup={() => setLineupSide(picker.side)} useAttending={useAttending} sideHasAttendees={sideHasAttendees}
          attendingIds={attendingIds} showAllRoster={showAllRoster} setShowAllRoster={setShowAllRoster} />
      )}

      {/* confirm "end game now" */}
      {confirmEnd && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setConfirmEnd(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="end-game-title"
            className="w-full max-w-md rounded-[22px] border p-5 flex flex-col items-center gap-3 text-center fl-pop"
            style={{ background: JL.sheet, borderColor: JL.line }} onClick={e => e.stopPropagation()}>
            <h4 id="end-game-title" className="font-extrabold text-xl text-white">{HE.endGameTitle}</h4>
            <div className="flex items-center gap-3">
              {home && <TeamLogo team={home} px={40} />}
              <span dir="rtl" className="fl-num text-4xl inline-flex gap-2 text-white"><span>{engine.homeFinalScore}</span><span className="opacity-60">:</span><span>{engine.guestFinalScore}</span></span>
              {guest && <TeamLogo team={guest} px={40} />}
            </div>
            <p className="text-sm leading-relaxed" style={{ color: JL.sub }}>{HE.endGameBody}</p>
            <div className="flex gap-2 pt-1 w-full">
              <button autoFocus type="button" onClick={() => { engine.endGameNow(); setConfirmEnd(false) }}
                className="flex-1 min-h-[48px] rounded-control text-sm font-extrabold" style={{ background: "#F4F2EC", color: "#0B0F14" }}>{HE.endGameYes}</button>
              <button type="button" onClick={() => setConfirmEnd(false)}
                className="flex-1 min-h-[48px] rounded-control text-sm font-bold border" style={{ borderColor: JL.line, color: "#fff" }}>{HE.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {/* return to "not started" — opened from settings */}
      {confirmAbandon && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setConfirmAbandon(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="abandon-title"
            className="w-full max-w-md rounded-[22px] border p-5 flex flex-col gap-3 text-right fl-pop"
            style={{ background: JL.sheet, borderColor: JL.line }} onClick={e => e.stopPropagation()}>
            <h4 id="abandon-title" className="font-extrabold text-lg text-white">{HE.abandonConfirm}</h4>
            <p className="text-sm" style={{ color: JL.sub }}>השידור נעצר, הלוח במכשיר נמחק והמשחק חוזר לרשימת המשחקים כמתוכנן.</p>
            {saveErr && <span className="text-sm font-bold" style={{ color: JL.errorFg }}>{saveErr}</span>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={doAbandon} disabled={abandoning}
                className="flex-1 min-h-[48px] rounded-control text-sm font-extrabold disabled:opacity-60" style={{ background: JL.accent, color: JL.onAccent }}>{abandoning ? "…" : HE.abandonYes}</button>
              <button type="button" onClick={() => setConfirmAbandon(false)}
                className="flex-1 min-h-[48px] rounded-control text-sm font-bold border" style={{ borderColor: JL.line, color: "#fff" }}>{HE.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {lineupSide != null && (
        <LineupEditor T={T} side={lineupSide} setSide={setLineupSide} teams={{ [TeamSide.home]: home, [TeamSide.guest]: guest }} allTeams={teams}
          squadFor={squadFor} players={players} lineup={lineup} setLineup={setLineup} sideKey={sideKey}
          elig={elig} canOverride={canOverride}
          onClose={() => setLineupSide(null)} />
      )}

      {showSettings && (
        <SettingsSheet engine={engine} themeKind={themeKind} setThemeKind={setThemeKind} isFs={isFs} toggleFs={toggleFs}
          updateSettings={updateSettings} onReset={resetBoard} onClose={() => setShowSettings(false)}
          onAbandon={game ? () => { setShowSettings(false); setSaveErr(null); setConfirmAbandon(true) } : null}
          onLineup={() => { setShowSettings(false); setLineupSide(TeamSide.home) }} />
      )}
    </div>
  )
}

/* ---------- scorer / card picker (boards JudgeScorer + JudgeCard) ---------- */
function PickerSheet({ picker, setPicker, engine, T, team, roster, elig, blockedOn, canOverride, allowPlayer, playersById, squadFor,
  resolvePick, resolveOwnGoal, openLineup, useAttending, sideHasAttendees, attendingIds, showAllRoster, setShowAllRoster }) {
  const isGoal = picker.kind === "goal"
  const cardKind = isGoal ? null : picker.kind
  const teamName = engine._side(picker.side).name || team?.name || ""
  const lightTeam = !cardKind && team && nameTint(team) === "#E6E6E6" && glowOf(team) === "#A3A3A3"
  const clockNow = clockString(typeof engine._eventTimeMS === "function" ? engine._eventTimeMS() : engine.clock.remainingMS)
  const when = `${periodName(engine.currentHalf, engine.settings.format)} · ${clockNow} · דקה ${eventMinute(engine)}`
  const panelTitle = isGoal ? `שער ל${teamName}` : cardKind === "yellow" ? "כרטיס צהוב" : cardKind === "red" ? "כרטיס אדום" : "כחול · 2:00 בחוץ"
  const panelSub = isGoal ? when
    : cardKind === "yellow" ? `${teamName} · אזהרה. נרשם בלוח בלבד, בלי שעון ובלי שום דבר על המסך.`
      : cardKind === "red" ? `${teamName} · נרשם בטופס. השחקן נחסם אוטומטית למשחק הבא. שום דבר לא מוצג על הלוח.`
        : `${teamName} · השעון של השחקן יופיע מתחת לשעון המשחק בצד של הקבוצה, ירוץ רק כשהמשחק רץ.`
  const close = () => setPicker(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setPicker(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPicker])

  return (
    <div className="fixed inset-0 z-[60] flex" dir="rtl" role="dialog" aria-modal="true" aria-label={isGoal ? "מי כבש?" : "מי קיבל?"}
      style={{ background: JL.page, paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))" }}>
      {/* side column: card type switch + panel + cancel */}
      <div className="flex flex-col gap-2 shrink-0 w-[30%] min-w-[210px] max-w-[340px]">
        {!isGoal && (
          <div className="flex gap-1.5" role="radiogroup" aria-label="סוג כרטיס">
            {[["yellow", "צהוב", JL.yellow], ["blue", "כחול", JL.blue], ["red", "אדום", JL.red]].map(([kd, label, c]) => {
              const on = cardKind === kd
              return (
                <button key={kd} type="button" role="radio" aria-checked={on} onClick={() => setPicker({ ...picker, kind: kd })}
                  className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-[10px] text-xs font-bold"
                  style={{ color: on ? "#fff" : JL.muted, background: on ? JL.raised : "transparent", border: `${on ? 1.5 : 1}px solid ${on ? c : JL.line}` }}>
                  <CardChip color={c} w={10} /> {label}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex-1 min-h-0 rounded-[18px] p-3.5 flex flex-col" style={{ background: panelFill(team, cardKind), color: lightTeam ? "#11161D" : "#fff" }}>
          <div className="flex items-start justify-between">
            {team && <TeamLogo team={team} px={46} />}
            {isGoal && <GoalIcon className="w-8 h-8" />}
          </div>
          <div className="flex-1" />
          <div className="text-[19px] sm:text-[22px] font-extrabold leading-tight">{panelTitle}</div>
          <div className="text-xs leading-snug opacity-85 mt-1">{panelSub}</div>
          {isGoal && (
            <>
              <div className="flex items-center gap-1 text-xs font-bold mt-1 min-w-0">
                <span className="truncate">{engine.home.name}</span>
                <span className="fl-num">{engine.homeFinalScore + (picker.side === TeamSide.home ? 1 : 0)}</span>
                <span>·</span>
                <span className="fl-num">{engine.guestFinalScore + (picker.side === TeamSide.guest ? 1 : 0)}</span>
                <span className="truncate">{engine.guest.name}</span>
              </div>
              <div className="text-xs opacity-80">{engine.isRunning ? "השעון ממשיך לרוץ" : "השעון עצור"}</div>
            </>
          )}
        </div>
        <button type="button" onClick={close} className="min-h-[48px] rounded-[14px] text-sm font-bold border"
          style={{ borderColor: isGoal ? "#5A2A2A" : JL.line, color: isGoal ? JL.errorFg : "#fff" }}>{isGoal ? "ביטול השער" : HE.cancel}</button>
      </div>

      {/* players */}
      <div className="flex-1 min-w-0 flex flex-col pr-3">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h4 className="text-2xl sm:text-3xl font-extrabold text-white">{isGoal ? "מי כבש?" : "מי קיבל?"}</h4>
          <span className="text-xs truncate" style={{ color: JL.muted }}>
            {useAttending && sideHasAttendees(picker.side) ? "רק מי שאישר הגעה" : "כל הסגל"}
          </span>
        </div>
        {elig === null && <div className="mb-2"><EligibilityWarning T={T} /></div>}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain -mx-1 px-1">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {roster.map(p => {
              const reasons = ineligibleReasons(elig, p.id)
              const blocked = blockedOn(picker.side, p.id)
              const ejected = engine.isEjected(p.id)
              const borrowed = p.id && playersById.get(p.id) && !squadFor(picker.side).some(s => s.id === p.id)
              return (
                <div key={p.id || p._key} role="button" tabIndex={blocked ? -1 : 0} aria-disabled={blocked || undefined}
                  onClick={() => resolvePick(p)} onKeyDown={e => { if (!blocked && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); resolvePick(p) } }}
                  className={`min-h-[64px] rounded-[14px] border px-3 py-2 flex flex-col items-center justify-center text-center gap-0.5 transition-colors ${blocked ? "cursor-not-allowed" : "cursor-pointer hover:bg-white/5"} ${ejected ? "opacity-40" : ""}`}
                  style={{ background: JL.panel, borderColor: JL.lineSoft }}>
                  <span className={`font-extrabold text-[15px] leading-tight truncate max-w-full ${blocked ? "text-white/40" : "text-white"}`}>{p.first_name} {p.last_name}</span>
                  <span className="flex items-center gap-1.5 flex-wrap justify-center">
                    <span className="fl-num text-sm" style={{ color: JL.muted }}>{p.jersey_number != null ? `#${p.jersey_number}` : "–"}</span>
                    {p.position === "Goalkeeper" && <span className="text-[10px] font-bold" style={{ color: "#9CC2FF" }}>שוער</span>}
                    {p._guest && <span className="text-[10px] font-bold text-white/50">אורח</span>}
                    {borrowed && <span className="text-[10px] font-bold text-white/50">מושאל</span>}
                    {ejected && <span className="text-[10px] font-bold" style={{ color: JL.red }}>הורחק</span>}
                  </span>
                  {(reasons?.length > 0) && <EligibilityChips reasons={reasons} T={T} overridden={!blocked} />}
                  {blocked && canOverride && <OverrideButton T={T} name={p.first_name} onConfirm={() => allowPlayer(picker.side, p.id)} />}
                </div>
              )
            })}
          </div>
          {useAttending && !sideHasAttendees(picker.side) && (
            <p className="mt-2 text-[11px] text-center" style={{ color: JL.muted }}>אף שחקן בקבוצה לא אישר הגעה — מוצג כל הסגל</p>
          )}
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button type="button" onClick={() => resolvePick(null)} className="flex-1 min-w-[120px] min-h-[48px] rounded-[14px] text-sm font-bold text-white" style={{ background: JL.raised }}>
            {isGoal ? HE.later : HE.noPlayer}
          </button>
          {isGoal && (
            <button type="button" onClick={resolveOwnGoal} title={HE.ownGoalHint} className="flex-1 min-w-[120px] min-h-[48px] rounded-[14px] text-sm font-bold text-white border border-dashed flex flex-col items-center justify-center leading-tight" style={{ borderColor: JL.line }}>
              <span>{HE.ownGoal}</span><span className="text-[10px] font-medium" style={{ color: JL.muted }}>{HE.ownGoalHint}</span>
            </button>
          )}
          <button type="button" onClick={openLineup} className="flex-1 min-w-[120px] min-h-[48px] rounded-[14px] text-sm font-bold border border-dashed flex items-center justify-center gap-1.5" style={{ borderColor: JL.line, color: JL.accent }}>
            <Users className="w-4 h-4" /> שחקן אורח · הרכב
          </button>
          {attendingIds && attendingIds.size > 0 && (
            <button type="button" onClick={() => setShowAllRoster(v => !v)} className="min-h-[48px] px-3 rounded-[14px] text-xs font-semibold" style={{ color: JL.sub }}>
              {showAllRoster ? "רק מי שאישר הגעה" : "כל הסגל"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- edit-mode time stepper (minutes / seconds) ---------- */
function TimeStepper({ engine, k }) {
  const total = engine.settings.periodMS
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor(total / 1000) % 60
  const set = (m, s) => engine.setPeriodLength(Math.max(0, Math.min(99, m)) * 60000 + ((s + 60) % 60) * 1000)
  const Round = ({ glyph: G, label, onClick }) => (
    <button type="button" onClick={onClick} aria-label={label} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: JL.raised, color: JL.accent }}>
      <G className="w-5 h-5" strokeWidth={3} aria-hidden="true" />
    </button>
  )
  const Field = ({ label, value, onDec, onInc }) => (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-bold" style={{ fontSize: 11 * k, color: JL.muted }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <Round glyph={Plus} label={`הוספת ${label}`} onClick={onInc} />
        <span className="fl-num text-center" style={{ fontSize: 24 * k, minWidth: 34 * k }}>{String(value).padStart(2, "0")}</span>
        <Round glyph={Minus} label={`הפחתת ${label}`} onClick={onDec} />
      </div>
    </div>
  )
  return (
    <div dir="rtl" className="flex items-center gap-3.5">
      <Field label={HE.minutes} value={minutes} onDec={() => set(minutes - 1, seconds)} onInc={() => set(minutes + 1, seconds)} />
      <Field label={HE.seconds} value={seconds} onDec={() => set(minutes, seconds - 1)} onInc={() => set(minutes, seconds + 1)} />
    </div>
  )
}

/* ---------- settings sheet (board JudgeSettings; mirrors the iOS SettingsSheet essentials) ---------- */
function SettingsSheet({ engine, themeKind, setThemeKind, isFs, toggleFs, updateSettings, onReset, onClose, onAbandon, onLineup }) {
  const s = engine.settings
  const mins = Math.max(1, Math.round(s.periodMS / 60000))
  const otMins = Math.max(1, Math.round((s.overtimePeriodMS ?? GameRules.defaultOvertimePeriodMS) / 60000))
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const Row = ({ label, children }) => (
    <div className="flex items-center justify-between gap-3 min-h-[52px] border-b" style={{ borderColor: JL.lineSoft }}>
      <span className="text-sm font-semibold text-white">{label}</span>
      {children}
    </div>
  )
  const Step = ({ value, suffix, onDec, onInc, label }) => (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onDec} aria-label={`הפחתת ${label}`} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: JL.raised, color: JL.accent }}><Minus className="w-4 h-4" strokeWidth={3} /></button>
      <span className="text-sm font-bold min-w-[4rem] text-center text-white"><span className="fl-num">{value}</span> {suffix}</span>
      <button type="button" onClick={onInc} aria-label={`הוספת ${label}`} className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: JL.raised, color: JL.accent }}><Plus className="w-4 h-4" strokeWidth={3} /></button>
    </div>
  )
  const Toggle = ({ on, onToggle, label }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} className="w-[52px] h-11 flex items-center justify-center">
      <span className="w-12 h-7 rounded-full relative transition-colors" style={{ background: on ? JL.accent : "rgba(255,255,255,0.2)" }}>
        <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all" style={{ left: on ? "1.375rem" : "0.125rem" }} />
      </span>
    </button>
  )
  const Seg = ({ value, options, onChange, label }) => (
    <div className="flex rounded-xl p-0.5" style={{ background: JL.raised }} role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className="min-h-[40px] px-3 rounded-[10px] text-xs font-bold" style={value === v ? { background: JL.accent, color: JL.onAccent } : { color: JL.sub }}>{l}</button>
      ))}
    </div>
  )
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3" dir="rtl" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="judge-settings-title" className="w-full max-w-2xl max-h-full rounded-[22px] overflow-hidden flex flex-col border fl-pop" style={{ background: JL.sheet, borderColor: JL.line }} onClick={e => e.stopPropagation()}>
        <div className="px-4 py-2.5 flex items-center justify-between border-b shrink-0" style={{ borderColor: JL.lineSoft }}>
          <h4 id="judge-settings-title" className="font-extrabold text-lg text-white">{HE.settings}</h4>
          <button type="button" onClick={onClose} className="min-h-[44px] px-4 rounded-xl text-sm font-extrabold" style={{ background: JL.accent, color: JL.onAccent }}>{HE.done}</button>
        </div>
        <div className="px-4 pb-3 overflow-y-auto overscroll-contain grid md:grid-cols-2 md:gap-x-6">
          <div>
            <Row label={HE.format}><Seg label={HE.format} value={s.format} onChange={(v) => updateSettings({ format: v })} options={[[GameFormat.twoHalves, HE.formatHalves], [GameFormat.threeThirds, HE.formatThirds]]} /></Row>
            <Row label={HE.periodLength}><Step label={HE.periodLength} value={mins} suffix={HE.minutes} onDec={() => engine.setPeriodLength((mins - 1) * 60000)} onInc={() => engine.setPeriodLength((mins + 1) * 60000)} /></Row>
            <Row label={HE.breakLength}><Step label={HE.breakLength} value={s.halfBreakMinutes} suffix={HE.minutes} onDec={() => updateSettings({ halfBreakMinutes: Math.max(1, s.halfBreakMinutes - 1) })} onInc={() => updateSettings({ halfBreakMinutes: Math.min(5, s.halfBreakMinutes + 1) })} /></Row>
            <Row label={HE.overtime}><Toggle label={HE.overtime} on={s.overtimeEnabled} onToggle={() => updateSettings({ overtimeEnabled: !s.overtimeEnabled })} /></Row>
            {s.overtimeEnabled && (
              <Row label={HE.overtimeLength}><Step label={HE.overtimeLength} value={otMins} suffix={HE.minutes} onDec={() => engine.setOvertimeLength(Math.max(1, otMins - 1) * 60000)} onInc={() => engine.setOvertimeLength(Math.min(25, otMins + 1) * 60000)} /></Row>
            )}
          </div>
          <div>
            <Row label={HE.passivePlay}><Toggle label={HE.passivePlay} on={s.passivePlayEnabled} onToggle={() => updateSettings({ passivePlayEnabled: !s.passivePlayEnabled })} /></Row>
            <Row label={HE.theme}><Seg label={HE.theme} value={themeKind} onChange={setThemeKind} options={[["led", HE.themeLed], ["modern", HE.themeModern]]} /></Row>
            <Row label={HE.fullscreen}>
              <button type="button" onClick={toggleFs} aria-label={HE.fullscreen} className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: JL.raised, color: JL.sub }}>
                {isFs ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </Row>
            <Row label="הרכב למשחק">
              <button type="button" onClick={onLineup} className="min-h-[44px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: JL.raised, color: "#fff" }}><Users className="w-4 h-4" /> ניהול סגל</button>
            </Row>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-2 pt-3">
            <button type="button" onClick={() => { onReset(); onClose() }} className="flex-1 min-w-[160px] min-h-[48px] rounded-[14px] text-sm font-bold flex items-center justify-center gap-1.5" style={{ background: "rgba(224,54,44,0.15)", color: JL.errorFg }}>
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> {HE.resetGame}
            </button>
            {onAbandon && (
              <button type="button" onClick={onAbandon} className="flex-1 min-w-[160px] min-h-[48px] rounded-[14px] text-sm font-bold flex items-center justify-center gap-1.5 border" style={{ borderColor: JL.line, color: JL.sub }}>
                <Undo2 className="w-4 h-4" aria-hidden="true" /> {HE.abandon}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
