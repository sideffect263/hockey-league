import { useEffect, useState } from "react"
import { LikeOn as Heart } from "@/components/icons/BrandIcons"
import { getTeamFanStats } from "@/lib/follows"

/**
 * Coach / admin / league manager only (team_fan_stats refuses everyone else).
 * Real fans — the team's own players never count — over the last 12 weeks, plus
 * how many said they are coming to the next game. Counts only, never names.
 */
export default function TeamFanStats({ teamId }) {
  const [d, setD] = useState(null)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    let alive = true
    getTeamFanStats(teamId).then(r => alive && setD(r)).catch(() => {})
    return () => { alive = false }
  }, [teamId])
  if (!d) return null

  const weekly = d.weekly || []
  const max = Math.max(1, ...weekly.map(w => w.total))
  const fmt = (iso) => { const [, m, day] = String(iso).split("-"); return `${+day}/${+m}` }
  const shown = hover != null ? weekly[hover] : null

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap mb-3 gap-x-2 gap-y-0.5">
        <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white whitespace-nowrap">
          <Heart className="w-4 h-4 text-rose-500" /> אוהדי הקבוצה
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">רק למאמנים ולהנהלה · בלי שחקני הקבוצה</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[[d.fans, "אוהדים"], [d.notify, "עם התראות"], [d.new_30d, "חדשים ב-30 יום"]].map(([v, l]) => (
          <div key={l} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 py-2.5 text-center">
            <p className="text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">{v ?? 0}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{l}</p>
          </div>
        ))}
      </div>

      {weekly.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5 h-4">
            {shown ? <>שבוע {fmt(shown.week)}: <span className="font-bold text-slate-700 dark:text-slate-200 tabular-nums">{shown.total}</span> אוהדים</> : "אוהדים לאורך 12 השבועות האחרונים"}
          </p>
          {/* newest on the right, like the team page's form row */}
          <div className="flex items-end gap-[2px] h-12 border-b border-slate-200 dark:border-slate-700" onMouseLeave={() => setHover(null)}>
            {weekly.map((w, i) => ({ w, i })).reverse().map(({ w, i }) => (
              <button key={w.week} type="button" aria-label={`שבוע ${fmt(w.week)}: ${w.total} אוהדים`}
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
                className="flex-1 h-full flex items-end group">
                <span className={`w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-rose-600" : "bg-rose-400/80 dark:bg-rose-500/70 group-hover:bg-rose-500"}`}
                  style={{ height: `${w.total ? Math.max(6, (w.total / max) * 100) : 0}%` }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {d.next_game && (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
          המשחק הבא מול {d.next_game.opponent}:{" "}
          <span className="font-extrabold tabular-nums">{d.next_game.coming}</span> סימנו שהם באים לצפות
          {d.next_game.fans_coming > 0 && <> (מהם <span className="tabular-nums">{d.next_game.fans_coming}</span> אוהדים שלכם)</>}
        </p>
      )}
    </div>
  )
}
