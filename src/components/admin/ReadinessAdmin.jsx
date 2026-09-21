import { useState, useEffect, useMemo } from "react"
import { getNotificationReadiness, reachOf, REACH } from "@/lib/readiness"
import { BellRing, RefreshCw, Search, Copy, Check } from "lucide-react"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * P0 — notification readiness. Every scheduled reminder in the sheet (rows 1, 9, 10,
 * 12, 18) depends on the player being reachable, and most are not: an account is
 * needed for the bell, and push on top of that for anything to arrive without him
 * opening the app. This is the chase-list, worst-first, so the gap is a task rather
 * than a surprise on match day.
 */

const REACH_META = {
  [REACH.none]: {
    rank: 0, label: "אין חשבון",
    cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
  [REACH.app_only]: {
    rank: 1, label: "בלי התראות",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  [REACH.push]: {
    rank: 2, label: "מקבל התראות",
    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
}

const SORT_OPTIONS = [
  { key: "reach", label: "מוכנות", dir: "asc" },
  { key: "name", label: "שם", dir: "asc" },
  { key: "team", label: "קבוצה", dir: "asc" },
]
const ACCESSORS = {
  reach: r => REACH_META[r.reach].rank,
  name: r => `${r.first_name} ${r.last_name}`.trim(),
  team: r => r.team_name || "",
}

export default function ReadinessAdmin() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("gaps")   // gaps | none | app | all
  const [team, setTeam] = useState("")           // "" = all teams
  const [q, setQ] = useState("")
  const [sort, setSort] = useState({ key: "reach", dir: "asc" })
  const [copied, setCopied] = useState(false)

  const load = async () => {
    try { setError(null); setRows(await getNotificationReadiness()) }
    catch { setError("שגיאה בטעינת מוכנות ההתראות"); setRows([]) }
  }
  useEffect(() => { load() }, [])

  const decorated = useMemo(
    () => (rows || []).map(r => ({ ...r, reach: reachOf(r) })),
    [rows]
  )

  const counts = useMemo(() => ({
    none: decorated.filter(r => r.reach === REACH.none).length,
    app: decorated.filter(r => r.reach === REACH.app_only).length,
    push: decorated.filter(r => r.reach === REACH.push).length,
    total: decorated.length,
  }), [decorated])

  const teamNames = useMemo(
    () => [...new Set(decorated.map(r => r.team_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")),
    [decorated]
  )

  const shown = sortItems(decorated.filter(r => {
    if (filter === "gaps" && r.reach === REACH.push) return false
    if (filter === "none" && r.reach !== REACH.none) return false
    if (filter === "app" && r.reach !== REACH.app_only) return false
    if (team && r.team_name !== team) return false
    if (q.trim()) {
      const hay = `${r.first_name} ${r.last_name} ${r.team_name || ""}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  }), sort, ACCESSORS)

  // The point of the list is to go chase people, and that chasing happens in WhatsApp —
  // so hand over the names as plain text rather than making them retype the table.
  const copyList = async () => {
    const text = shown.map(r => `${r.first_name} ${r.last_name}${r.team_name ? ` (${r.team_name})` : ""}`).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("לא ניתן להעתיק")
    }
  }

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter === id ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
      {label}{n != null ? ` (${n})` : ""}
    </button>
  )

  const pct = counts.total ? Math.round((counts.push / counts.total) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <BellRing className="w-5 h-5 text-brand" /> מוכנות להתראות
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        תזכורת למשחק מגיעה לטלפון רק לשחקן שיש לו חשבון <strong>וגם</strong> אישר התראות.
        {" "}כרגע <strong className="tabular-nums">{counts.push}</strong> מתוך{" "}
        <strong className="tabular-nums">{counts.total}</strong> שחקנים ({pct}%) יקבלו את ההתראות בפועל.
      </p>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-red-600 dark:text-red-400 tabular-nums">{counts.none}</p><p className="text-[11px] text-slate-400 mt-0.5">אין חשבון</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">{counts.app}</p><p className="text-[11px] text-slate-400 mt-0.5">בלי התראות</p></div>
        <div className="card p-3 text-center"><p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">{counts.push}</p><p className="text-[11px] text-slate-400 mt-0.5">מקבל התראות</p></div>
      </div>

      {/* Filters + team + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterBtn id="gaps" label="חסרים" n={counts.none + counts.app} />
        <FilterBtn id="none" label="אין חשבון" n={counts.none} />
        <FilterBtn id="app" label="בלי התראות" n={counts.app} />
        <FilterBtn id="all" label="הכל" n={counts.total} />
        <select value={team} onChange={e => setTeam(e.target.value)} aria-label="סינון לפי קבוצה"
          className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30">
          <option value="">כל הקבוצות</option>
          {teamNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שחקן או קבוצה" aria-label="חיפוש שחקן או קבוצה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <button onClick={copyList} disabled={!shown.length}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {copied ? <><Check className="w-3.5 h-3.5 text-emerald-500" /> הועתק</> : <><Copy className="w-3.5 h-3.5" /> העתקת רשימה</>}
        </button>
      </div>

      <SortBar options={SORT_OPTIONS} sort={sort} onChange={setSort} />

      {rows === null ? (
        <SkeletonPanelRows />
      ) : shown.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">אין שחקנים תואמים</p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="text-right font-bold px-4 py-2.5">שחקן</th>
                  <th className="text-right font-bold px-3 py-2.5">קבוצה</th>
                  <th className="text-right font-bold px-3 py-2.5">חשבון</th>
                  <th className="text-right font-bold px-3 py-2.5">התראות</th>
                  <th className="text-right font-bold px-3 py-2.5">מצב</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {shown.map(r => {
                  const meta = REACH_META[r.reach]
                  return (
                    <tr key={r.player_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{r.first_name} {r.last_name}</td>
                      <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.team_name || "—"}</td>
                      <td className="px-3 py-2.5">
                        {r.has_account
                          ? <Check className="w-4 h-4 text-emerald-500" aria-label="יש חשבון" />
                          : <span className="text-slate-300 dark:text-slate-600" aria-label="אין חשבון">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.has_push
                          ? <Check className="w-4 h-4 text-emerald-500" aria-label="אישר התראות" />
                          : <span className="text-slate-300 dark:text-slate-600" aria-label="לא אישר התראות">—</span>}
                      </td>
                      <td className="px-3 py-2.5"><span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
