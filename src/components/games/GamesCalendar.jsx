import { useState, useEffect, useMemo } from "react"
import { format } from "date-fns"
import { FileSpreadsheet, Copy, Check, X } from "lucide-react"
import { DocumentIcon as FileText, CalendarPlus } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { toCsv, toXlsx, downloadBlob } from "@/lib/scheduleExport"
import { isIOS, isAndroid, isMobile, isInAppBrowser } from "@/lib/device"
import { ilDate } from "@/lib/ilTime"
import { teamIsLight, teamTint } from "@/lib/flTeam"

/**
 * The season calendar on /games (SeasonCalendar board): a month grid, Sunday → Saturday
 * (RTL puts Sunday on the right), a dot per game on game days, the picked day dark.
 *
 * It shows the SAME games as the list: the parent hands in its filtered set minus the
 * date filter, and picking a day sets that date filter. So the page's competition / team
 * / status filters drive the calendar, and the calendar drives the list.
 *
 * `CalendarSheet` = "ליומן שלי": the live calendar subscription + Excel / CSV export.
 */

const DAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]

const dayKey = (d) => format(d, "yyyy-MM-dd")
const monthIdx = (d) => d.getFullYear() * 12 + d.getMonth()
const dotColor = (t) => (t ? (teamIsLight(t) ? "#A3A3A3" : teamTint(t)) : "rgb(var(--fg-muted))")

// The feed is a Vercel function, so it only exists on a deployed host. Anywhere else
// (localhost) point at the public site rather than hand out a dead link.
function feedOrigin() {
  const h = typeof window !== "undefined" ? window.location.hostname : ""
  return h.endsWith("rinkhockeyil.com") || h.endsWith(".vercel.app") ? window.location.origin : "https://rinkhockeyil.com"
}

export default function GamesCalendar({ games, teamsMap, selectedDate, onSelectDate }) {
  const sorted = useMemo(
    () => [...games].filter(g => g.game_date).sort((a, b) => new Date(a.game_date) - new Date(b.game_date)),
    [games],
  )
  const byDay = useMemo(() => {
    const m = {}
    for (const g of sorted) (m[dayKey(ilDate(g.game_date))] ||= []).push(g)
    return m
  }, [sorted])

  const firstM = sorted.length ? monthIdx(ilDate(sorted[0].game_date)) : monthIdx(new Date())
  const lastM = sorted.length ? monthIdx(ilDate(sorted[sorted.length - 1].game_date)) : firstM
  const nextGame = sorted.find(g => new Date(g.game_date) >= new Date()) || null

  // Open on the month of the next game (or the last month, once the season is over).
  const [cursor, setCursor] = useState(null)
  useEffect(() => {
    if (!sorted.length) return
    setCursor(c => {
      if (c != null && c >= firstM && c <= lastM) return c
      return nextGame ? monthIdx(ilDate(nextGame.game_date)) : lastM
    })
  }, [firstM, lastM, sorted.length])

  // A date picked in the filter bar should bring its month into view.
  useEffect(() => {
    if (selectedDate) setCursor(monthIdx(new Date(`${selectedDate}T12:00:00`)))
  }, [selectedDate])

  const pickDay = (key) => onSelectDate(key === selectedDate ? "" : key)
  const month = cursor ?? firstM
  const y = Math.floor(month / 12), m = month % 12
  const monthDays = Object.keys(byDay).filter(k => { const d = new Date(`${k}T12:00:00`); return d.getFullYear() === y && d.getMonth() === m })
  const nextIl = nextGame ? ilDate(nextGame.game_date) : null

  return (
    <section className="fl-card p-2.5 sm:p-4" aria-label="לוח משחקים חודשי">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setCursor(month - 1)} disabled={month <= firstM}
          aria-label="החודש הקודם" className="size-11 rounded-full bg-surface-page text-[18px] font-extrabold text-fg-strong disabled:opacity-30">›</button>
        <span className="text-[17px] font-extrabold text-fg-strong">{MONTHS[m]} {y}</span>
        <button type="button" onClick={() => setCursor(month + 1)} disabled={month >= lastM}
          aria-label="החודש הבא" className="size-11 rounded-full bg-surface-page text-[18px] font-extrabold text-fg-strong disabled:opacity-30">‹</button>
      </div>
      {sorted.length === 0 ? (
        <p className="text-center text-sm text-fg-muted py-8">אין משחקים תואמים לסינון</p>
      ) : (
        <MonthGrid y={y} m={m} byDay={byDay} teamsMap={teamsMap} selected={selectedDate} onPick={pickDay} />
      )}
      <p className="text-[12px] text-fg-muted mt-2 px-1">
        {monthDays.length} ימי משחקים בחודש
        {nextIl && <> · הבא: {DAY_NAMES[nextIl.getDay()]} <bdi dir="ltr">{format(nextIl, "d.M")}</bdi></>}
      </p>
    </section>
  )
}

function MonthGrid({ y, m, byDay, teamsMap, selected, onPick }) {
  const first = new Date(y, m, 1)
  const days = new Date(y, m + 1, 0).getDate()
  const today = dayKey(new Date())
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1)),
  ]

  return (
    <div className="mt-2">
      <div className="grid grid-cols-7 gap-[3px] text-center text-[11.5px] font-bold text-fg-muted">
        {DAY_LABELS.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-[3px] mt-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />
          const key = dayKey(d)
          const list = byDay[key] || []
          const isSel = key === selected
          const base = "min-h-[46px] sm:min-h-[64px] rounded-[12px] flex flex-col items-center justify-center gap-[3px] text-[14px]"
          if (!list.length) {
            return (
              <span key={key} className={`${base} font-medium text-fg-strong ${key === today ? "ring-1 ring-fl-accent" : ""}`}>{d.getDate()}</span>
            )
          }
          return (
            <button key={key} type="button" onClick={() => onPick(key)} aria-pressed={isSel}
              aria-label={`${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[m]} — ${list.length} משחקים`}
              className={`${base} font-extrabold transition-colors ${isSel ? "bg-fg-strong text-surface" : "bg-surface-page text-fg-strong hover:bg-surface-sunken"}`}>
              {d.getDate()}
              {/* phone: a dot per game; wider: each game as crest · time · crest */}
              <span className="flex gap-0.5 h-[5px] sm:hidden" aria-hidden="true">
                {list.slice(0, 4).map(g => (
                  <span key={g.id} className="size-[5px] rounded-full" style={{ background: isSel ? "rgb(var(--fl-accent))" : dotColor(teamsMap[g.home_team_id]) }} />
                ))}
              </span>
              <span className="hidden sm:flex flex-col gap-0.5 w-full px-1" aria-hidden="true">
                {list.slice(0, 3).map(g => (
                  <span key={g.id} dir="ltr" className="flex items-center justify-between gap-0.5">
                    <TeamLogo team={teamsMap[g.away_team_id]} px={16} />
                    <span className={`text-[10px] tabular-nums font-semibold ${isSel ? "text-surface/90" : "text-fg-muted"}`}>{format(ilDate(g.game_date), "HH:mm")}</span>
                    <TeamLogo team={teamsMap[g.home_team_id]} px={16} />
                  </span>
                ))}
                {list.length > 3 && <span className="text-[10px] text-center">+{list.length - 3}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "ליומן שלי": subscribe (my team / all league) + the season as Excel / CSV. */
export function CalendarSheet({ games, teamsMap, team, seasonName, onClose }) {
  const sorted = [...games].filter(g => g.game_date).sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
  const fileBase = `לוח-משחקים${seasonName ? `-${seasonName}` : ""}${team ? `-${team.name.replace(/\s+/g, "-")}` : ""}`
  const exportXlsx = () => downloadBlob(toXlsx(sorted, teamsMap), `${fileBase}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  const exportCsv = () => downloadBlob(toCsv(sorted, teamsMap), `${fileBase}.csv`, "text/csv;charset=utf-8")
  return (
    <div className="flex flex-col gap-3">
      <SubscribePanel team={team} onClose={onClose} />
      <div className="fl-card p-3 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold text-fg-strong me-auto">הלוח כקובץ ({sorted.length} משחקים)</span>
        <button type="button" onClick={exportXlsx} disabled={!sorted.length} className="btn btn-secondary btn-sm">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
        </button>
        <button type="button" onClick={exportCsv} disabled={!sorted.length} className="btn btn-secondary btn-sm">
          <FileText className="w-4 h-4" /> CSV
        </button>
      </div>
    </div>
  )
}

// What a subscribe link can actually do depends on the device, not just the browser:
//  - webcal:// only has a handler on Apple devices (Android: dead tap),
//  - in-app browsers (WhatsApp, Instagram…) block webcal: even on iPhone,
//  - Google Calendar can subscribe by URL ONLY from desktop web; its phone app and
//    mobile site add nothing. A calendar added on a computer syncs to the phone by itself.
function subscribeMode() {
  if (isIOS()) return isInAppBrowser() ? "ios-inapp" : "ios"
  if (isAndroid() || isMobile()) return "phone"
  return "desktop"
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* in-app browsers often refuse */ }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch { return false }
}

function GoogleFromComputerSteps() {
  return (
    <ol className="list-decimal pr-5 space-y-1 text-xs text-fg-muted">
      <li>העתיקו את הקישור (או שלחו אותו לעצמכם).</li>
      <li>במחשב: היכנסו ל־<bdi dir="ltr">calendar.google.com</bdi></li>
      <li>"יומנים אחרים" ← "+" ← "מכתובת URL"</li>
      <li>הדביקו את הקישור — היומן יסתנכרן לטלפון לבד.</li>
    </ol>
  )
}

function SubscribePanel({ team, onClose }) {
  const [scope, setScope] = useState(team ? "team" : "all")
  const [copied, setCopied] = useState(false)
  const [mode] = useState(subscribeMode)
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"
  useEffect(() => { if (!team) setScope("all") }, [team])

  const useTeam = scope === "team" && team
  const https = `${feedOrigin()}/api/calendar${useTeam ? `?team=${encodeURIComponent(team.slug || team.id)}` : ""}`
  const webcal = https.replace(/^https?:/, "webcal:")
  // cid = the https URL (not webcal): webcal→http makes Google take an extra 308 hop to https.
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(https)}`
  const calName = useTeam ? `משחקי ${team.name}` : "לוח משחקי הליגה"

  const copy = async () => {
    if (await copyText(https)) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }
  const share = async () => {
    try { await navigator.share({ title: calName, text: `${calName} — להוספה ליומן Google מהמחשב:`, url: https }) }
    catch { /* user cancelled */ }
  }

  const copyBtn = (cls) => (
    <button type="button" onClick={copy} className={`btn ${cls} btn-sm`}>
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "הועתק ✓" : "העתק קישור"}
    </button>
  )

  return (
    <div className="fl-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-extrabold text-fg-strong text-[18px]">הוספת הלוח ליומן שלך</p>
          <p className="text-xs text-fg-muted mt-0.5">
            זה מנוי, לא קובץ: כשמשחק יוזז — הוא יתעדכן אצלך ביומן לבד.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="סגור" className="size-11 -m-2 flex items-center justify-center rounded-full hover:bg-surface-sunken">
          <X className="w-4 h-4 text-fg-muted" />
        </button>
      </div>

      {team && (
        <div className="tab-bar !p-0.5 w-fit">
          <button type="button" onClick={() => setScope("team")}
            className={`${scope === "team" ? "tab-active" : "tab-inactive"} !py-1.5 !px-3 !text-xs whitespace-nowrap`}>{team.name}</button>
          <button type="button" onClick={() => setScope("all")}
            className={`${scope === "all" ? "tab-active" : "tab-inactive"} !py-1.5 !px-3 !text-xs whitespace-nowrap`}>כל הליגה</button>
        </div>
      )}

      {mode === "ios" && (
        <>
          <div className="flex flex-wrap gap-2">
            <a href={webcal} className="btn btn-primary btn-sm"><CalendarPlus className="w-4 h-4" /> הוספה ליומן האייפון</a>
            {copyBtn("btn-ghost")}
          </div>
          <p className="text-[11px] text-fg-subtle">אישור אחד ב"הירשם", וזהו.</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted">משתמשים ביומן <bdi>Google</bdi>?</summary>
            <p className="text-[11px] text-fg-subtle mt-1.5 mb-1">
              <bdi>Google</bdi> מאפשר להוסיף יומן מקישור רק מהמחשב:
            </p>
            <GoogleFromComputerSteps />
          </details>
        </>
      )}

      {mode === "ios-inapp" && (
        <>
          <div className="rounded-lg bg-surface-sunken p-2.5 space-y-1.5">
            <p className="text-xs font-bold text-fg-strong">כדי להוסיף ליומן, פתחו את הדף בספארי</p>
            <ol className="list-decimal pr-5 space-y-1 text-xs text-fg-muted">
              <li>לחצו על <bdi>⋯</bdi> או על סמל השיתוף בפינת המסך.</li>
              <li>בחרו "פתיחה בספארי".</li>
              <li>שם — "הוספה ליומן האייפון", ואישור ב"הירשם".</li>
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">{copyBtn("btn-secondary")}</div>
          <p className="text-[11px] text-fg-subtle">אפשר גם להעתיק את הקישור ולהדביק אותו בספארי.</p>
        </>
      )}

      {mode === "phone" && (
        <>
          <div className="rounded-lg bg-surface-sunken p-2.5 space-y-1.5">
            <p className="text-xs font-bold text-fg-strong">
              יומן <bdi>Google</bdi> מוסיף יומן מקישור רק מהמחשב
            </p>
            <GoogleFromComputerSteps />
          </div>
          <div className="flex flex-wrap gap-2">
            {copyBtn("btn-primary")}
            {canShare && (
              <button type="button" onClick={share} className="btn btn-secondary btn-sm">שליחה לעצמי</button>
            )}
          </div>
        </>
      )}

      {mode === "desktop" && (
        <>
          <div className="flex flex-wrap gap-2">
            <a href={google} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">יומן <bdi>Google</bdi></a>
            <a href={webcal} className="btn btn-secondary btn-sm">יומן אפל / <bdi>Outlook</bdi></a>
            {copyBtn("btn-ghost")}
          </div>
          <p className="text-[11px] text-fg-subtle">
            אחרי ההוספה ביומן <bdi>Google</bdi> הוא יופיע גם בטלפון. עדכון של משחק שזז יכול לקחת שם עד יום.
            <br /><bdi>Outlook</bdi> באינטרנט: "העתק קישור" והוספה כיומן מאינטרנט.
          </p>
        </>
      )}
    </div>
  )
}
