import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getTournaments } from "@/lib/tournaments"
import { AGE_LABEL } from "@/lib/ageGroups"
import { Trophy, Calendar, ChevronLeft, RefreshCw } from "lucide-react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { entityPath } from "@/lib/slugs"
import { TournamentsSkeleton } from "@/components/skeletons/PageSkeletons"

export const TOURNAMENT_STATUS = {
  upcoming: { label: "מתקרב", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  active: { label: "פעיל", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  completed: { label: "הסתיים", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400" },
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Trophy className="w-7 h-7 text-brand" /> טורנירים
        </h1>
        <p className="page-subtitle mt-1">טורנירים לקבוצות הנוער</p>
      </motion.div>

      {items.length === 0 ? (
        <div className="card p-10 flex flex-col items-center text-center gap-2">
          <Trophy className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">אין טורנירים עדיין</p>
          <p className="text-xs text-slate-400">טורנירים לנוער יתווספו כאן בהמשך</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((t, i) => {
            const st = TOURNAMENT_STATUS[t.status] || TOURNAMENT_STATUS.active
            const range = dateRange(t)
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={entityPath('tournaments', t)} className="card card-hover p-4 sm:p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
                    <Trophy className="w-6 h-6 text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-bold text-base text-slate-900 dark:text-white truncate">{t.name}</h2>
                      <span className="stat-pill bg-brand/10 text-brand-strong dark:bg-brand/20 dark:text-brand-light">{AGE_LABEL[t.age_group] || t.age_group}</span>
                      <span className={`stat-pill ${st.cls}`}>{st.label}</span>
                    </div>
                    {range && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> <span dir="ltr">{range}</span></p>}
                  </div>
                  <ChevronLeft className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" />
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
