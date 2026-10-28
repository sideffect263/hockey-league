import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Smartphone, RefreshCw, Search, Monitor, Merge, Loader2 } from "lucide-react"
import { Squad as Users, PersonFollowing as UserCheck, Warning as AlertTriangle, InfoIcon as Info, ApprovedStatus as CheckCircle2 } from "@/components/icons/BrandIcons"
import { getAppUsers, mergeAccounts, getAndroidLatestVersion } from "@/lib/appUsers"
import { entityPath } from "@/lib/slugs"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * משתמשי אפליקציה — every account, and whether it has signed in on the iOS / Android
 * app, whether it is linked to a player card, and whether it looks like the same
 * person's SECOND account (Apple in the app + Google on the web is the usual way
 * that happens). Admin-only: admin_app_users() refuses anyone else.
 *
 * There is no install event anywhere. An app that was downloaded and never signed
 * in to is invisible here by construction — App Store Connect is the only place
 * that counts those.
 */

const PROVIDER_LABEL = { google: "Google", apple: "Apple", email: "אימייל" }

const FILTERS = [
  { id: "all", label: "הכל" },
  { id: "app", label: "עם אפליקציה" },
  { id: "ios", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "old", label: "גרסה ישנה" },
  { id: "noapp", label: "בלי אפליקציה" },
  { id: "nocard", label: "ללא כרטיס שחקן" },
  { id: "dups", label: "חשבון כפול?" },
]

const PLATFORMS = [
  { id: "ios", label: "iPhone" },
  { id: "android", label: "Android" },
]

/** "1.5.5 (69)" → "1.5.5"; "build 39" (old iOS session, no name) → null. */
const versionName = (label) => label?.match(/^\d+\.\d+\.\d+/)?.[0] || null

/** Semver compare of "1.5.3" vs "1.5.5" → negative / 0 / positive. */
function cmpVersion(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

const WEEK = 7 * 86400000
const activeThisWeek = (iso) => !!iso && Date.now() - new Date(iso).getTime() < WEEK

/** Hebrew relative day count — "היום", "אתמול", "לפני 12 ימים". */
function daysAgo(iso) {
  if (!iso) return null
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return "היום"
  if (d === 1) return "אתמול"
  return `לפני ${d} ימים`
}

function Stat({ icon: Icon, label, value, sub, tone = "brand" }) {
  const tones = {
    brand: "text-brand bg-brand/10",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  }
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</div>
        {sub && <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  )
}

function Chip({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    brand: "bg-brand/10 text-brand",
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  }
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

export default function AppUsersAdmin() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState("all")
  const [q, setQ] = useState("")
  const [merge, setMerge] = useState(null)     // { a, b, keep } — ids; keep = the survivor
  const [merging, setMerging] = useState(false)
  const [mergeErr, setMergeErr] = useState(null)
  const [mergeDone, setMergeDone] = useState(null) // result text after a merge
  // Newest released version. Both apps ship the same version number, and the
  // Android one the site serves is kept in league_settings — use it for both.
  const [latest, setLatest] = useState(null)

  const load = async () => {
    setLoading(true); setErr(null)
    getAndroidLatestVersion().then(v => setLatest(v.name)).catch(() => {})
    try { setRows(await getAppUsers()) }
    catch (e) { setErr(e.message || "שגיאה") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const byId = useMemo(() => Object.fromEntries(rows.map(r => [r.user_id, r])), [rows])
  const hasApp = (r) => r.has_ios || r.has_android
  // Behind the newest release on a platform. Unknown versions are not "old".
  const isOld = (r, p) => {
    const v = versionName(r[`${p}_version`])
    return !!(latest && r[`has_${p}`] && v && cmpVersion(v, latest) < 0)
  }
  const anyOld = (r) => isOld(r, "ios") || isOld(r, "android")

  const totals = useMemo(() => {
    const app = rows.filter(hasApp)
    return {
      accounts: rows.length,
      app: app.length,
      ios: app.filter(r => r.has_ios).length,
      android: app.filter(r => r.has_android).length,
      iosWeek: app.filter(r => activeThisWeek(r.ios_last_seen)).length,
      androidWeek: app.filter(r => activeThisWeek(r.android_last_seen)).length,
      linked: rows.filter(r => r.player_id).length,
      appLinked: app.filter(r => r.player_id).length,
      dups: rows.filter(r => r.duplicate_of?.length).length,
    }
  }, [rows])

  // Per platform: how many accounts are on each version, newest first.
  const versions = useMemo(() => Object.fromEntries(PLATFORMS.map(({ id }) => {
    const counts = {}
    for (const r of rows) {
      if (!r[`has_${id}`]) continue
      const v = versionName(r[`${id}_version`]) || "לא ידוע"
      counts[v] = (counts[v] || 0) + 1
    }
    const list = Object.entries(counts).sort(([a], [b]) => {
      if (a === "לא ידוע") return 1
      if (b === "לא ידוע") return -1
      return cmpVersion(b, a)
    })
    return [id, list]
  })), [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === "app" && !hasApp(r)) return false
      if (filter === "noapp" && hasApp(r)) return false
      if (filter === "ios" && !r.has_ios) return false
      if (filter === "android" && !r.has_android) return false
      if (filter === "old" && !anyOld(r)) return false
      if (filter === "nocard" && r.player_id) return false
      if (filter === "dups" && !r.duplicate_of?.length) return false
      if (!s) return true
      return `${r.display_name || ""} ${r.email || ""} ${r.player_name || ""}`.toLowerCase().includes(s)
    })
  }, [rows, filter, q, latest])

  // Which account should survive by default: the one the APP uses (its session and
  // push registration survive → the player is never signed out), then the one with
  // the player card, then the more recently active one.
  const preferKeep = (a, b) => {
    const score = r => (hasApp(r) ? 4 : 0) + (r.player_id ? 2 : 0)
    if (score(a) !== score(b)) return score(a) > score(b) ? a.user_id : b.user_id
    const t = r => new Date(r.app_last_seen || r.web_last_seen || r.last_sign_in_at || 0).getTime()
    return t(a) >= t(b) ? a.user_id : b.user_id
  }

  const openMerge = (a, b) => { setMergeErr(null); setMergeDone(null); setMerge({ a: a.user_id, b: b.user_id, keep: preferKeep(a, b) }) }

  const runMerge = async () => {
    const dropId = merge.keep === merge.a ? merge.b : merge.a
    setMerging(true); setMergeErr(null)
    try {
      const res = await mergeAccounts(merge.keep, dropId)
      setMergeDone(res?.lost_email_login
        ? `אוחד. שימו לב: הכניסה עם האימייל ${res.lost_email_login} והסיסמה שלו כבר לא עובדת — שיכנס/תיכנס מעכשיו עם ${byId[merge.keep]?.email}.`
        : "אוחד בהצלחה.")
      setMerge(null)
      await load()
    } catch (e) { setMergeErr(e.message) }
    finally { setMerging(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-brand" /> משתמשי אפליקציה
        </h2>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> רענון
        </button>
      </div>

      {err && <div className="card p-4 text-sm text-red-600 dark:text-red-400">לא ניתן לטעון: {err}</div>}

      {loading && !rows.length && !err ? <SkeletonPanelRows /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat icon={Users} label="חשבונות" value={totals.accounts} sub={`באפליקציה: ${totals.app}`} />
            <Stat icon={Smartphone} label="iPhone" value={totals.ios} sub={`פעילים השבוע: ${totals.iosWeek}`} />
            <Stat icon={Smartphone} label="Android" value={totals.android} sub={`פעילים השבוע: ${totals.androidWeek}`} />
            <Stat icon={UserCheck} label="מקושרים לכרטיס שחקן" value={totals.linked} sub={`מתוכם באפליקציה: ${totals.appLinked}`} />
            <Stat icon={AlertTriangle} label="חשבון כפול אפשרי" value={totals.dups} tone={totals.dups ? "amber" : "brand"} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {PLATFORMS.map(({ id, label }) => {
              const list = versions[id]
              const total = list.reduce((n, [, c]) => n + c, 0)
              const old = latest ? list.filter(([v]) => v !== "לא ידוע" && cmpVersion(v, latest) < 0).reduce((n, [, c]) => n + c, 0) : 0
              return (
                <div key={id} className="card p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-sm text-slate-900 dark:text-white">גרסאות {label}</div>
                    {latest && <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      אחרונה: {latest}{old > 0 && <> · <span className="text-amber-600 dark:text-amber-400 font-semibold">{old} על גרסה ישנה</span></>}
                    </div>}
                  </div>
                  {!list.length && <div className="text-xs text-slate-400">אין עדיין</div>}
                  {list.map(([v, c]) => {
                    const tone = v === "לא ידוע" || !latest ? "bg-slate-400"
                      : cmpVersion(v, latest) >= 0 ? "bg-emerald-500" : "bg-amber-500"
                    return (
                      <div key={v} className="flex items-center gap-2 text-xs">
                        <span className="w-14 shrink-0 tabular-nums text-slate-700 dark:text-slate-200 font-semibold" dir="ltr">{v}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div className={`h-full rounded-full ${tone}`} style={{ width: `${(c / total) * 100}%` }} />
                        </div>
                        <span className="w-6 shrink-0 text-left tabular-nums text-slate-500 dark:text-slate-400">{c}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Info className="w-4 h-4 shrink-0 mt-px" />
            <span>
              מי שהוריד את האפליקציה ולא התחבר לא מופיע כאן — אין לנו שום סימן להורדה עצמה (את זה רואים רק ב־App Store Connect וב־Google Play Console).
              ״גרסה ישנה״ = מתחת לגרסה האחרונה שפורסמה ({latest || "—"}).
              ״נראה לאחרונה״ מבוסס על התחברויות, התראות ופעילות — תאריכים ישנים יכולים להיות מוקדמים מהאמת.
            </span>
          </p>

          {mergeDone && (
            <div className="flex items-start gap-2 text-sm rounded-xl bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 px-4 py-3">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {mergeDone}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 card p-1 flex-wrap">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    filter === f.id ? "bg-brand text-white" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="relative flex-1 min-w-[180px]">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שם / אימייל / שחקן"
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </label>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">{shown.length} חשבונות</div>

          <ul className="space-y-2">
            {shown.map(r => (
              <li key={r.user_id} className="card p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-white truncate">{r.display_name || "ללא שם"}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate" dir="ltr">{r.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PLATFORMS.filter(p => r[`has_${p.id}`]).map(p => (
                      <Chip key={p.id} tone={isOld(r, p.id) ? "amber" : "brand"}>
                        <Smartphone className="w-3 h-3" /> {p.label}
                        {r[`${p.id}_version`] && <>· <span dir="ltr">{r[`${p.id}_version`]}</span></>}
                      </Chip>
                    ))}
                    {!hasApp(r) && <Chip><Monitor className="w-3 h-3" /> אתר בלבד</Chip>}
                  </div>
                </div>

                <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    כרטיס שחקן:{" "}
                    {r.player_id
                      ? <Link to={entityPath("players", r.player_id)} className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">{r.player_name || "מקושר"}</Link>
                      : <span className="font-semibold text-slate-400">אין</span>}
                  </span>
                  <span>כניסה עם: {(r.providers || []).map(p => PROVIDER_LABEL[p] || p).join(" + ") || "—"}</span>
                  {r.has_ios && <span>ב־iPhone: {daysAgo(r.ios_last_seen) || "—"}</span>}
                  {r.has_android && <span>ב־Android: {daysAgo(r.android_last_seen) || "—"}</span>}
                  {r.web_last_seen && <span>באתר: {daysAgo(r.web_last_seen)}</span>}
                  <span className="text-slate-400">נרשם {new Date(r.created_at).toLocaleDateString("he-IL")}</span>
                </div>

                {r.duplicate_of?.length > 0 && (
                  <div className="flex items-start gap-2 text-xs rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    <span>
                      ייתכן שזה אותו אדם כמו:{" "}
                      {r.duplicate_of.map(id => byId[id]).filter(Boolean).map(o =>
                        `${o.display_name || "ללא שם"} (${o.email}${o.player_id ? ", מקושר לכרטיס" : ""})`).join(" · ")}
                    </span>
                    <span className="mr-auto flex gap-1 shrink-0">
                      {r.duplicate_of.map(id => byId[id]).filter(Boolean).map(o => (
                        <button key={o.user_id} onClick={() => openMerge(r, o)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-600 text-white font-semibold hover:bg-amber-700">
                          <Merge className="w-3.5 h-3.5" /> איחוד
                        </button>
                      ))}
                    </span>
                  </div>
                )}

                {merge && (merge.a === r.user_id) && (() => {
                  const keep = byId[merge.keep], drop = byId[merge.keep === merge.a ? merge.b : merge.a]
                  if (!keep || !drop) return null
                  const bothCards = keep.player_id && drop.player_id && keep.player_id !== drop.player_id
                  const loseEmail = (drop.providers || []).includes("email")
                  return (
                    <div className="rounded-xl border border-amber-300 dark:border-amber-700 p-3 space-y-2 text-xs text-slate-700 dark:text-slate-200">
                      <div className="font-bold text-sm">איזה חשבון להשאיר?</div>
                      {[merge.a, merge.b].map(id => { const o = byId[id]; return (
                        <label key={id} className="flex items-start gap-2 cursor-pointer">
                          <input type="radio" name={`keep-${merge.a}`} checked={merge.keep === id} onChange={() => setMerge({ ...merge, keep: id })} className="mt-0.5" />
                          <span>
                            <b>{o.display_name || "ללא שם"}</b> <span dir="ltr">{o.email}</span>
                            {" · "}{hasApp(o) ? "משתמש באפליקציה" : "אתר בלבד"}{o.player_id ? ` · כרטיס: ${o.player_name || "מקושר"}` : ""}
                          </span>
                        </label>
                      )})}
                      <ul className="list-disc pr-5 space-y-0.5 text-slate-600 dark:text-slate-300">
                        <li>החשבון <b dir="ltr">{drop.email}</b> יימחק. כל מה ששייך לו (כרטיס שחקן, תפקידים, התראות, לייקים…) עובר ל־<b dir="ltr">{keep.email}</b>.</li>
                        {(drop.providers || []).filter(p => p !== "email").length > 0 && <li>הכניסה עם {(drop.providers || []).filter(p => p !== "email").map(p => PROVIDER_LABEL[p] || p).join(" + ")} תמשיך לעבוד — ותוביל לחשבון שנשאר.</li>}
                        {loseEmail && <li className="text-red-600 dark:text-red-400 font-semibold">הכניסה עם האימייל והסיסמה של החשבון שנמחק תפסיק לעבוד.</li>}
                        {!hasApp(keep) && hasApp(drop) && <li className="text-red-600 dark:text-red-400 font-semibold">החשבון שנמחק הוא זה שבאפליקציה — המשתמש יתנתק שם ויצטרך להתחבר מחדש.</li>}
                        <li>אי אפשר לבטל.</li>
                      </ul>
                      {bothCards && <p className="text-red-600 dark:text-red-400 font-semibold">שני החשבונות מקושרים לכרטיסי שחקן שונים — כנראה שני אנשים שונים. לא ניתן לאחד.</p>}
                      {mergeErr && <p className="text-red-600 dark:text-red-400 font-semibold">{mergeErr}</p>}
                      <div className="flex gap-2">
                        <button onClick={runMerge} disabled={merging || bothCards}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                          {merging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Merge className="w-3.5 h-3.5" />} איחוד ומחיקת {drop.email}
                        </button>
                        <button onClick={() => setMerge(null)} disabled={merging}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold">ביטול</button>
                      </div>
                    </div>
                  )
                })()}
              </li>
            ))}
            {!shown.length && <li className="card p-6 text-center text-sm text-slate-500">אין חשבונות שמתאימים לסינון</li>}
          </ul>
        </>
      )}
    </div>
  )
}
