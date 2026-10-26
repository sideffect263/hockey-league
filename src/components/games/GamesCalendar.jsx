import { useState, useEffect, useMemo } from "react"
import { Link } from "react-router-dom"
import { format } from "date-fns"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown, ChevronRight, ChevronLeft, LayoutGrid, List, FileSpreadsheet, FileText, Copy, Check, X } from "lucide-react"
import { CalendarDays, CalendarPlus } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { entityPath } from "@/lib/slugs"
import { toCsv, toXlsx, downloadBlob } from "@/lib/scheduleExport"
import { isIOS, isAndroid, isMobile, isInAppBrowser } from "@/lib/device"
import { ilDate } from "@/lib/ilTime"

/**
 * Season calendar at the top of /games — the whole schedule at a glance, plus the
 * ways to take it with you (Excel/CSV, or a live calendar subscription).
 *
 * It shows the SAME games as the list below it: the parent hands in its filtered set
 * minus the date filter, and picking a day here sets that date filter. So the page's
 * competition/team/status filters drive the calendar, and the calendar drives the list.
 *
 * The Israeli week starts on Sunday, so the grid does too (RTL puts Sunday on the right).
 */

const DAY_LABELS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"]
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
const OPEN_KEY = "games-calendar-open"
const VIEW_KEY = "games-calendar-view"

const dayKey = (d) => format(d, "yyyy-MM-dd")
const monthIdx = (d) => d.getFullYear() * 12 + d.getMonth()

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value) } catch { /* private mode — the default is fine */ }
}

// The feed is a Vercel function, so it only exists on a deployed host. Anywhere else
// (localhost) point at the public site rather than hand out a dead link.
function feedOrigin() {
  const h = typeof window !== "undefined" ? window.location.hostname : ""
  return h.endsWith("rinkhockeyil.com") || h.endsWith(".vercel.app") ? window.location.origin : "https://rinkhockeyil.com"
}

export default function GamesCalendar({ games, teamsMap, selectedDate, onSelectDate, team, seasonName }) {
  const [open, setOpen] = useState(() => readPref(OPEN_KEY, "1") === "1")
  const [view, setView] = useState(() => readPref(VIEW_KEY,
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches ? "list" : "month"))
  const [subOpen, setSubOpen] = useState(false)

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

  const toggleOpen = () => setOpen(o => { writePref(OPEN_KEY, o ? "0" : "1"); return !o })
  const pickView = (v) => { setView(v); writePref(VIEW_KEY, v) }
  const pickDay = (key) => onSelectDate(key === selectedDate ? "" : key)

  const month = cursor ?? firstM
  const y = Math.floor(month / 12), m = month % 12
  const fileBase = `לוח-משחקים${seasonName ? `-${seasonName}` : ""}${team ? `-${team.name.replace(/\s+/g, "-")}` : ""}`

  const exportXlsx = () => downloadBlob(toXlsx(sorted, teamsMap), `${fileBase}.xlsx`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  const exportCsv = () => downloadBlob(toCsv(sorted, teamsMap), `${fileBase}.csv`, "text/csv;charset=utf-8")

  return (
    <section className="card overflow-hidden" aria-label="לוח משחקים עונתי">
      {/* Header — always visible; the rest collapses */}
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-right hover:bg-surface-sunken/60 transition-colors"
      >
        <span className="w-9 h-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
          <CalendarDays className="w-5 h-5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-fg-strong">לוח העונה{seasonName && <> <bdi dir="ltr">{seasonName}</bdi></>}</span>
          <span className="block text-xs text-fg-muted truncate">
            {sorted.length} משחקים{team && ` · ${team.name}`}
            {nextGame && <> · הבא: <span dir="ltr">{format(ilDate(nextGame.game_date), "d/M HH:mm")}</span></>}
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-3 sm:px-5 py-4 space-y-4">
              {/* Toolbar: month nav · view · export */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setCursor(month - 1)} disabled={month <= firstM}
                    aria-label="החודש הקודם" className="p-1.5 rounded-lg hover:bg-surface-sunken disabled:opacity-30">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="min-w-[7.5rem] text-center font-semibold text-fg-strong">{MONTHS[m]} {y}</span>
                  <button type="button" onClick={() => setCursor(month + 1)} disabled={month >= lastM}
                    aria-label="החודש הבא" className="p-1.5 rounded-lg hover:bg-surface-sunken disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>

                <div className="tab-bar !p-0.5">
                  <button type="button" onClick={() => pickView("month")} aria-pressed={view === "month"}
                    className={`${view === "month" ? "tab-active" : "tab-inactive"} !py-1.5 !px-2.5 !text-xs`}>
                    <LayoutGrid className="w-3.5 h-3.5" /> חודש
                  </button>
                  <button type="button" onClick={() => pickView("list")} aria-pressed={view === "list"}
                    className={`${view === "list" ? "tab-active" : "tab-inactive"} !py-1.5 !px-2.5 !text-xs`}>
                    <List className="w-3.5 h-3.5" /> רשימה
                  </button>
                </div>

                <div className="flex items-center gap-1.5 ms-auto">
                  <button type="button" onClick={exportXlsx} disabled={!sorted.length} className="btn btn-secondary btn-sm">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button type="button" onClick={exportCsv} disabled={!sorted.length} className="btn btn-secondary btn-sm">
                    <FileText className="w-3.5 h-3.5" /> CSV
                  </button>
                  <button type="button" onClick={() => setSubOpen(s => !s)} aria-expanded={subOpen} className="btn btn-primary btn-sm">
                    <CalendarPlus className="w-3.5 h-3.5" /> סנכרון ליומן
                  </button>
                </div>
              </div>

              {subOpen && <SubscribePanel team={team} onClose={() => setSubOpen(false)} />}

              {sorted.length === 0 ? (
                <p className="text-center text-sm text-fg-muted py-8">אין משחקים תואמים לסינון</p>
              ) : view === "month" ? (
                <MonthGrid y={y} m={m} byDay={byDay} teamsMap={teamsMap} selected={selectedDate} onPick={pickDay} />
              ) : (
                <MonthList y={y} m={m} byDay={byDay} teamsMap={teamsMap} selected={selectedDate} onPick={pickDay} />
              )}

              {selectedDate && (
                <button type="button" onClick={() => onSelectDate("")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  <X className="w-3.5 h-3.5" /> הצג את כל המשחקים
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_LABELS.map(d => <div key={d} className="text-center text-[11px] font-semibold text-fg-subtle">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />
          const key = dayKey(d)
          const list = byDay[key] || []
          const isSel = key === selected
          // Only game days are tall: a league that plays on Saturdays would otherwise spend
          // most of the grid on empty weekday boxes.
          const base = "min-h-[2.25rem] rounded-xl p-1 sm:p-1.5 text-right flex flex-col gap-1 transition-colors"
          if (!list.length) {
            return (
              <div key={key} className={`${base} ${key === today ? "ring-1 ring-brand/40" : ""}`}>
                <span className="text-[11px] text-fg-subtle">{d.getDate()}</span>
              </div>
            )
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={isSel}
              aria-label={`${d.getDate()} ${MONTHS[m]} — ${list.length} משחקים`}
              className={`${base} ${isSel ? "bg-brand text-white" : "bg-brand/[0.07] hover:bg-brand/[0.14] dark:bg-brand/15 dark:hover:bg-brand/25"}`}
            >
              <span className={`text-[11px] font-bold ${isSel ? "text-white" : "text-fg-strong"}`}>{d.getDate()}</span>
              {/* phone: a count; wider: each game as crest · time · crest */}
              <span className={`sm:hidden text-[10px] font-semibold ${isSel ? "text-white/90" : "text-brand"}`}>{list.length} משחקים</span>
              <span className="hidden sm:flex flex-col gap-0.5">
                {list.slice(0, 3).map(g => (
                  <span key={g.id} className="flex items-center justify-between gap-0.5">
                    <TeamLogo team={teamsMap[g.home_team_id]} size={5} />
                    <span dir="ltr" className={`text-[10px] tabular-nums ${isSel ? "text-white/90" : "text-fg-muted"}`}>
                      {format(ilDate(g.game_date), "HH:mm")}
                    </span>
                    <TeamLogo team={teamsMap[g.away_team_id]} size={5} />
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

function MonthList({ y, m, byDay, teamsMap, selected, onPick }) {
  const keys = Object.keys(byDay).filter(k => {
    const d = new Date(`${k}T12:00:00`)
    return d.getFullYear() === y && d.getMonth() === m
  }).sort()

  if (!keys.length) return <p className="text-center text-sm text-fg-muted py-6">אין משחקים בחודש הזה</p>

  return (
    <div className="space-y-3">
      {keys.map(k => {
        const d = new Date(`${k}T12:00:00`)
        const isSel = k === selected
        return (
          <div key={k} className={`rounded-xl border ${isSel ? "border-brand bg-brand/[0.05]" : "border-line"}`}>
            <button type="button" onClick={() => onPick(k)} aria-pressed={isSel}
              className="w-full flex items-center justify-between px-3 py-2 text-sm font-bold text-fg-strong">
              <span>יום {DAY_NAMES[d.getDay()]} · <span dir="ltr">{format(d, "d/M/yyyy")}</span></span>
              <span className="text-xs font-semibold text-brand">{isSel ? "מסונן ✓" : "סנן יום זה"}</span>
            </button>
            <ul className="divide-y divide-line border-t border-line">
              {byDay[k].map(g => {
                const h = teamsMap[g.home_team_id], a = teamsMap[g.away_team_id]
                return (
                  <li key={g.id}>
                    <Link to={entityPath("games", g)} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 hover:bg-surface-sunken/60 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <TeamLogo team={h} size={6} /><span className="line-clamp-2 leading-tight">{h?.name || "—"}</span>
                      </span>
                      <span className="text-center leading-tight">
                        <span dir="ltr" className="block font-bold tabular-nums text-fg-strong">
                          {g.status === "completed" && g.home_score != null ? `${g.away_score}:${g.home_score}` : format(ilDate(g.game_date), "HH:mm")}
                        </span>
                        {g.venue && <span className="block text-[10px] text-fg-subtle">{g.venue}</span>}
                      </span>
                      <span className="flex items-center gap-2 min-w-0 justify-end">
                        <span className="line-clamp-2 leading-tight text-left">{a?.name || "—"}</span><TeamLogo team={a} size={6} />
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
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
    <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-3 sm:p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-fg-strong text-sm">הוספת הלוח ליומן שלך</p>
          <p className="text-xs text-fg-muted mt-0.5">
            זה מנוי, לא קובץ: כשמשחק יוזז — הוא יתעדכן אצלך ביומן לבד.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="סגור" className="p-1 rounded-lg hover:bg-surface-sunken">
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
            <a href={webcal} className="btn btn-primary btn-sm"><CalendarPlus className="w-3.5 h-3.5" /> הוספה ליומן האייפון</a>
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
