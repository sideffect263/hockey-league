import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  TestTube2, RefreshCw, Copy, Check, Info, Smartphone, Search, AlertTriangle, CheckCircle2,
  Clock, MessageCircle, Store, Plus,
} from "lucide-react"
import {
  getAndroidTesters, getAndroidTesterHealth, getAndroidTesterStatus, setAndroidTesterStatus, getAndroidLatestVersion,
} from "@/lib/appUsers"
import { entityPath } from "@/lib/slugs"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * בודקי אפליקציה — running the Google Play closed test. Play wants 12+ testers who opt
 * in with a Google account on an Android device and stay in for 14 days, and Play
 * Console only ever shows a COUNT. This tab answers "who": everyone who has used the
 * Android app with a Google address (admin_android_testers), joined with
 *  - telemetry per user (admin_android_tester_health): is the app working for them,
 *    which version, how many of the last 14 days they used it, crashes on their device;
 *  - hand-kept flags per Google address (android_tester_status): on the Play list,
 *    in the WhatsApp group, opted in. From Android 1.5.2 (62) the app reports its
 *    installer, so "installed from Play" counts as opted in without ticking.
 * Admin-only throughout. See supabase/android-testers.sql + android-tester-health.sql.
 */

const PLAY_MIN_TESTERS = 12
const PLAY_DAYS = 14
const PLAY_INSTALLER = "com.android.vending"

const SORT_OPTIONS = [
  { key: "seen", label: "נראה לאחרונה", dir: "desc" },
  { key: "state", label: "מצב", dir: "asc" },
  { key: "name", label: "שם", dir: "asc" },
  { key: "days", label: "ימים פעילים", dir: "desc" },
]

const FILTERS = [
  { key: "all", label: "הכול" },
  { key: "not_opted", label: "לא הצטרפו" },
  { key: "not_group", label: "לא בקבוצה" },
  { key: "problem", label: "קריסות" },
  { key: "idle", label: "לא פעילים" },
]

// worst first when sorting by state
const STATE_ORDER = { crashing: 0, idle: 1, quiet: 2, working: 3 }

/** Hebrew relative day count — "היום", "אתמול", "לפני 12 ימים". */
function daysAgo(iso) {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return "היום"
  if (d === 1) return "אתמול"
  return `לפני ${d} ימים`
}

function daysSince(iso) {
  return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity
}

/** "1.5.1 (61)" → 61 */
function versionCode(v) {
  const m = /\((\d+)\)/.exec(v || "")
  return m ? Number(m[1]) : null
}

/** 052-123 4567 → https://wa.me/972521234567 (Israeli mobiles only; null otherwise). */
function waLink(phone) {
  const digits = (phone || "").replace(/\D/g, "")
  if (/^05\d{8}$/.test(digits)) return `https://wa.me/972${digits.slice(1)}`
  if (/^9725\d{8}$/.test(digits)) return `https://wa.me/${digits}`
  return null
}

/** Working / crashing / quiet / idle, from the telemetry row. */
function stateOf(h, lastSeen) {
  if (h?.last_crash_at && (!h.last_android_at || new Date(h.last_crash_at) > new Date(h.last_android_at))) return "crashing"
  const d = daysSince(lastSeen)
  if (d <= 3) return "working"
  if (d <= 7) return "quiet"
  return "idle"
}

const STATE_BADGE = {
  working: { label: "עובד", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", Icon: CheckCircle2 },
  quiet: { label: "שקט", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", Icon: Clock },
  idle: { label: "לא פעיל", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400", Icon: Clock },
  crashing: { label: "קורס", cls: "bg-red-500/10 text-red-700 dark:text-red-400", Icon: AlertTriangle },
}

function Toggle({ on, onClick, children, busy }) {
  return (
    <button onClick={onClick} disabled={busy} aria-pressed={on}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-50 ${
        on
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
          : "border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}>
      {on ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-current opacity-60" />}
      {children}
    </button>
  )
}

/** 14 squares, one per day of Play's window — filled = the app was used that day. */
function DaysMeter({ days }) {
  const n = Math.max(0, Math.min(PLAY_DAYS, days || 0))
  return (
    <span className="inline-flex items-center gap-1.5" title={`${n} מתוך ${PLAY_DAYS} הימים האחרונים`}>
      <span className="inline-flex gap-[2px]" dir="ltr">
        {Array.from({ length: PLAY_DAYS }, (_, i) => (
          <span key={i} className={`w-1.5 h-3 rounded-[2px] ${i < n ? "bg-brand" : "bg-slate-200 dark:bg-slate-700"}`} />
        ))}
      </span>
      <span className="tabular-nums">{n}/{PLAY_DAYS}</span>
    </span>
  )
}

function Stat({ value, label, sub, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900 dark:text-white",
    green: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
  }
  return (
    <div className="card p-3.5 min-w-0">
      <div className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</div>
      {sub && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function AndroidTestersAdmin() {
  const [rows, setRows] = useState([])
  const [health, setHealth] = useState({})
  const [status, setStatus] = useState({})
  const [latest, setLatest] = useState({ code: null, name: null })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sort, setSort] = useState({ key: "state", dir: "asc" })
  const [filter, setFilter] = useState("all")
  const [q, setQ] = useState("")
  const [copied, setCopied] = useState(null) // "all" | user_id
  const [busy, setBusy] = useState(null) // email being saved
  const [newEmail, setNewEmail] = useState("")

  const load = async () => {
    setLoading(true); setErr(null)
    try {
      const [t, h, s, v] = await Promise.all([
        getAndroidTesters(), getAndroidTesterHealth(), getAndroidTesterStatus(), getAndroidLatestVersion().catch(() => ({})),
      ])
      setRows(t)
      setHealth(Object.fromEntries(h.map(r => [r.user_id, r])))
      setStatus(Object.fromEntries(s.map(r => [r.email, r])))
      setLatest(v || {})
    } catch (e) { setErr(e.message || "שגיאה") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async (email, patch) => {
    const key = (email || "").toLowerCase()
    if (!key) return
    setBusy(key)
    const prev = status[key]
    setStatus(s => ({ ...s, [key]: { email: key, on_play_list: false, in_group: false, opted_in: false, note: null, ...s[key], ...patch } }))
    try {
      const row = await setAndroidTesterStatus(key, {
        onPlayList: patch.on_play_list, inGroup: patch.in_group, optedIn: patch.opted_in,
        note: patch.note === undefined ? undefined : (patch.note ?? ""),
      })
      setStatus(s => ({ ...s, [key]: row }))
    } catch (e) {
      setStatus(s => ({ ...s, [key]: prev }))
      setErr(e.message || "השמירה נכשלה")
    } finally { setBusy(null) }
  }

  // One enriched row per app user.
  // A person can be on the Play list under any of their addresses (login vs Google
  // account differ after a merge), so the flags row is whichever of them has one.
  const people = useMemo(() => rows.map(r => {
    const h = health[r.user_id]
    const addresses = [r.play_email, r.google_email, r.auth_email].filter(Boolean).map(e => e.toLowerCase())
    const email = addresses.find(e => status[e]) || addresses[0] || ""
    const st = status[email] || {}
    const fromPlay = h?.installer === PLAY_INSTALLER
    const ver = h?.app_version || r.android_version
    const lastSeen = [h?.last_android_at, r.android_last_seen].filter(Boolean).sort().pop() || null
    return {
      ...r, h, email, st, fromPlay, ver, lastSeen,
      state: stateOf(h, lastSeen),
      optedIn: !!st.opted_in || fromPlay,
      outdated: latest.code && versionCode(ver) ? versionCode(ver) < latest.code : false,
    }
  }), [rows, health, status, latest])

  // Play-list / hand-added addresses that match no app user (e.g. a second Google account).
  const orphans = useMemo(() => {
    const known = new Set(people.flatMap(p => [p.email, p.google_email, p.auth_email?.toLowerCase()]).filter(Boolean))
    return Object.values(status).filter(s => !known.has(s.email)).sort((a, b) => a.email.localeCompare(b.email))
  }, [people, status])

  const counts = useMemo(() => {
    const all = [...people.map(p => ({ play: !!p.st.on_play_list, group: !!p.st.in_group, opted: p.optedIn })),
      ...orphans.map(o => ({ play: o.on_play_list, group: o.in_group, opted: o.opted_in }))]
    return {
      play: all.filter(x => x.play).length,
      group: all.filter(x => x.group).length,
      opted: all.filter(x => x.opted).length,
      working: people.filter(p => p.state === "working").length,
      crashing: people.filter(p => p.state === "crashing").length,
    }
  }, [people, orphans])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    let list = people.filter(p => {
      if (filter === "not_opted" && p.optedIn) return false
      if (filter === "not_group" && p.st.in_group) return false
      if (filter === "problem" && !(p.state === "crashing" || (p.h?.crashes_7d || 0) > 0)) return false
      if (filter === "idle" && !(p.state === "idle" || p.state === "quiet")) return false
      if (s && !`${p.display_name || ""} ${p.player_name || ""} ${p.team_name || ""} ${p.play_email || ""}`.toLowerCase().includes(s)) return false
      return true
    })
    return sortItems(list, sort, {
      seen: p => (p.lastSeen ? new Date(p.lastSeen).getTime() : null),
      state: p => STATE_ORDER[p.state],
      name: p => p.display_name || p.player_name || "",
      days: p => p.h?.active_days_14 ?? 0,
    })
  }, [people, sort, q, filter])

  const allEmails = useMemo(() => [...new Set(rows.map(r => r.play_email).filter(Boolean))], [rows])

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1800)
    } catch { /* clipboard blocked — nothing useful to do */ }
  }

  const addEmail = async e => {
    e.preventDefault()
    const v = newEmail.trim().toLowerCase()
    if (!v.includes("@")) return
    await save(v, { on_play_list: true })
    setNewEmail("")
  }

  const enough = counts.opted >= PLAY_MIN_TESTERS

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TestTube2 className="w-5 h-5 text-brand" /> בודקי אפליקציה
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            בדיקה סגורה ב־Google Play: צריך לפחות {PLAY_MIN_TESTERS} בודקים שמצטרפים ונשארים {PLAY_DAYS} יום ברציפות.
            {latest.name && <> הגרסה העדכנית: <span dir="ltr" className="font-semibold">{latest.name} ({latest.code})</span>.</>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> רענון
        </button>
      </div>

      {err && <div className="card p-4 text-sm text-red-600 dark:text-red-400">שגיאה: {err}</div>}

      {loading && !rows.length && !err ? <SkeletonPanelRows /> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <Stat value={`${counts.opted}/${PLAY_MIN_TESTERS}`} label="הצטרפו לבדיקה" tone={enough ? "green" : "amber"}
              sub={enough ? "מעל הסף" : `חסרים ${PLAY_MIN_TESTERS - counts.opted}`} />
            <Stat value={counts.play} label="ברשימת Play" />
            <Stat value={counts.group} label="בקבוצת הוואטסאפ" />
            <Stat value={counts.working} label="האפליקציה עובדת" sub="פעילים ב־3 ימים" tone="green" />
            <Stat value={counts.crashing} label="קורסים עכשיו" tone={counts.crashing ? "red" : "slate"} />
          </div>

          <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Info className="w-4 h-4 shrink-0 mt-px" />
            <span>
              Play Console מראה רק כמה הצטרפו, לא מי — לכן מסמנים כאן ידנית. מגרסה 1.5.2 (62) האפליקציה מדווחת אם הותקנה מ־Play,
              ומי שהתקין משם נספר אוטומטית. קריסות בפתיחה מגיעות בלי משתמש, ולכן משויכות לפי דגם המכשיר.
            </span>
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  filter === f.key
                    ? "bg-brand text-white border-brand"
                    : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}>
                {f.label}
              </button>
            ))}
            <button onClick={() => copy(allEmails.join(", "), "all")} disabled={!allEmails.length}
              className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              {copied === "all" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === "all" ? "הועתק" : `העתק ${allEmails.length} מיילים ל־Play`}
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <SortBar options={SORT_OPTIONS} sort={sort} onChange={setSort} />
            <label className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שם / שחקן / קבוצה / מייל"
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
          </div>

          <ul className="space-y-2">
            {shown.map(p => {
              const badge = STATE_BADGE[p.state]
              const wa = waLink(p.h?.phone)
              const crashedRecently = (p.h?.crashes_7d || 0) > 0
              return (
                <li key={p.user_id} className="card p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">{p.display_name || p.player_name || "ללא שם"}</div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 min-w-0">
                        <span className="truncate" dir="ltr">{p.st.email || p.play_email}</span>
                        <button onClick={() => copy(p.st.email || p.play_email, p.user_id)} aria-label="העתק מייל"
                          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800">
                          {copied === p.user_id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${badge.cls}`}>
                        <badge.Icon className="w-3 h-3" /> {badge.label}
                      </span>
                      {p.fromPlay && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand/10 text-brand">
                          <Store className="w-3 h-3" /> מ־Play
                        </span>
                      )}
                      <span dir="ltr" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                        p.outdated ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-slate-500/10 text-slate-600 dark:text-slate-300"}`}>
                        <Smartphone className="w-3 h-3" /> {p.ver || "—"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-slate-600 dark:text-slate-300">
                    <span>פעיל: <span className="font-semibold">{daysAgo(p.lastSeen) || "—"}</span></span>
                    <DaysMeter days={p.h?.active_days_14} />
                    {p.h?.device && <span dir="ltr" className="text-slate-500">{p.h.device}{p.h.os ? ` · ${p.h.os}` : ""}</span>}
                    {p.h?.errors_7d > 0 && <span className="text-amber-700 dark:text-amber-400">{p.h.errors_7d} שגיאות השבוע</span>}
                    {p.team_name && <span>קבוצה: <span className="font-semibold">{p.team_name}</span></span>}
                    {p.player_id && (
                      <Link to={entityPath("players", p.player_id)} className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                        כרטיס שחקן
                      </Link>
                    )}
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                        <MessageCircle className="w-3.5 h-3.5" /> וואטסאפ
                      </a>
                    )}
                  </div>

                  {crashedRecently && (
                    <div className={`text-[11px] rounded-lg px-2.5 py-1.5 ${p.state === "crashing"
                      ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-slate-500/5 text-slate-600 dark:text-slate-400"}`}>
                      {p.state === "crashing" ? "קורס בפתיחה" : "קרס השבוע ומאז עובד"} · {p.h.crashes_7d} קריסות על המכשיר הזה, האחרונה {daysAgo(p.h.last_crash_at)}
                      {p.h.last_crash && <div dir="ltr" className="truncate opacity-80">{p.h.last_crash}</div>}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Toggle on={!!p.st.on_play_list} busy={busy === p.email} onClick={() => save(p.email, { on_play_list: !p.st.on_play_list })}>ברשימת Play</Toggle>
                    <Toggle on={!!p.st.in_group} busy={busy === p.email} onClick={() => save(p.email, { in_group: !p.st.in_group })}>בקבוצה</Toggle>
                    <Toggle on={p.optedIn} busy={busy === p.email || p.fromPlay}
                      onClick={() => save(p.email, { opted_in: !p.st.opted_in })}>
                      {p.fromPlay ? "הצטרף (התקין מ־Play)" : "הצטרף"}
                    </Toggle>
                    <input defaultValue={p.st.note || ""} placeholder="הערה"
                      onBlur={e => { if ((e.target.value || "") !== (p.st.note || "")) save(p.email, { note: e.target.value }) }}
                      className="flex-1 min-w-[120px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
                  </div>
                </li>
              )
            })}
            {!shown.length && <li className="card p-6 text-center text-sm text-slate-500">אין משתמשים שמתאימים</li>}
          </ul>

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">כתובות בלי משתמש באפליקציה</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              מיילים שברשימת Play אבל לא מתאימים לאף משתמש אנדרואיד (למשל חשבון Google שני של אותו אדם).
            </p>
            {orphans.map(o => (
              <div key={o.email} className="card p-3 flex items-center gap-2 flex-wrap">
                <span dir="ltr" className="text-xs font-semibold text-slate-700 dark:text-slate-200 me-auto">{o.email}</span>
                <Toggle on={o.on_play_list} busy={busy === o.email} onClick={() => save(o.email, { on_play_list: !o.on_play_list })}>ברשימת Play</Toggle>
                <Toggle on={o.in_group} busy={busy === o.email} onClick={() => save(o.email, { in_group: !o.in_group })}>בקבוצה</Toggle>
                <Toggle on={o.opted_in} busy={busy === o.email} onClick={() => save(o.email, { opted_in: !o.opted_in })}>הצטרף</Toggle>
              </div>
            ))}
            <form onSubmit={addEmail} className="flex items-center gap-2">
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)} dir="ltr" type="email" placeholder="name@gmail.com"
                className="flex-1 max-w-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
              <button type="submit" disabled={!newEmail.includes("@")}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> הוספה
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
