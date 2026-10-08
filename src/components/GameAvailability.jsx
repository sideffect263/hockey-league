import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getMyAvailability, setMyAvailability, getGameAvailability, getPublicAttendance, nudgeNonResponders } from "@/lib/availability"
import { getApprovedMedicalPlayerIds } from "@/lib/medical"
import { getActiveSuspension, getActiveSuspensionsFor, removePlayerFromSquad } from "@/lib/squad"
import {
  UNAVAILABILITY_KINDS, kindLabel, gameDayOf, todayISO, activeOn, absenceRange, absenceText,
  getUnavailabilityFor, reportUnavailability, decideUnavailability, clearUnavailability,
} from "@/lib/unavailability"
import AddSquadPlayer from "@/components/AddSquadPlayer"
import { Check, X, Loader2, CalendarCheck, CalendarX, AlertTriangle, Ban, UserMinus, Share2, Link2, BellRing } from "lucide-react"

/**
 * Sheet row 11 — the coach posts the squad to WhatsApp. Plain text, because that is
 * what actually gets read: most players have no account (a reminder in the app reaches
 * a fraction of the roster), so WhatsApp is the channel that reaches everyone.
 * Numbered, goalkeepers marked, non-responders listed last so the coach can chase them.
 *
 * `blocked` is its own bucket, and it exists for a reason a player asked for out loud:
 * a red-carded or injured player cannot register at all, so he never answers — and he
 * used to sit silently in "טרם הגיבו", where the coach would chase him for an answer he
 * is not allowed to give. Listing him with his reason ends the chase, and keeps the
 * chase list honest.
 *
 * `noteOf` carries whatever else the line has to say — the block's reason, or that this
 * is a manually added loan rather than one of the team's own.
 */
export function buildSquadMessage({ game, teamName, opponentName, coming, notComing, noReply, blocked = [], nameOf, noteOf = () => "", link = "" }) {
  const when = game?.game_date
    ? new Date(game.game_date).toLocaleString("he-IL", {
        weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
    : ""
  const list = (arr) => arr.map((p, i) => {
    const note = noteOf(p)
    return `${i + 1}. ${nameOf(p)}${p.position === "Goalkeeper" ? " (שוער)" : ""}${note ? ` — ${note}` : ""}`
  }).join("\n")

  const parts = [
    `*סגל ${teamName}*${opponentName ? ` — נגד ${opponentName}` : ""}`,
    [when, game?.venue].filter(Boolean).join(" · "),
    "",
    `*מגיעים (${coming.length}):*`,
    coming.length ? list(coming) : "—",
  ]
  if (notComing.length) parts.push("", `*לא מגיעים (${notComing.length}):*`, list(notComing))
  if (blocked.length) parts.push("", `*חסומים לרישום (${blocked.length}):*`, list(blocked))
  // Last, so the chase list is the last thing on screen when the message is read.
  if (noReply.length) parts.push("", `*טרם הגיבו (${noReply.length}):*`, list(noReply))
  // The way to answer, right under the names being chased. Opens the app when installed.
  if (link) parts.push("", `לאישור הגעה: ${link}`)
  return parts.join("\n")
}

const MED_MSG = "כדי לאשר הגעה יש להעלות בדיקה רפואית ולקבל אישור בתוקף"
const SUSPENDED_MSG = "אינך יכול להירשם: הרחקה בעקבות כרטיס אדום"
const UNAVAILABLE_MSG = "אינך יכול/ה להירשם: דווחה היעדרות שאושרה במועד המשחק"
const MIN_PLAYERS = 4 // a team wants at least this many outfield + a goalkeeper

/**
 * Availability panel for an upcoming game (#3 / attendance epic).
 *  - A rostered player toggles מגיע / לא מגיע (signing up requires a valid medical, no
 *    red card, and no approved absence on the game's date), and can report an absence
 *    of his own for his coach to approve.
 *  - Officials (a coach of a team, or an admin) get the full per-team picture:
 *    מגיעים / לא מגיעים / חסומים / לא הגיבו + indicators (count, <4 warning, no-GK
 *    warning), and rule on their players' pending absence reports.
 *  - Any other signed-in viewer (a player, a fan) sees who's coming / not / hasn't
 *    answered on BOTH teams — status only, via game_attendance (no reasons, no notes).
 *  - nudgeTeamIds: teams this viewer may push a "you haven't answered" reminder to.
 * Team visibility is enforced by RLS; this renders only what the caller may read.
 */
export default function GameAvailability({ game, myPlayerId, officialTeamIds = [], playerTeamId = null, publicView = false, nudgeTeamIds = [], teamsMap = {}, playersMap = {} }) {
  const [myStatus, setMyStatus] = useState(null)
  const [rows, setRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [medOk, setMedOk] = useState(null)
  const [suspension, setSuspension] = useState(null)
  const [err, setErr] = useState(null)

  // Red-card blocks and absences for everyone whose squad this viewer can see.
  const [suspByPlayer, setSuspByPlayer] = useState({})
  const [absences, setAbsences] = useState([])
  const [blocksTick, setBlocksTick] = useState(0)
  const refreshBlocks = () => setBlocksTick(t => t + 1)

  // Self-report ("I can't make it — injury / abroad / reserve duty").
  const [reportOpen, setReportOpen] = useState(false)
  const [rKind, setRKind] = useState(UNAVAILABILITY_KINDS[0].value)
  const [rFrom, setRFrom] = useState(todayISO())
  const [rTo, setRTo] = useState("")
  const [rReason, setRReason] = useState("")
  const [rBusy, setRBusy] = useState(false)

  // The coach's decisions on his players' pending reports.
  const [deciding, setDeciding] = useState(null)
  const [decisionNotes, setDecisionNotes] = useState({})
  const [actionErr, setActionErr] = useState(null)
  const [copied, setCopied] = useState(false)
  // Status-only answers for both teams, for the squads this viewer is not an official of.
  const [publicRows, setPublicRows] = useState([])
  const [nudging, setNudging] = useState(null)
  const [nudgeMsg, setNudgeMsg] = useState({})

  const canSeeAny = officialTeamIds.length > 0 || !!playerTeamId || publicView
  // Every gate here is evaluated on the GAME's date, exactly like the server: an absence
  // that ends on Thursday does not block Saturday's fixture.
  const day = gameDayOf(game)

  // Re-read the squad after a manual add/remove without reloading the page.
  const refreshRows = () => {
    if (!canSeeAny) return
    getGameAvailability(game.id).then(setRows).catch(() => {})
    if (publicView) getPublicAttendance(game.id).then(setPublicRows).catch(() => {})
  }

  useEffect(() => {
    let alive = true
    Promise.all([
      myPlayerId ? getMyAvailability(game.id, myPlayerId) : Promise.resolve(null),
      canSeeAny ? getGameAvailability(game.id) : Promise.resolve([]),
      myPlayerId ? getApprovedMedicalPlayerIds([myPlayerId]) : Promise.resolve(new Set()),
      myPlayerId ? getActiveSuspension(myPlayerId) : Promise.resolve(null),
      publicView ? getPublicAttendance(game.id) : Promise.resolve([]),
    ]).then(([mine, all, med, susp, pub]) => {
      if (!alive) return
      setMyStatus(mine)
      setRows(all)
      setPublicRows(pub)
      setMedOk(myPlayerId ? med.has(myPlayerId) : null)
      setSuspension(susp)
      setLoading(false)
    }).catch(() => {
      // Without this the panel stays `loading` forever and silently disappears from the
      // game page on any transient fetch failure.
      if (!alive) return
      setErr("שגיאה בטעינת הזמינות")
      setLoading(false)
    })
    return () => { alive = false }
  }, [game.id, myPlayerId, canSeeAny, publicView])

  const choose = async (status) => {
    setErr(null)
    if (status === "available" && medOk === false) { setErr(MED_MSG); return }
    if (status === "available" && suspension) { setErr(SUSPENDED_MSG); return }
    if (status === "available" && myBlock) { setErr(UNAVAILABLE_MSG); return }
    setSaving(true)
    try {
      await setMyAvailability(game.id, status)
      setMyStatus(status)
      if (status === "available") setMedOk(true)
      if (canSeeAny) refreshRows()
    } catch (e) {
      const code = e?.message
      setErr(
        code === "no-valid-medical" ? MED_MSG
        : code === "suspended" ? SUSPENDED_MSG
        : code === "unavailable" ? UNAVAILABLE_MSG
        : code === "not-in-game" ? "אינך שייך לאחת מהקבוצות במשחק זה"
        : "הפעולה נכשלה, נסו שוב"
      )
    } finally { setSaving(false) }
  }

  const removeManual = async (playerId) => {
    setErr(null)
    try { await removePlayerFromSquad(game.id, playerId); refreshRows() }
    catch (e) { setErr(e.message) }
  }

  const submitReport = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!rFrom) { setErr("יש לבחור תאריך התחלה"); return }
    if (rTo && rTo < rFrom) { setErr("תאריך הסיום מוקדם מתאריך ההתחלה"); return }
    setRBusy(true)
    try {
      await reportUnavailability({ kind: rKind, startsOn: rFrom, endsOn: rTo || null, reason: rReason })
      setReportOpen(false); setRReason(""); setRTo("")
      refreshBlocks()
    } catch (e2) { setErr(e2.message) }
    finally { setRBusy(false) }
  }

  const withdrawReport = async (id) => {
    setErr(null); setRBusy(true)
    try { await clearUnavailability(id); refreshBlocks() }
    catch (e) { setErr(e.message) }
    finally { setRBusy(false) }
  }

  const decide = async (id, approve) => {
    setActionErr(null); setDeciding(id)
    try { await decideUnavailability(id, approve, decisionNotes[id]); refreshBlocks() }
    catch (e) { setActionErr(e.message) }
    finally { setDeciding(null) }
  }

  // By UUID, not slug: the native apps route games/<uuid>, and the website redirects a
  // UUID to the Hebrew URL keeping the #availability fragment.
  const signupLink = `${window.location.origin}/games/${game.id}#availability`
  const copySignupLink = async () => {
    try { await navigator.clipboard.writeText(signupLink) }
    catch { window.prompt("העתיקו את הקישור:", signupLink); return }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // The official (RLS) rows win: they carry the manual-add note and side. The public rows
  // fill in everyone else's status — and their manual side, so a loan lands on the right team.
  const rowByPlayer = Object.fromEntries([...publicRows, ...rows].map(r => [r.player_id, r]))
  const statusByPlayer = Object.fromEntries([...publicRows, ...rows].map(r => [r.player_id, r.status]))
  const nameOf = (p) => `${p?.first_name || ""} ${p?.last_name || ""}`.trim() || "שחקן"

  // A team's squad is its roster PLUS anyone manually added for it — a loaned
  // goalkeeper or a one-time youth call-up is on neither roster, so filtering
  // players-by-team alone would silently drop him — MINUS anyone lent the other way
  // for this game.
  const rosterOf = (teamId) => {
    const base = Object.values(playersMap).filter(p => {
      if (p.team_id !== teamId) return false
      const row = rowByPlayer[p.id]
      return !(row?.team_id && row.team_id !== teamId)
    })
    const seen = new Set(base.map(p => p.id))
    const manual = rows
      .filter(r => r.team_id && r.team_id === teamId && !seen.has(r.player_id))
      .map(r => playersMap[r.player_id])
      .filter(Boolean)
    return [...base, ...manual]
  }

  const teamsToShow = [
    ...officialTeamIds.map(tid => ({ tid, full: true })),
    ...(playerTeamId && !officialTeamIds.includes(playerTeamId) ? [{ tid: playerTeamId, full: false }] : []),
  ]
  // A signed-in viewer sees both sides; his own team first.
  if (publicView) for (const tid of [game.home_team_id, game.away_team_id]) {
    if (tid && !teamsToShow.some(t => t.tid === tid)) teamsToShow.push({ tid, full: false })
  }

  const nudge = async (tid) => {
    setNudging(tid)
    try {
      const n = await nudgeNonResponders(game.id, tid)
      setNudgeMsg(m => ({ ...m, [tid]: n > 0
        ? `✓ נשלחה תזכורת ל-${n} שחקנים`
        : "אין למי לשלוח — כל מי שיש לו אפליקציה ויכול להירשם כבר ענה (או קיבל תזכורת היום)" }))
    } catch (e) {
      setNudgeMsg(m => ({ ...m, [tid]: `השליחה נכשלה: ${e.message}` }))
    } finally { setNudging(null) }
  }

  // Whose blocks to ask about: every player in a squad this viewer manages, plus himself.
  // A plain player is deliberately left out of the squad-wide half — the RLS policies on
  // both tables would return nothing for a team-mate, so asking is a wasted round trip.
  const watchIds = new Set(myPlayerId ? [myPlayerId] : [])
  for (const { tid, full } of teamsToShow) if (full) for (const p of rosterOf(tid)) watchIds.add(p.id)
  const watchKey = [...watchIds].sort().join(",")

  useEffect(() => {
    const ids = watchKey ? watchKey.split(",") : []
    if (!ids.length) { setSuspByPlayer({}); setAbsences([]); return }
    let alive = true
    Promise.all([getActiveSuspensionsFor(ids), getUnavailabilityFor(ids)]).then(([s, u]) => {
      if (!alive) return
      setSuspByPlayer(s)
      setAbsences(u)
    })
    return () => { alive = false }
  }, [watchKey, blocksTick])

  const myAbsences = myPlayerId ? absences.filter(u => u.player_id === myPlayerId) : []
  const myBlock = myAbsences.find(u => activeOn(u, day)) || null
  const myPending = myAbsences.find(u => u.status === "pending") || null

  /**
   * Why this player cannot register for THIS game, or null. A red card outranks an
   * absence: it is the league's decision, and it is the one the coach can do nothing
   * about. `suspension` (the viewer's own, via the definer RPC) is folded in so the
   * personal line still works for a player who is in nobody's readable squad.
   */
  const blockOf = (pid) => {
    const s = suspByPlayer[pid] || (pid === myPlayerId ? suspension : null)
    if (s) return { label: "כרטיס אדום", detail: s.reason || "", range: "", open: false, text: "כרטיס אדום" }
    const a = absences.find(u => u.player_id === pid && activeOn(u, day))
    if (!a) return null
    const { range, open } = absenceRange(a)
    return { label: kindLabel(a.kind), detail: a.reason || "", range, open, text: absenceText(a) }
  }

  if ((!myPlayerId && !canSeeAny) || loading) return null

  const inSquadIds = new Set(rows.map(r => r.player_id))
  const pickerPlayers = Object.values(playersMap).map(p => ({
    ...p, teamName: teamsMap[p.team_id]?.name || "",
  }))

  // A date span is one left-to-right run; splitting it into two would make RTL bidi
  // reorder the halves and show the end date first.
  const Span = ({ block }) => block?.range
    ? <span className="text-slate-500 dark:text-slate-400">
        <span dir="ltr">{block.range}</span>{block.open ? " ואילך" : ""}
      </span>
    : null

  const Col = ({ label, cls, list, canEdit = false }) => (
    <div className="min-w-0">
      <p className={`text-[11px] font-semibold mb-1 ${cls}`}>{label} ({list.length})</p>
      {list.length === 0
        ? <p className="text-[11px] text-slate-400">—</p>
        : list.map(p => {
          const row = rowByPlayer[p.id]
          const manual = !!row?.added_by
          const pending = absences.find(u => u.player_id === p.id && u.status === "pending")
          return (
            <p key={p.id} className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300">
              <span className="truncate">{nameOf(p)}{p.position === "Goalkeeper" ? " 🧤" : ""}</span>
              {manual && (
                <span title={row.note || "נוסף ידנית"}
                  className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                  ידני
                </span>
              )}
              {pending && (
                <span title={`בקשת היעדרות ממתינה: ${kindLabel(pending.kind)}`}
                  className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  בקשת היעדרות
                </span>
              )}
              {manual && canEdit && (
                <button onClick={() => removeManual(p.id)} aria-label={`הסרת ${nameOf(p)} מהסגל`}
                  className="shrink-0 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 transition-colors">
                  <UserMinus className="w-3 h-3" />
                </button>
              )}
            </p>
          )
        })}
    </div>
  )

  return (
    <div className="card p-4 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <CalendarCheck className="w-4 h-4 text-brand" /> זמינות למשחק
      </h3>

      {myPlayerId && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400">מגיע/ה למשחק?</span>
            <button onClick={() => choose("available")} disabled={saving || medOk === false || !!suspension || !!myBlock}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${myStatus === "available" ? "bg-emerald-500 text-white" : "border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"}`}>
              <Check className="w-3.5 h-3.5" /> מגיע/ה
            </button>
            {/* Deliberately still enabled for a blocked player: the league asked that he be
                able to say "I'm not coming", so the coach sees someone engaged rather than
                someone silent. */}
            <button onClick={() => choose("unavailable")} disabled={saving}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${myStatus === "unavailable" ? "bg-red-500 text-white" : "border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"}`}>
              <X className="w-3.5 h-3.5" /> לא מגיע/ה
            </button>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          {/* A refusal has to say WHY — a disabled button with no reason reads as a bug. */}
          {suspension && (
            <p className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <Ban className="w-3.5 h-3.5 shrink-0" />
              <span>{SUSPENDED_MSG}{suspension.reason ? ` — ${suspension.reason}` : ""}</span>
            </p>
          )}
          {!suspension && myBlock && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <CalendarX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                {UNAVAILABLE_MSG} — {kindLabel(myBlock.kind)} <Span block={absenceRange(myBlock)} />
                {myBlock.reason ? ` · ${myBlock.reason}` : ""}
                <br />
                <span className="text-slate-500 dark:text-slate-400">לסיום ההיעדרות מוקדם מהצפוי יש לפנות למאמן/ת.</span>
              </span>
            </p>
          )}
          {medOk === false && (
            <p className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>{MED_MSG} — <Link to="/me" className="font-semibold underline">להעלאה</Link></span>
            </p>
          )}

          {/* Reporting an absence is the player's half of the same conversation: without
              it the only way to say "I'm injured for a month" is to answer לא מגיע/ה on
              each fixture separately, and the coach never learns why. */}
          {myPending ? (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <CalendarX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                דיווח ההיעדרות שלך ממתין לאישור המאמן/ת: {kindLabel(myPending.kind)}{" "}
                <Span block={absenceRange(myPending)} />
                {myPending.reason ? ` · ${myPending.reason}` : ""}
                {" "}
                <button onClick={() => withdrawReport(myPending.id)} disabled={rBusy}
                  className="font-semibold underline disabled:opacity-50">ביטול הדיווח</button>
              </span>
            </div>
          ) : reportOpen ? (
            <form onSubmit={submitReport} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">דיווח על היעדרות</p>
                <button type="button" onClick={() => setReportOpen(false)} aria-label="ביטול"
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">סיבה</span>
                  <select value={rKind} onChange={e => setRKind(e.target.value)} aria-label="סוג ההיעדרות"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30">
                    {UNAVAILABILITY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">מתאריך</span>
                  <input type="date" dir="ltr" value={rFrom} onChange={e => setRFrom(e.target.value)} required
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                </label>
                <label className="block">
                  {/* Open-ended on purpose — an injury rarely comes with a return date on
                      day one, and an invented one either locks the player out too long or
                      lets him back too early. */}
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">עד תאריך (לא חובה)</span>
                  <input type="date" dir="ltr" value={rTo} min={rFrom} onChange={e => setRTo(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                </label>
              </div>
              <input value={rReason} onChange={e => setRReason(e.target.value)} maxLength={120}
                placeholder="פירוט (לא חובה)" aria-label="פירוט"
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                הדיווח יישלח לאישור המאמן/ת. עד לאישור לא יחול שינוי ברישום שלך למשחקים.
              </p>
              <button type="submit" disabled={rBusy}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-40">
                {rBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarX className="w-3.5 h-3.5" />}
                שליחת הדיווח
              </button>
            </form>
          ) : !myBlock && (
            <button onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
              <CalendarX className="w-3.5 h-3.5" /> דיווח על היעדרות ממושכת
            </button>
          )}

          {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
        </div>
      )}

      {teamsToShow.map(({ tid, full }) => {
        const roster = rosterOf(tid)
        // Blocked players come out of the other three buckets entirely: they cannot
        // register, so leaving them in makes the מגיעים count — and the <4 / no-GK
        // warnings the coach plans around — describe a squad he cannot field.
        const blocked = full ? roster.filter(p => blockOf(p.id)) : []
        const blockedIds = new Set(blocked.map(p => p.id))
        const answerable = roster.filter(p => !blockedIds.has(p.id))
        const coming = answerable.filter(p => statusByPlayer[p.id] === "available")
        const notComing = answerable.filter(p => statusByPlayer[p.id] === "unavailable")
        const noReply = answerable.filter(p => !statusByPlayer[p.id])
        const gkComing = coming.some(p => p.position === "Goalkeeper")
        const tooFew = coming.length < MIN_PLAYERS
        const rosterIds = new Set(roster.map(p => p.id))
        const pendingRows = full ? absences.filter(u => u.status === "pending" && rosterIds.has(u.player_id)) : []
        // What each line has to say beyond the name, in the exported text.
        const noteOf = (p) => {
          const bits = []
          const b = blockOf(p.id)
          if (b) bits.push(b.text)
          const row = rowByPlayer[p.id]
          if (row?.added_by) {
            bits.push(row.note || (p.team_id && p.team_id !== tid
              ? `בהשאלה מ${teamsMap[p.team_id]?.name || "קבוצה אחרת"}`
              : "נוסף לסגל ידנית"))
          }
          return bits.join(" · ")
        }
        return (
          <div key={tid} className="pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">{teamsMap[tid]?.name || "קבוצה"}</span>
              {full && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tooFew ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>{coming.length} מגיעים</span>
                  {tooFew && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"><AlertTriangle className="w-3 h-3" /> פחות מ-4</span>}
                  {!gkComing && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"><AlertTriangle className="w-3 h-3" /> אין שוער</span>}
                </div>
              )}
            </div>
            <div className="grid gap-3 grid-cols-3">
              <Col label="מגיעים" cls="text-emerald-600 dark:text-emerald-400" list={coming} canEdit={full} />
              <Col label="לא מגיעים" cls="text-red-600 dark:text-red-400" list={notComing} canEdit={full} />
              <Col label="לא הגיבו" cls="text-slate-500 dark:text-slate-400" list={noReply} />
            </div>

            {nudgeTeamIds.includes(tid) && noReply.length > 0 && (
              <div className="mt-2">
                <button onClick={() => nudge(tid)} disabled={nudging === tid}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-dashed border-brand/40 text-brand hover:bg-brand/5 transition-colors disabled:opacity-50">
                  {nudging === tid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
                  תזכורת למי שלא ענה
                </button>
                {nudgeMsg[tid] && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{nudgeMsg[tid]}</p>}
              </div>
            )}

            {/* Its own block rather than a fourth column: each line has to carry a reason
                and a date range, which does not fit in a third of a phone screen. */}
            {blocked.length > 0 && (
              <div className="mt-3 p-2 rounded-lg border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/15 space-y-1">
                <p className="flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
                  <Ban className="w-3 h-3" /> חסומים לרישום ({blocked.length})
                </p>
                {blocked.map(p => {
                  const b = blockOf(p.id)
                  return (
                    <p key={p.id} className="flex items-center gap-1.5 flex-wrap text-xs text-slate-700 dark:text-slate-300">
                      <span className="truncate">{nameOf(p)}{p.position === "Goalkeeper" ? " 🧤" : ""}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{b.label}</span>
                      <span className="text-[10px]"><Span block={b} /></span>
                      {b.detail && <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{b.detail}</span>}
                    </p>
                  )
                })}
              </div>
            )}

            {/* A pending report is not a block yet — the player stays in his normal bucket
                until someone decides, which is what these two buttons are. */}
            {pendingRows.length > 0 && (
              <div className="mt-3 p-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/15 space-y-2">
                <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <CalendarX className="w-3 h-3" /> בקשות היעדרות לאישורך ({pendingRows.length})
                </p>
                {pendingRows.map(u => {
                  const r = absenceRange(u)
                  return (
                    <div key={u.id} className="space-y-1">
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="font-semibold">{nameOf(playersMap[u.player_id])}</span> — {kindLabel(u.kind)}{" "}
                        <span dir="ltr">{r.range}</span>{r.open ? " ואילך" : ""}
                        {u.reason ? ` · ${u.reason}` : ""}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input value={decisionNotes[u.id] || ""} maxLength={120}
                          onChange={e => setDecisionNotes(n => ({ ...n, [u.id]: e.target.value }))}
                          placeholder="הערה לשחקן (לא חובה)" aria-label={`הערה לבקשה של ${nameOf(playersMap[u.player_id])}`}
                          className="flex-1 min-w-[8rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
                        <button onClick={() => decide(u.id, true)} disabled={deciding === u.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                          {deciding === u.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} אישור
                        </button>
                        <button onClick={() => decide(u.id, false)} disabled={deciding === u.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                          <X className="w-3 h-3" /> דחייה
                        </button>
                      </div>
                    </div>
                  )
                })}
                {actionErr && <p className="text-[11px] text-red-600 dark:text-red-400">{actionErr}</p>}
              </div>
            )}

            {/* Row 11 — hand the squad to WhatsApp, the channel that actually reaches
                players who have no account. */}
            {full && (
              <button
                onClick={() => {
                  const text = buildSquadMessage({
                    game, teamName: teamsMap[tid]?.name || "הקבוצה",
                    opponentName: teamsMap[tid === game.home_team_id ? game.away_team_id : game.home_team_id]?.name,
                    coming, notComing, noReply, blocked, nameOf, noteOf, link: signupLink,
                  })
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
                }}
                className="mt-2 ms-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Share2 className="w-3.5 h-3.5" /> ייצוא לוואטסאפ
              </button>
            )}

            {/* The link players tap to answer — opens the app on a phone that has it. */}
            {full && (
              <button onClick={copySignupLink}
                className="mt-2 ms-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Link2 className="w-3.5 h-3.5" />}
                {copied ? "הקישור הועתק" : "העתקת קישור לאישור הגעה"}
              </button>
            )}

            {/* Only a coach of this team (or an admin) builds the squad. */}
            {full && (
              <AddSquadPlayer
                gameId={game.id}
                teamId={tid}
                teamName={teamsMap[tid]?.name || "הקבוצה"}
                players={pickerPlayers}
                excludeIds={inSquadIds}
                onAdded={refreshRows}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
