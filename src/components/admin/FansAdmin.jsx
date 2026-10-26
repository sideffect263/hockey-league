import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { RefreshCw, Loader2 } from "lucide-react"
import { LikeOn as Heart } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { getAdminFanOverview } from "@/lib/follows"
import { ilDate } from "@/lib/ilTime"

/**
 * /admin אוהדים (fans-v2.sql). Per team: real fans (the team's own players are not
 * counted), how many turned the bell on, new in 30 days, and how many marked
 * "אני בא/ה לצפות" for the team's next game. "שחקנים שסימנו" = own players who tapped
 * the fan button on their own team — kept for their feed, never counted as fans.
 * Counts only: who is a fan of what is never listed, not even here.
 */
export default function FansAdmin() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => {
    setRows(null); setErr(null)
    getAdminFanOverview().then(setRows).catch(() => setErr("שגיאה בטעינת הנתונים"))
  }
  useEffect(load, [])

  if (err) return (
    <div className="card p-6 text-center text-sm text-red-600 dark:text-red-400">
      {err} <button onClick={load} className="underline ms-2">נסה שוב</button>
    </div>
  )
  if (!rows) return <div className="card p-10 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>

  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><Heart className="w-5 h-5 text-rose-500" /> אוהדים</h2>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[["fans", "אוהדים"], ["notify", "עם התראות"], ["new_30d", "חדשים ב-30 יום"], ["coming_next", "באים למשחק הבא"]].map(([k, l]) => (
          <div key={k} className="card py-3 text-center">
            <p className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums">{sum(k)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{l}</p>
          </div>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            <tr>
              <th className="text-right font-semibold px-4 py-2">קבוצה</th>
              <th className="font-semibold px-2 py-2">אוהדים</th>
              <th className="font-semibold px-2 py-2">התראות</th>
              <th className="font-semibold px-2 py-2">חדשים 30 יום</th>
              <th className="font-semibold px-2 py-2">באים למשחק הבא</th>
              <th className="font-semibold px-2 py-2" title="שחקני הקבוצה שסימנו אוהד/ת על הקבוצה שלהם — לא נספרים">שחקנים שסימנו</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {rows.map(r => (
              <tr key={r.team_id}>
                <td className="px-4 py-2 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{r.team_name}</td>
                <td className="px-2 py-2 text-center font-extrabold tabular-nums">{r.fans}</td>
                <td className="px-2 py-2 text-center tabular-nums">{r.notify}</td>
                <td className="px-2 py-2 text-center tabular-nums">{r.new_30d}</td>
                <td className="px-2 py-2 text-center tabular-nums whitespace-nowrap">
                  {r.next_game_id
                    ? <Link to={`/games/${r.next_game_id}`} className="hover:text-brand">{r.coming_next} <span className="text-[11px] text-slate-400" dir="ltr">({format(ilDate(r.next_game_date), "d/M")})</span></Link>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-2 py-2 text-center tabular-nums text-slate-400">{r.roster_follows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
