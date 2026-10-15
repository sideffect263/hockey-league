import { useEffect, useState } from "react"
import { Trophy, RefreshCw } from "lucide-react"
import { getFinishedExperiments } from "@/lib/devs"
import { liveStandings } from "@/lib/standingsLive"

// "איפה אנחנו עומדים": a measured comparison table from a map stage (pipelineMap.js `standings`).
// Used on the stage page and above the new-experiment form, so a developer sees today's numbers before
// changing anything. The row marked `current` is what runs today. A cell may be [ltr text, hebrew sub-line].
// Phones get one card per row (a 4-column table hid the column that matters most).

function Cell({ c }) {
  if (!Array.isArray(c)) return c
  return (
    <>
      <span dir="ltr" className="inline-block">{c[0]}</span>
      {c[1] && <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">{c[1]}</span>}
    </>
  )
}

// One fetch per page load for every live table on it.
let finished = null
/** Call after an experiment decision so the next table shows it. */
export const refreshStandings = () => { finished = null }
const loadFinished = () => (finished ||= getFinishedExperiments(["ball", "events"]).catch(() => { finished = null; return [] }))

const Chosen = () => <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white align-middle">נבחר</span>
const Today = () => <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand text-white align-middle">היום</span>

export default function Standings({ data: base, compact = false }) {
  const [exps, setExps] = useState(null)
  useEffect(() => { if (base?.live) loadFinished().then(setExps) }, [base?.live])
  if (!base) return null
  const data = exps ? liveStandings(base, exps) : base
  return (
    <section className={`card ${compact ? "p-4" : "p-4 sm:p-5"} space-y-3`}>
      <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><Trophy className="w-5 h-5 text-brand shrink-0" /> {data.title}</h2>

      {/* phones: a card per row */}
      <div className="sm:hidden space-y-2">
        {data.rows.map((r, i) => (
          <div key={i} className={`rounded-lg p-3 ${r.current ? "bg-brand/5 dark:bg-brand/10 ring-1 ring-brand/30" : "bg-slate-50 dark:bg-slate-800/60"}`}>
            <div className="flex items-start gap-2 font-semibold text-sm text-slate-800 dark:text-slate-200">
              <div className="min-w-0 flex-1"><Cell c={r.cells[0]} /></div>
              {r.current && <Today />}
              {r.promoted && <Chosen />}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {r.cells.slice(1).map((c, j) => (
                <div key={j} className="min-w-0">
                  <dt className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{data.columns[j + 1]}</dt>
                  <dd className="text-sm font-bold tabular-nums text-slate-900 dark:text-white"><Cell c={c} /></dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* wider: a table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 align-bottom">
              {data.columns.map((c, i) => <th key={i} className="text-start py-2 pe-3 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className={`border-b border-slate-50 dark:border-slate-800/60 ${r.current ? "bg-brand/5 dark:bg-brand/10" : ""}`}>
                {r.cells.map((c, j) => (
                  <td key={j} className={`py-2 pe-3 align-top ${j === 0 ? "font-semibold text-slate-800 dark:text-slate-200" : "tabular-nums text-slate-700 dark:text-slate-300"}`}>
                    <Cell c={c} />
                    {j === 0 && r.current && <span className="ms-2"><Today /></span>}
                    {j === 0 && r.promoted && <span className="ms-2"><Chosen /></span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.liveNote && <p className="text-[11px] font-semibold text-brand inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> {data.liveNote}</p>}
      {data.note && <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{data.note}</p>}
    </section>
  )
}
