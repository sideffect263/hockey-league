import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getTournaments } from "@/lib/tournaments"
import { AGE_LABEL } from "@/lib/ageGroups"
import { ChevronLeft, RefreshCw } from "lucide-react"
import { Trophy, Calendar, BrandTile } from "@/components/icons/BrandIcons"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { FLTPills } from "@/components/fl/teams/FLTeamsKit"
import { entityPath } from "@/lib/slugs"
import { TournamentsSkeleton } from "@/components/skeletons/PageSkeletons"

export const TOURNAMENT_STATUS = {
  upcoming: { label: "מתקרב", cls: "bg-[#2F6FD6] text-white" },
  active: { label: "פעיל", cls: "bg-fl-accent text-[#11161D]" },
  completed: { label: "הסתיים", cls: "bg-surface-sunken text-fg-muted" },
}

const fmtDate = (d) => (d ? format(new Date(d), "d/M/yyyy") : null)
export const dateRange = (t) => {
  const s = fmtDate(t?.start_date), e = fmtDate(t?.end_date)
  if (s && e) return s === e ? s : `${s} – ${e}`
  return s || e || null
}

export default function Tournaments() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [filter, setFilter] = useState("all")
  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const all = await getTournaments()
      // Never surface pending/rejected requests on the public list (a manager who
      // can see them via RLS still shouldn't here — those live in the admin queue).
      setItems(all.filter(t => t.status !== 'pending' && t.status !== 'rejected'))
    } catch (e) { console.error(e); setError("שגיאה בטעינת הטורנירים") }
    finally { setLoading(false) }
  }

  if (loading) return <TournamentsSkeleton />

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
          <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 pt-4 pb-8 sm:px-6 lg:px-8 max-w-4xl mx-auto space-y-3">
      <header className="flex items-center gap-2.5 px-1">
        <BrandTile name="trophy" className="w-11 h-11" />
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight text-fg-strong">טורנירים</h1>
          <p className="text-[13px] text-fg-muted">טורנירים לקבוצות הנוער</p>
        </div>
      </header>

      {items.length > 0 && (
        <FLTPills label="סטטוס" value={filter} onChange={setFilter} items={[
          { value: "all", label: "הכל", count: items.length },
          ...["active", "upcoming", "completed"].map(k => ({ value: k, label: TOURNAMENT_STATUS[k].label, count: items.filter(t => (t.status || "active") === k).length })).filter(x => x.count > 0),
        ]} />
      )}

      {items.length === 0 ? (
        <div className="rounded-card bg-surface p-10 flex flex-col items-center text-center gap-2">
          <Trophy className="w-10 h-10" />
          <p className="text-[15px] font-bold text-fg-strong">אין טורנירים עדיין</p>
          <p className="text-[13px] text-fg-muted">טורנירים לנוער יתווספו כאן בהמשך</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.filter(t => filter === "all" || (t.status || "active") === filter).map((t, i) => {
            const st = TOURNAMENT_STATUS[t.status] || TOURNAMENT_STATUS.active
            const range = dateRange(t)
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={entityPath('tournaments', t)} className="rounded-[18px] bg-surface p-4 flex items-center gap-4 hover:brightness-[.98] dark:hover:brightness-110 transition">
                  <div className="size-12 rounded-[14px] bg-fl-accent/25 flex items-center justify-center shrink-0">
                    <Trophy className="w-8 h-8" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-extrabold text-fg-strong truncate">{t.name}</h2>
                      <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-md bg-surface-sunken text-fg-strong">{AGE_LABEL[t.age_group] || t.age_group}</span>
                      <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md ${st.cls}`}>{st.label}</span>
                    </div>
                    {range && <p className="text-[12.5px] text-fg-muted mt-1 flex items-center gap-1"><Calendar className="w-4 h-4" /> <span dir="ltr">{range}</span></p>}
                  </div>
                  <ChevronLeft className="w-5 h-5 text-fg-muted shrink-0" aria-hidden="true" />
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
