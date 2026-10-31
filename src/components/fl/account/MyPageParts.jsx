/**
 * The /me groups that are new on the web in Floodlight (board MyPage / MyExtras), each on
 * data and calls that already exist: followed teams (follows), push on this device
 * (push_subscriptions), the game-day / day-before switches (follows.game_day / notify),
 * calendar subscribe (/api/calendar), "אני לא זמין" (report_unavailability), and the
 * name+photo / password sheets. Nothing here invents a setting the server can't keep.
 */
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getTeams } from "@/lib/api"
import { getMyTeamFollowRows, unfollow, setFollowNotify, setTeamFollowsGameDay, getMyRosterTeamIds } from "@/lib/follows"
import { pushSupported, pushStatus, enablePush } from "@/lib/push"
import { getUnavailability, reportUnavailability, clearUnavailability, UNAVAILABILITY_KINDS, unavailabilityState, kindLabel, todayISO } from "@/lib/unavailability"
import { getMyLoanRequests } from "@/lib/loans"
import TeamLogo from "@/components/TeamLogo"
import { AccGroup, AccRow, AccButton, AccChip, AccSwitch, Sheet, CTA, Field, Glyph, Spinner, Notice, inputCls, errText } from "./AccountKit"

let teamsCache = null
export function useLeagueTeams() {
  const [teams, setTeams] = useState(teamsCache || [])
  useEffect(() => {
    if (teamsCache) return
    getTeams("name", true).then(t => { teamsCache = t || []; setTeams(teamsCache) }).catch(() => {})
  }, [])
  return teams
}

/* ------------------------------------------------------------- follows */

/** Followed teams + the switches that act on all of them. Returns null-safe rows. */
export function useTeamFollows(enabled = true) {
  const [rows, setRows] = useState(null)
  const [own, setOwn] = useState(new Set())
  const load = async () => {
    const [r, o] = await Promise.all([getMyTeamFollowRows(), getMyRosterTeamIds().catch(() => new Set())])
    setRows(r); setOwn(o)
  }
  useEffect(() => { if (enabled) load() }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, own, setRows, reload: load }
}

export function FollowsGroup({ follows, viewer }) {
  const teams = useLeagueTeams()
  const byId = Object.fromEntries(teams.map(t => [t.id, t]))
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const { rows, own, setRows } = follows
  const ownIds = [...own].filter(id => byId[id])
  const followed = (rows || []).filter(r => !own.has(r.target_id) && byId[r.target_id])

  const remove = async (id) => {
    setBusy(id); setErr(null)
    try { await unfollow("team", id); setRows(rs => rs.filter(r => r.target_id !== id)) }
    catch { setErr("ההסרה נכשלה, נסו שוב") }
    finally { setBusy(null) }
  }

  return (
    <AccGroup title="קבוצות שאני עוקב" footer={err && <span className={errText}>{err}</span>}>
      {rows == null && <AccRow line="search" label="טוען…" />}
      {ownIds.map(id => (
        <TeamRowIcon key={id} team={byId[id]}>
          <AccRow label={byId[id].name} sub="הקבוצה שלי · תמיד במעקב" to={`/teams/${byId[id].slug || id}`}
            trailing={<AccChip tone="ok">שלי</AccChip>} />
        </TeamRowIcon>
      ))}
      {followed.map((r, i) => {
        const t = byId[r.target_id]
        const primary = viewer === "fan" && i === 0 && ownIds.length === 0
        return (
          <TeamRowIcon key={r.target_id} team={t}>
            <AccRow label={t.name} sub={primary ? "הקבוצה הראשית שלי" : "עוקב · המשחקים שלה ראשונים בפיד"}
              trailing={<>
                {primary && <AccChip tone="blue">ראשית</AccChip>}
                <AccButton tone="quiet" onClick={() => remove(r.target_id)} disabled={busy === r.target_id} aria-label={`הסרת ${t.name} מהמעקב`}>
                  {busy === r.target_id ? <Spinner /> : "הסרה"}
                </AccButton>
              </>} />
          </TeamRowIcon>
        )
      })}
      <AccRow line="plus" label="לעקוב אחרי עוד קבוצה" sub="מעמוד הקבוצה: כפתור המעקב" to="/teams" />
    </AccGroup>
  )
}

/** Puts a 32px crest disc in front of an AccRow (AccRow's own icon slot takes brand/line art). */
function TeamRowIcon({ team, children }) {
  return (
    <div className="relative">
      <span className="absolute top-1/2 -translate-y-1/2 right-3.5 z-[1] pointer-events-none"><TeamLogo team={team} px={32} /></span>
      <div className="[&>a]:pr-[60px] [&>div]:pr-[60px] [&>button]:pr-[60px]">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------- notifications */

export function NotificationsGroup({ follows, isPlayer }) {
  const [push, setPush] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const rows = follows.rows || []

  useEffect(() => {
    if (!pushSupported()) { setPush("unsupported"); return }
    pushStatus().then(setPush).catch(() => setPush("default"))
  }, [])

  const turnOnPush = async () => {
    setPushBusy(true)
    try {
      const res = await enablePush()
      setPush(res.ok ? "on" : (res.reason === "denied" ? "denied" : "default"))
      if (!res.ok && res.reason !== "denied" && res.reason !== "default") setErr("הפעלת ההתראות נכשלה, נסו שוב")
    } finally { setPushBusy(false) }
  }

  const gameDayOn = rows.length > 0 && rows.every(r => r.game_day !== false)
  const notifyOn = rows.length > 0 && rows.every(r => r.notify)

  const setGameDay = async (on) => {
    setBusy("gd"); setErr(null)
    const prev = rows
    follows.setRows(rs => rs.map(r => ({ ...r, game_day: on })))
    try { await setTeamFollowsGameDay(on) } catch { follows.setRows(prev); setErr("השמירה נכשלה, נסו שוב") }
    finally { setBusy(null) }
  }
  const setNotify = async (on) => {
    setBusy("nt"); setErr(null)
    const prev = rows
    follows.setRows(rs => rs.map(r => ({ ...r, notify: on })))
    try { await Promise.all(rows.map(r => setFollowNotify("team", r.target_id, on))) }
    catch { follows.setRows(prev); setErr("השמירה נכשלה, נסו שוב") }
    finally { setBusy(null) }
  }

  const pushRow = {
    on: { sub: "פועלות בדפדפן הזה", trailing: <AccChip tone="ok">פועל</AccChip> },
    default: { sub: "פוש רק כשצריך ממך משהו: מגיע לשבת?, משחק שזז, טופס לחתימה", trailing: <AccButton onClick={turnOnPush} disabled={pushBusy}>{pushBusy ? <Spinner /> : "הפעלה"}</AccButton> },
    denied: { sub: "חסומות בדפדפן. מאפשרים אותן בהגדרות האתר (סמל המנעול ליד הכתובת)", trailing: <AccChip tone="quiet">חסום</AccChip> },
    unsupported: { sub: "הדפדפן הזה לא תומך בהתראות. באפליקציה הן עובדות תמיד", trailing: null },
  }[push || "default"] || {}

  return (
    <AccGroup title="התראות" footer={err && <span className={errText}>{err}</span>}>
      <AccRow brand="bell" label="התראות במכשיר הזה" sub={push == null ? "בודק…" : pushRow.sub} trailing={push == null ? null : pushRow.trailing} />
      {rows.length > 0 && (
        <AccRow brand="calendar" label="הקבוצה משחקת היום" sub='תזכורת בבוקר המשחק לקבוצות שאני עוקב'
          trailing={<AccSwitch on={gameDayOn} onChange={setGameDay} disabled={busy === "gd"} label="הקבוצה משחקת היום" />} />
      )}
      {rows.length > 0 && (
        <AccRow brand="reminder" label="יום לפני המשחק" sub="תזכורת ערב לפני משחק של הקבוצות שאני עוקב"
          trailing={<AccSwitch on={notifyOn} onChange={setNotify} disabled={busy === "nt"} label="יום לפני המשחק" />} />
      )}
      {isPlayer && (
        <AccRow brand="waiting" label="מגיע לשבת? ומשחק שזז או נדחה" sub="תמיד נשלח, כי צריך לענות או לאשר שוב" trailing={<AccChip tone="quiet">חובה</AccChip>} />
      )}
      <AccRow brand="tag" label="תיוגים, תגובות ולייקים" sub="בפעמון בלבד, בלי צלצול" trailing={<AccChip tone="quiet">פעמון</AccChip>} />
      <AccRow line="bell" label="כל ההתראות" to="/notifications" />
    </AccGroup>
  )
}

/* ------------------------------------------------------------- calendar */

function feedOrigin() {
  const h = typeof window !== "undefined" ? window.location.hostname : ""
  return h.endsWith("rinkhockeyil.com") || h.endsWith(".vercel.app") ? window.location.origin : "https://rinkhockeyil.com"
}
const isApple = () => typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent)
const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)

/** Calendar subscribe (the same /api/calendar feed as the games page). */
export function CalendarRow({ team, guest }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(team ? "team" : "all")
  const [copied, setCopied] = useState(false)
  const useTeam = scope === "team" && team
  const https = `${feedOrigin()}/api/calendar${useTeam ? `?team=${encodeURIComponent(team.slug || team.id)}` : ""}`
  const webcal = https.replace(/^https?:/, "webcal:")
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(https)}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(https); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* in-app browsers refuse */ }
  }
  return (
    <AccGroup title="יומן">
      <AccRow brand="calendar" label={team ? "משחקי הקבוצה ביומן שלי" : "משחקי הליגה ביומן שלי"}
        sub={guest ? "בלי חשבון: כל הליגה או קבוצה אחת · מתעדכן לבד כשמשחק זז" : "מנוי ליומן · מתעדכן לבד כשמשחק זז"}
        trailing={<AccButton onClick={() => setOpen(true)}>הוספה</AccButton>} />
      {open && (
        <Sheet onClose={() => setOpen(false)} title="הוספה ליומן">
          <div className="flex flex-col gap-4">
            {team && (
              <div role="radiogroup" aria-label="מה להוסיף" className="grid grid-cols-2 gap-2">
                {[["team", `משחקי ${team.name}`], ["all", "כל הליגה"]].map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(v)}
                    className={`min-h-12 px-3 rounded-[14px] text-[14px] font-bold border-2 bg-surface transition-colors ${scope === v ? "border-fg-strong text-fg-strong" : "border-transparent text-fg-muted"}`}>{l}</button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              {(isApple() || !isPhone()) && <a href={webcal} className="h-12 rounded-[14px] bg-brand text-brand-fg font-bold inline-flex items-center justify-center gap-2"><Glyph d="cal" size={18} /> יומן אפל / <bdi>Outlook</bdi></a>}
              {!isPhone() && <a href={google} target="_blank" rel="noopener noreferrer" className="h-12 rounded-[14px] border border-line-strong bg-surface text-fg-strong font-bold inline-flex items-center justify-center">יומן Google</a>}
              <button type="button" onClick={copy} className="h-12 rounded-[14px] border border-line-strong bg-surface text-fg-strong font-bold inline-flex items-center justify-center gap-2">
                <Glyph d={copied ? "check" : "link"} size={18} /> {copied ? "הקישור הועתק" : "העתקת הקישור"}
              </button>
            </div>
            {isPhone() && !isApple() && (
              <Notice tone="info">ביומן Google מוסיפים מנוי רק מהמחשב: <bdi dir="ltr">calendar.google.com</bdi> ← יומנים אחרים ← מכתובת URL ← הדבקת הקישור. היומן יסתנכרן לטלפון לבד.</Notice>
            )}
          </div>
        </Sheet>
      )}
    </AccGroup>
  )
}

/* ------------------------------------------------------------- unavailability */

const fmt = (d) => (d ? new Date(d).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : "")

/** "אני לא זמין": the player's own absences + the sheet that files one (board MyExtras). */
export function UnavailabilityRow() {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState("injury")
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = () => getUnavailability().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  const live = (rows || []).filter(r => ["pending", "active", "upcoming"].includes(unavailabilityState(r)))
  const first = live[0]
  const stLabel = { pending: "ממתין לאישור המאמן", active: "פעיל עכשיו", upcoming: "מאושר" }

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!from) { setErr("יש לבחור תאריך התחלה"); return }
    if (to && to < from) { setErr("תאריך הסיום מוקדם מתאריך ההתחלה"); return }
    setBusy(true)
    try {
      await reportUnavailability({ kind, startsOn: from, endsOn: to || null, reason: reason.trim() || null })
      setOpen(false); setReason(""); setTo("")
      load()
    } catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }
  const withdraw = async (id) => {
    setBusy(true); setErr(null)
    try { await clearUnavailability(id); load() } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  return (
    <AccRow brand="injury" label="אני לא זמין"
      sub={first ? `${kindLabel(first.kind)} · ${fmt(first.starts_on)}${first.ends_on ? `–${fmt(first.ends_on)}` : " והלאה"} · ${stLabel[unavailabilityState(first)]}` : "פציעה, חו״ל, מילואים: מסמנים טווח תאריכים והמאמן רואה"}
      trailing={<AccButton tone="quiet" onClick={() => setOpen(true)}>{live.length ? "עוד" : "סימון"}</AccButton>}>
      {live.length > 0 && (
        <ul className="mx-3.5 mb-3 rounded-[14px] bg-surface-page divide-y divide-line">
          {live.map(r => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 min-h-[52px]">
              <span className="flex-1 min-w-0 text-[13px]">
                <span className="font-bold text-fg-strong">{kindLabel(r.kind)}</span>{" "}
                <span dir="ltr" className="text-fg-muted">{fmt(r.starts_on)}{r.ends_on ? `–${fmt(r.ends_on)}` : ""}</span>
                <span className="block text-[12px] text-fg-muted">{stLabel[unavailabilityState(r)]}</span>
              </span>
              <AccButton tone="ghost" onClick={() => withdraw(r.id)} disabled={busy}>ביטול</AccButton>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Sheet onClose={() => setOpen(false)} title="אני לא זמין"
          footer={<CTA type="submit" form="unav-form" disabled={busy}>{busy && <Spinner />} שליחה למאמן</CTA>}>
          <form id="unav-form" onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-[14px] text-fg-muted">המאמן מקבל את הדיווח ומאשר. בימים האלה לא תופיע/י ברשימת המגיעים.</p>
            <fieldset>
              <legend className="text-[13px] font-bold text-fg-strong mb-2">סיבה</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2">
                {UNAVAILABILITY_KINDS.map(k => (
                  <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)}
                    className={`h-12 rounded-[14px] text-[14px] font-bold border-2 bg-surface transition-colors ${kind === k.value ? "border-fg-strong text-fg-strong" : "border-transparent text-fg-muted"}`}>{k.label}</button>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="מתאריך" htmlFor="unav-from"><input id="unav-from" type="date" dir="ltr" value={from} onChange={e => setFrom(e.target.value)} className={`${inputCls} text-start`} /></Field>
              <Field label="עד (לא חובה)" htmlFor="unav-to"><input id="unav-to" type="date" dir="ltr" value={to} min={from} onChange={e => setTo(e.target.value)} className={`${inputCls} text-start`} /></Field>
            </div>
            <Field label="הערה למאמן (לא חובה)" htmlFor="unav-note">
              <textarea id="unav-note" rows={2} value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} className={`${inputCls} h-auto py-2.5 resize-none`} />
            </Field>
            {err && <Notice tone="err">{err}</Notice>}
          </form>
        </Sheet>
      )}
    </AccRow>
  )
}

/* ------------------------------------------------------------- loans */

export function LoansRow() {
  const [n, setN] = useState(null)
  useEffect(() => { getMyLoanRequests().then(r => setN((r || []).filter(x => x.status === "pending").length)).catch(() => setN(0)) }, [])
  return (
    <AccRow brand="loan" label="השאלות שלי" sub={n ? (n === 1 ? "הזמנה פתוחה אחת" : `${n} הזמנות פתוחות`) : "הזמנות לשחק בהשאלה, ומשחקים שמחפשים שחקן"}
      to="/loans" trailing={n ? <AccChip tone="accent">{n}</AccChip> : undefined} chevron />
  )
}
