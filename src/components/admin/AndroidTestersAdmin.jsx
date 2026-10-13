import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { TestTube2, RefreshCw, Copy, Check, Info, Smartphone, Search } from "lucide-react"
import { getAndroidTesters } from "@/lib/appUsers"
import { entityPath } from "@/lib/slugs"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * בודקי אפליקציה — Google Play closed-test candidates. Play wants 12+ testers who opt
 * in with a Google account on an Android device and stay in for 14 days. Everyone
 * listed here has used the Android app AND has a Google address; `play_email` is the
 * address to paste into Play Console (the Google identity's email when there is one —
 * it can differ from the login email). Admin-only: admin_android_testers() refuses
 * anyone else. See supabase/android-testers.sql.
 */

const PLAY_MIN_TESTERS = 12

const SORT_OPTIONS = [
  { key: "seen", label: "נראה לאחרונה", dir: "desc" },
  { key: "name", label: "שם", dir: "asc" },
  { key: "team", label: "קבוצה", dir: "asc" },
  { key: "version", label: "גרסה", dir: "desc" },
]

const SORT_ACCESSORS = {
  seen: r => (r.android_last_seen ? new Date(r.android_last_seen).getTime() : null),
  name: r => r.display_name || r.player_name || "",
  team: r => r.team_name || "",
  version: r => r.android_version || "",
}

/** Hebrew relative day count — "היום", "אתמול", "לפני 12 ימים". */
function daysAgo(iso) {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return "היום"
  if (d === 1) return "אתמול"
  return `לפני ${d} ימים`
}

export default function AndroidTestersAdmin() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sort, setSort] = useState({ key: "seen", dir: "desc" })
  const [q, setQ] = useState("")
  const [copied, setCopied] = useState(null) // "all" | user_id

  const load = async () => {
    setLoading(true); setErr(null)
    try { setRows(await getAndroidTesters()) }
    catch (e) { setErr(e.message || "שגיאה") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    const filtered = s
      ? rows.filter(r => `${r.display_name || ""} ${r.player_name || ""} ${r.team_name || ""} ${r.play_email || ""}`.toLowerCase().includes(s))
      : rows
    return sortItems(filtered, sort, SORT_ACCESSORS)
  }, [rows, sort, q])

  // Unique addresses across ALL eligible testers (not just the search hits) —
  // Play Console's tester list takes them comma-separated.
  const allEmails = useMemo(() => [...new Set(rows.map(r => r.play_email).filter(Boolean))], [rows])

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1800)
    } catch { /* clipboard blocked — nothing useful to do */ }
  }

  const enough = allEmails.length >= PLAY_MIN_TESTERS

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TestTube2 className="w-5 h-5 text-brand" /> בודקי אפליקציה
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            מועמדים לבדיקה סגורה ב־Google Play: משתמשי אנדרואיד עם חשבון Google.
            Play דורש לפחות {PLAY_MIN_TESTERS} בודקים שמצטרפים ונשארים 14 יום ברציפות.
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> רענון
        </button>
      </div>

      {err && <div className="card p-4 text-sm text-red-600 dark:text-red-400">לא ניתן לטעון: {err}</div>}

      {loading && !rows.length && !err ? <SkeletonPanelRows /> : (
        <>
          <div className="card p-4 flex items-center gap-4 flex-wrap">
            <div className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${enough ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {allEmails.length} <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">בודקים אפשריים</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {enough ? `מעל הסף של ${PLAY_MIN_TESTERS} בודקים` : `חסרים ${PLAY_MIN_TESTERS - allEmails.length} כדי להגיע ל־${PLAY_MIN_TESTERS}`}
              </div>
            </div>
            <button onClick={() => copy(allEmails.join(", "), "all")} disabled={!allEmails.length}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {copied === "all" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied === "all" ? "הועתק" : "העתק את כל המיילים"}
            </button>
          </div>

          <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Info className="w-4 h-4 shrink-0 mt-px" />
            <span>
              המיילים מופרדים בפסיקים — מדביקים כמו שהם ברשימת הבודקים ב־Play Console.
              כשלמשתמש יש כניסה עם Google, מוצג המייל של חשבון ה־Google (זה מה ש־Play צריך), גם אם הוא שונה ממייל הכניסה.
            </span>
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <SortBar options={SORT_OPTIONS} sort={sort} onChange={setSort} />
            <label className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שם / שחקן / קבוצה / מייל"
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
          </div>

          <ul className="space-y-2">
            {shown.map(r => (
              <li key={r.user_id} className="card p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-white truncate">{r.display_name || r.player_name || "ללא שם"}</div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 min-w-0">
                      <span className="truncate" dir="ltr">{r.play_email}</span>
                      <button onClick={() => copy(r.play_email, r.user_id)} aria-label="העתק מייל"
                        className="shrink-0 p-1 rounded-md text-slate-400 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800">
                        {copied === r.user_id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {r.google_email && r.auth_email && r.google_email !== r.auth_email.toLowerCase() && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400">
                        מייל הכניסה שונה: <span dir="ltr">{r.auth_email}</span>
                      </div>
                    )}
                  </div>
                  <span dir="ltr" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand/10 text-brand">
                    <Smartphone className="w-3 h-3" /> Android{r.android_version ? ` · ${r.android_version}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    כרטיס שחקן:{" "}
                    {r.player_id
                      ? <Link to={entityPath("players", r.player_id)} className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">{r.player_name || "מקושר"}</Link>
                      : <span className="font-semibold text-slate-400">אין</span>}
                  </span>
                  {r.team_name && <span>קבוצה: <span className="font-semibold">{r.team_name}</span></span>}
                  <span>באנדרואיד: {daysAgo(r.android_last_seen) || "—"}</span>
                </div>
              </li>
            ))}
            {!shown.length && <li className="card p-6 text-center text-sm text-slate-500">אין משתמשים שמתאימים</li>}
          </ul>
        </>
      )}
    </div>
  )
}
