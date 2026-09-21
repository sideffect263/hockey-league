import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { setPlayerBirthDate, ageFromBirthDate, YOUTH_MAX_AGE } from "@/lib/birthDate"
import { Cake, RefreshCw, Search, Check, Loader2, AlertTriangle } from "lucide-react"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Bulk date-of-birth entry — coach / league manager / admin.
 *
 * Most player cards were created long before anyone asked for a DOB, so the loan rule
 * (under 18, or a goalkeeper) cannot be evaluated for most of the league and falls back
 * to a manual vouch every time. Players can now set their own, but the people who
 * actually KNOW the dates are the coaches — hence a table you run straight down rather
 * than a field buried in the player editor.
 *
 * Writes go through set_player_birth_date, never a table update: `players` RLS does not
 * admit a coach write, and the RPC is what carries the coach/manager authorisation.
 * Reads are a separate query for the same reason the bulk player fetch omits the column
 * — `birth_date` is revoked from `anon`, so it is asked for only while signed in.
 */

const SORT_OPTIONS = [
  { key: "missing", label: "חסרים תחילה", dir: "asc" },
  { key: "name", label: "שם", dir: "asc" },
  { key: "team", label: "קבוצה", dir: "asc" },
  { key: "dob", label: "תאריך לידה", dir: "asc" },
]

export default function BirthDatesAdmin({ players = [], teamsMap = {}, membersByPlayer = new Map(), coachTeamIds = null }) {
  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const [dates, setDates] = useState(null)     // player_id -> 'yyyy-mm-dd' | null
  const [draft, setDraft] = useState({})       // player_id -> in-flight input value
  const [busy, setBusy] = useState(null)       // player_id currently saving
  const [saved, setSaved] = useState(null)     // player_id that just saved (tick)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("missing")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState({ key: "missing", dir: "asc" })

  const load = async () => {
    setError(null)
    // manageable_birth_dates(), not a table read: `birth_date` is granted to no PostgREST
    // role, so the only way to a date is a function that checks who is asking. It returns
    // the whole league to an admin or a league manager, and to a coach exactly the players
    // he may also SET — his own squad, and nobody else's.
    const { data, error: e } = await supabase.rpc("manageable_birth_dates")
    if (e) { setError("שגיאה בטעינת תאריכי הלידה"); setDates({}); return }
    setDates(Object.fromEntries((data || []).map(r => [r.player_id, r.birth_date])))
  }
  useEffect(() => { load() }, [])

  // A coach owns a player whether it is the player's primary card or one of his
  // multi-age memberships — the same test the players tab uses.
  const mine = useMemo(() => players.filter(p => !coachScoped || (
    coachTeamIds.includes(p.team_id) ||
    (membersByPlayer.get(p.id) || []).some(m => coachTeamIds.includes(m.team_id))
  )), [players, coachScoped, coachTeamIds, membersByPlayer])

  const rows = useMemo(() => mine.map(p => {
    const dob = dates?.[p.id] ?? null
    return {
      ...p,
      dob,
      age: ageFromBirthDate(dob),
      team_name: teamsMap[p.team_id]?.name || "",
    }
  }), [mine, dates, teamsMap])

  const missingCount = rows.filter(r => !r.dob).length

  const accessors = {
    // Missing first, then alphabetical inside each group — the order a coach reads down.
    missing: r => `${r.dob ? 1 : 0}|${r.first_name} ${r.last_name}`,
    name: r => `${r.first_name} ${r.last_name}`.trim(),
    team: r => r.team_name,
    dob: r => (r.dob ? new Date(r.dob).getTime() : null),
  }

  const shown = sortItems(rows.filter(r => {
    if (filter === "missing" && r.dob) return false
    if (q.trim()) {
      const hay = `${r.first_name} ${r.last_name} ${r.team_name}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  }), sort, accessors)

  const today = new Date().toLocaleDateString("en-CA")

  // Committed on blur / Enter rather than on every keystroke: a date input emits a
  // change for each partial year ("0002-…"), which the RPC's sanity checks would
  // rightly reject in the middle of typing.
  const commit = async (row) => {
    const value = draft[row.id]
    if (value === undefined) return
    const next = value || null
    if (next === (row.dob || null)) { setDraft(d => { const { [row.id]: _, ...rest } = d; return rest }); return }
    if (next && (next > today || next < "1900-01-01")) return   // still mid-typing
    setBusy(row.id); setError(null)
    try {
      await setPlayerBirthDate(row.id, next)
      setDates(d => ({ ...d, [row.id]: next }))
      setDraft(d => { const { [row.id]: _, ...rest } = d; return rest })
      setSaved(row.id)
      setTimeout(() => setSaved(s => (s === row.id ? null : s)), 1800)
    } catch (e) {
      setError(`${row.first_name} ${row.last_name}: ${e.message}`)
    } finally { setBusy(null) }
  }

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter === id ? "bg-brand text-brand-fg" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
      {label}{n != null ? ` (${n})` : ""}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <Cake className="w-5 h-5 text-brand" /> תאריכי לידה
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        הליגה משתמשת בתאריך הלידה כדי לקבוע אם אפשר להשאיל שחקן/ית לקבוצה אחרת
        (עד גיל {YOUTH_MAX_AGE}, או שוער/ת בכל גיל). כל עוד התאריך חסר, כל השאלה דורשת
        אישור ידני. התאריך נשמר מיד עם היציאה מהשדה.
      </p>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <FilterBtn id="missing" label="חסר תאריך לידה" n={missingCount} />
        <FilterBtn id="all" label="הכל" n={rows.length} />
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שחקן או קבוצה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
      </div>

      <SortBar options={SORT_OPTIONS} sort={sort} onChange={setSort} />

      {dates === null ? (
        <SkeletonPanelRows />
      ) : shown.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">
          {filter === "missing" ? "לכל השחקנים יש תאריך לידה 🎉" : "אין שחקנים תואמים"}
        </p>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="text-right font-bold px-4 py-2.5">שחקן</th>
                  <th className="text-right font-bold px-3 py-2.5">קבוצה</th>
                  <th className="text-right font-bold px-3 py-2.5">תאריך לידה</th>
                  <th className="text-right font-bold px-3 py-2.5">גיל</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {shown.map(r => {
                  const value = draft[r.id] ?? r.dob ?? ""
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-2 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {!r.dob && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-label="חסר תאריך לידה" />}
                          {r.first_name} {r.last_name}
                          {r.position === "Goalkeeper" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">GK</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.team_name || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <input type="date" value={value} max={today} dir="ltr"
                            aria-label={`תאריך לידה — ${r.first_name} ${r.last_name}`}
                            onChange={e => setDraft(d => ({ ...d, [r.id]: e.target.value }))}
                            onBlur={() => commit(r)}
                            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }}
                            className={`bg-slate-50 dark:bg-slate-800 border rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30 ${
                              r.dob ? "border-slate-200 dark:border-slate-700" : "border-amber-300 dark:border-amber-700"}`} />
                          {busy === r.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                          {saved === r.id && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {r.age != null ? (
                          <span className={r.age < YOUTH_MAX_AGE ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-slate-500 dark:text-slate-400"}>{r.age}</span>
                        ) : (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">חסר</span>
                        )}
                      </td>
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
