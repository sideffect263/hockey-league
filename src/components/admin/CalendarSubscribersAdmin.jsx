import { useEffect, useState } from "react"
import { CalendarCheck, CalendarDays, Globe, RefreshCw, Info, Users } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/lib/ThemeContext"
import { singleColor } from "@/lib/chartPalette"
import ChartCard, { SegToggle } from "@/components/charts/ChartCard"
import BarChart from "@/components/charts/BarChart"
import StatTile from "@/components/charts/StatTile"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * מנויי יומן — how many people subscribed to the /api/calendar feed.
 *
 * Admin-only, AGGREGATES only: analytics_calendar() (supabase/calendar-subscribers.sql)
 * counts distinct hashed (ip + user-agent) pairs that a calendar APP fetched the feed
 * from. Calendar apps re-poll every few hours, so "fetched in the last N days" ≈ still
 * subscribed. Google fetches from its own servers — its number is a floor.
 */

const WINDOWS = [
  { id: 1, label: "היום" },
  { id: 7, label: "7 ימים" },
  { id: 30, label: "30 יום" },
  { id: 90, label: "90 יום" },
]

const CLIENT = {
  apple: "Apple (iPhone / Mac)",
  google: "Google Calendar",
  outlook: "Outlook",
  other_app: "אפליקציה אחרת",
  browser: "פתיחה בדפדפן",
}

const fmtDate = (iso) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }) : "—"
const teamLabel = (slug) => slug ? slug.replace(/-/g, " ") : "כל הליגה"

export default function CalendarSubscribersAdmin() {
  const { dark } = useTheme()
  const [days, setDays] = useState(7)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    supabase.rpc("analytics_calendar", { p_days: days }).then(({ data, error }) => {
      if (alive) setState({ loading: false, data, error })
    })
    return () => { alive = false }
  }, [days, reload])

  const d = state.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-brand" /> מנויי יומן
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            כמה אנשים מנויים ללוח המשחקים ביומן שלהם ("הוספת הלוח ליומן שלך" בעמוד המשחקים). נתונים מצטברים בלבד.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegToggle label="חלון זמן" value={days} onChange={setDays} options={WINDOWS} />
          <button onClick={() => setReload(r => r + 1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="רענון">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {state.loading && !d ? <SkeletonPanelRows count={4} />
        : state.error ? (
          <div className="card p-4 text-sm text-red-600 dark:text-red-400">
            שגיאה בטעינת הנתונים: {String(state.error?.message || "").includes("not_authorized") ? "הלשונית זמינה למנהלים בלבד" : state.error?.message}
          </div>
        ) : d ? <Body d={d} dark={dark} /> : null}
    </div>
  )
}

function Body({ d, dark }) {
  const daily = d.daily || []
  const clients = d.by_client || []
  const teams = d.by_team || []

  return (
    <div className="space-y-4">
      <div className="card p-3 text-xs text-slate-600 dark:text-slate-300 flex gap-2">
        <Info className="w-4 h-4 shrink-0 text-brand mt-0.5" />
        <div>
          נספר מאז {d.tracking_since ? <span dir="ltr">{fmtDate(d.tracking_since)}</span> : "עכשיו (עדיין אין נתונים)"} — מנויים מלפני כן יופיעו ברגע שהיומן שלהם יתעדכן (בדרך כלל תוך כמה שעות).
          {" "}Google Calendar מושך את הקובץ מהשרתים של Google, כך שכמה משתמשי Google יכולים להיספר כאחד — המספר שלהם הוא מינימום.
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Users className="w-5 h-5" />} accent="brand" value={d.subscribers ?? 0}
          label="מנויים פעילים" sub={`יומנים שהתעדכנו ב-${d.days === 1 ? "יום האחרון" : `${d.days} הימים האחרונים`}`}
          spark={daily.map(x => x.subscribers)} sparkColor={singleColor(dark)} />
        <StatTile icon={<CalendarDays className="w-5 h-5" />} value={d.active_today ?? 0}
          label="התעדכנו היום" />
        <StatTile icon={<Globe className="w-5 h-5" />} value={d.browser_opens ?? 0}
          label="פתחו את הקישור בדפדפן" sub="לא נספרים כמנויים" />
        <StatTile icon={<RefreshCw className="w-5 h-5" />} value={d.fetches ?? 0}
          label="משיכות של הקובץ" sub="כל עדכון של יומן נספר" />
      </div>

      {daily.length > 1 && (
        <ChartCard
          title="מנויים פעילים ביום"
          subtitle="יומנים שונים שמשכו את לוח המשחקים בכל יום"
          icon={<CalendarCheck className="w-4 h-4 text-brand" />}
          table={{ head: ["יום", "מנויים"], rows: daily.map(x => [fmtDate(x.day), x.subscribers]) }}
        >
          <BarChart data={daily.map(x => ({ label: fmtDate(x.day), value: x.subscribers }))} unit="מנויים" color={singleColor(dark)} />
        </ChartCard>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">לפי אפליקציית יומן</h3>
          <Table head={["אפליקציה", "מנויים"]} rows={clients.map(c => [CLIENT[c.client] || c.client, c.subscribers])} />
        </div>
        <div className="card p-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">לפי קבוצה</h3>
          <Table head={["יומן", "מנויים"]} rows={teams.map(t => [teamLabel(t.team), t.subscribers])} />
        </div>
      </div>
    </div>
  )
}

function Table({ head, rows }) {
  if (!rows.length) return <p className="text-xs text-slate-400">אין נתונים בתקופה</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead><tr className="text-slate-500 text-right">{head.map(h => <th key={h} className="py-1 pl-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              {row.map((c, j) => <td key={j} className={`py-1.5 pl-3 ${j ? "tabular-nums" : "font-medium text-slate-800 dark:text-slate-200"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
