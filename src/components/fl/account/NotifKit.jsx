/**
 * Notification rows in the Floodlight look (board NotifBell): grouped היום / השבוע /
 * קודם, filter chips (הכל · דורש תשובה · משחקים · אזכורים), a brand-icon tile with the
 * team's crest badge, and — where the row needs an answer and an existing call can take
 * it — answer buttons right on the row (מגיע / לא מגיע → set_game_availability, אני בא
 * לעודד → set_game_watch). Rows whose answer lives on another page get a link button.
 * Used by the header bell (desktop dropdown) and /notifications.
 */
import { useState } from "react"
import { Link } from "react-router-dom"
import { notificationText, notificationBrandIcon, notificationHref, notificationPreview } from "@/lib/notifications"
import { setMyAvailability } from "@/lib/availability"
import { setGameWatch } from "@/lib/follows"
import { BrandIcon } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { sizedImage } from "@/lib/imageSize"
import { Spinner, Glyph } from "./AccountKit"

const ADMIN_QUEUE = new Set([
  "claim_request", "content_report", "game_change_request", "team_join_request", "coach_request",
  "official_role_request", "card_unlink_request", "player_submission_request", "medical_submitted",
  "medical_pending_manager", "medical_reinspection", "medical_expiring_player", "unavailability_reported",
  "coach_open_items", "official_application",
])
const ANSWER = new Set(["game_register_reminder", "game_register_nudge"])
const LINK_ACTION = {
  game_form_sign: "חתימה", loan_request: "לתשובה", loan_call: "לפרטים", game_change_opponent: "בחירת מועד",
  tournament_invite: "לתשובה", stream_approved: "לשידור", medical_expiring: "חידוש", medical_rejected: "העלאה מחדש",
}
const GAMES = /^(game_|follow_game|goal_scored|lm_|coach_squad|official_assigned|loan_)/
const MENTIONS = new Set(["tagged", "post_comment", "post_like"])

// The shared lib's strings still carry a few emoji; the Floodlight UI shows none (System 12).
const noEmoji = (t) => (t || "").replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/[ \t]{2,}/g, " ").trim()

const futureGame = (n) => !n.data?.game_date || new Date(n.data.game_date).getTime() > Date.now()
const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString()

/** What this row asks of the reader: 'answer' | 'cheer' | 'link' | null. */
export function rowAction(n) {
  if (!n?.entity_id && !LINK_ACTION[n?.type] && !ADMIN_QUEUE.has(n?.type)) return null
  if (ANSWER.has(n.type) && futureGame(n)) return "answer"
  if (n.type === "game_moved" && n.data?.reconfirm && futureGame(n)) return "answer"
  if (n.type === "follow_game_today" && sameDay(n.created_at) && n.entity_id) return "cheer"
  if (LINK_ACTION[n.type] || ADMIN_QUEUE.has(n.type)) return "link"
  return null
}

export function needsAction(n) { return !!rowAction(n) }

export const FILTERS = [
  { id: "all", label: "הכל", test: () => true },
  { id: "action", label: "דורש תשובה", test: needsAction },
  { id: "games", label: "משחקים", test: (n) => GAMES.test(n.type) },
  { id: "mentions", label: "אזכורים", test: (n) => MENTIONS.has(n.type) },
]

/** היום / השבוע / קודם, newest first inside each. */
export function groupByAge(rows) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const week = start - 6 * 86400000
  const g = { today: [], week: [], earlier: [] }
  for (const n of rows) {
    const t = new Date(n.created_at).getTime()
    ;(t >= start ? g.today : t >= week ? g.week : g.earlier).push(n)
  }
  return [["היום", g.today], ["השבוע", g.week], ["קודם", g.earlier]].filter(([, r]) => r.length)
}

const WEEKDAY = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]
function when(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
  if (now - d < 6 * 86400000) return WEEKDAY[d.getDay()]
  return `${d.getDate()}.${d.getMonth() + 1}`
}

const AVAIL_ERR = {
  "no-valid-medical": "אין אישור רפואי בתוקף. מעלים ב\"הדף שלי\"",
  suspended: "יש הרחקה פעילה, אי אפשר להירשם",
  unavailable: "מסומן אצלך שאינך זמין בתאריך הזה",
  "not-in-game": "אינך בסגל של אחת הקבוצות במשחק",
}

function Actions({ n, onDone }) {
  const kind = rowAction(n)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  if (!kind) return null
  const href = notificationHref(n)

  const answer = async (status) => {
    setBusy(status); setErr(null)
    try { await setMyAvailability(n.entity_id, status); setDone(status === "available" ? "נשמר: מגיע" : "נשמר: לא מגיע"); onDone?.(n) }
    catch (e) { setErr(AVAIL_ERR[e?.message] || "השמירה נכשלה. אפשר לענות בעמוד המשחק") }
    finally { setBusy(null) }
  }
  const cheer = async () => {
    setBusy("cheer"); setErr(null)
    try { await setGameWatch(n.entity_id, true); setDone("סומן: בא לעודד"); onDone?.(n) }
    catch { setErr("השמירה נכשלה, נסו שוב") }
    finally { setBusy(null) }
  }
  const btn = "h-11 px-4 rounded-xl text-[14px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent"
  const ink = `${btn} bg-brand text-brand-fg hover:bg-brand-hover`
  const quiet = `${btn} border border-line-strong text-fg-strong font-medium hover:bg-surface-page`

  if (done) return <p role="status" className="flex items-center gap-1.5 text-[13px] font-bold text-[#1B5E2A] dark:text-emerald-300"><Glyph d="check" size={15} stroke={2.6} /> {done}</p>
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {kind === "answer" && <>
          <button type="button" className={ink} disabled={!!busy} onClick={() => answer("available")}>{busy === "available" && <Spinner />}{n.type === "game_moved" ? "עדיין מגיע" : "מגיע"}</button>
          <button type="button" className={quiet} disabled={!!busy} onClick={() => answer("unavailable")}>{busy === "unavailable" && <Spinner />}לא מגיע</button>
        </>}
        {kind === "cheer" && <button type="button" className={ink} disabled={!!busy} onClick={cheer}>{busy && <Spinner />}אני בא לעודד</button>}
        {kind === "link" && <Link to={href} className={ink}>{LINK_ACTION[n.type] || "לטיפול"}</Link>}
      </div>
      {err && <p role="alert" className="text-[12.5px] font-semibold text-[#B4231A] dark:text-[#FF8A7A]">{err}</p>}
    </div>
  )
}

/** The team a row is about, for the crest badge: its own team field, else the home side. */
function teamOf(n, teamsByName) {
  const d = n.data || {}
  const name = d.team_name || d.scoring_team || d.home_team
  return name ? teamsByName[name] : null
}

export function NotifRow({ n, teamsByName = {}, onOpen, onAnswered, wrap = false }) {
  const team = teamOf(n, teamsByName)
  const preview = notificationPreview(n)
  const showAvatar = n.actor?.avatar_url && n.type !== "announcement"
  const unread = !n.read_at
  return (
    <div className={`relative ${unread ? "bg-white dark:bg-[#1A212B]" : ""}`}>
      {unread && <span aria-label="לא נקרא" className="absolute right-[5px] top-[30px] w-[7px] h-[7px] rounded-full bg-[#1550D8] dark:bg-[#6E9BFF]" />}
      <Link to={notificationHref(n)} onClick={() => onOpen?.(n)}
        className="flex gap-3 px-4 pt-3 pb-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fl-accent">
        <span className="relative w-[46px] h-[46px] shrink-0 rounded-[14px] bg-white border border-[#E4E0D8] dark:border-transparent flex items-center justify-center">
          {showAvatar
            ? <img src={sizedImage(n.actor.avatar_url, 92)} alt="" className="w-full h-full rounded-[13px] object-cover" />
            : <BrandIcon name={notificationBrandIcon(n)} variant="large" className="w-8 h-8 object-contain" />}
          {team && <span className="absolute -bottom-[5px] -left-[5px]"><TeamLogo team={team} px={22} className="ring-2 ring-surface" /></span>}
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`text-[14.5px] leading-[1.35] text-fg-strong break-words ${unread ? "font-bold" : "font-semibold"} ${wrap ? "whitespace-pre-line" : ""}`}>{noEmoji(notificationText(n))}</span>
            <span className="text-[12px] text-fg-muted shrink-0 tabular-nums">{when(n.created_at)}</span>
          </span>
          {preview && (
            <span className={`text-[13.5px] leading-snug text-fg break-words ${wrap ? "whitespace-pre-line" : "line-clamp-2"}`}>
              {n.type === "announcement" ? noEmoji(preview) : `“${noEmoji(preview)}”`}
            </span>
          )}
        </span>
      </Link>
      {rowAction(n) && <div className="pr-[74px] pl-4 pb-3 -mt-1"><Actions n={n} onDone={onAnswered} /></div>}
    </div>
  )
}

export function FilterChips({ value, onChange, rows }) {
  const actionCount = rows.filter(needsAction).length
  return (
    <div role="group" aria-label="סינון" className="flex gap-2 overflow-x-auto nav-scroll -mx-4 px-4 pb-1">
      {FILTERS.map(f => {
        const on = value === f.id
        return (
          <button key={f.id} type="button" aria-pressed={on} onClick={() => onChange(f.id)}
            className={`h-11 shrink-0 px-3.5 rounded-full inline-flex items-center gap-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${
              on ? "bg-brand text-brand-fg font-bold" : "bg-surface text-fg-strong font-semibold hover:bg-surface-sunken"}`}>
            {f.label}
            {f.id === "action" && actionCount > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-fl-accent text-fl-inkOnLight text-[11.5px] font-extrabold flex items-center justify-center tabular-nums">{actionCount}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyNotifs({ filtered }) {
  return (
    <div className="py-12 px-6 text-center flex flex-col items-center gap-2">
      <BrandIcon name="bell" variant="large" className="w-14 h-14" />
      <p className="text-[16px] font-extrabold text-fg-strong">{filtered ? "אין כאן כלום כרגע" : "אין התראות עדיין"}</p>
      <p className="text-[13px] text-fg-muted max-w-[260px]">שולחים רק כשצריך ממך משהו: מגיע לשבת?, משחק שזז, טופס לחתימה.</p>
    </div>
  )
}
