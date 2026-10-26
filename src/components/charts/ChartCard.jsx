import { useState } from 'react'
import { Table2 } from "lucide-react"
import { StatsIcon as BarChart3 } from "@/components/icons/BrandIcons"

/**
 * Card shell for every chart on the page.
 *
 * Enforces the two rules that apply to ALL charts here:
 *  - a "תרשים / טבלה" toggle so every chart has an accessible table view of the
 *    exact same numbers (required: several palette slots fall below 3:1 on our
 *    surfaces, so the table is the relief channel — never optional);
 *  - the chart itself is wrapped in `dir="ltr"` so time reads left→right even
 *    though the page is RTL (same trick the score badge uses). The legend,
 *    table and footnote stay in the page's RTL flow.
 *
 * `table` = { head: string[], rows: (node)[][], align?: ('right'|'center'|'left')[] }
 */
export default function ChartCard({
  title,
  subtitle,
  footnote,
  icon,
  table,
  legend,
  children,
  toolbar,
  defaultView = 'chart',
  className = '',
}) {
  const [view, setView] = useState(defaultView)

  return (
    <div className={`card p-4 sm:p-5 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
            {icon}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          )}
        </div>

        {/* A caller-supplied toolbar (e.g. a per-team/per-player toggle) takes the
            top-right slot; otherwise the built-in chart/table toggle appears when
            a `table` view is provided. */}
        {toolbar ? (
          <div className="shrink-0">{toolbar}</div>
        ) : table ? (
          <div className="flex shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700/50 p-0.5" role="tablist" aria-label="תצוגה">
            <ToggleBtn active={view === 'chart'} onClick={() => setView('chart')} icon={<BarChart3 className="w-4 h-4" />} label="תרשים" />
            <ToggleBtn active={view === 'table'} onClick={() => setView('table')} icon={<Table2 className="w-3 h-3" />} label="טבלה" />
          </div>
        ) : null}
      </div>

      {view === 'chart' || !table ? (
        <div dir="ltr" className="w-full">{children}</div>
      ) : (
        <ChartTable table={table} />
      )}

      {legend}

      {footnote && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">{footnote}</p>
      )}
    </div>
  )
}

/**
 * Segmented toggle for the top-right `toolbar` slot — e.g. a "לפי קבוצה / לפי
 * שחקן" switch. Same pill styling as the built-in chart/table toggle.
 *
 * `options` = [{ id, label, icon? }]   `value` = active id   `onChange(id)`
 */
export function SegToggle({ options = [], value, onChange, label = 'תצוגה' }) {
  return (
    <div className="flex shrink-0 rounded-lg bg-slate-100 dark:bg-slate-700/50 p-0.5" role="tablist" aria-label={label}>
      {options.map((o) => (
        <ToggleBtn key={o.id} active={value === o.id} onClick={() => onChange(o.id)} icon={o.icon} label={o.label} />
      ))}
    </div>
  )
}

function ToggleBtn({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors ${
        active
          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function ChartTable({ table }) {
  const { head = [], rows = [], align = [] } = table
  const alignCls = (i) =>
    align[i] === 'center' ? 'text-center' : align[i] === 'left' ? 'text-left' : 'text-right'
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400">
            {head.map((h, i) => (
              <th key={i} className={`py-2 px-2 font-semibold ${alignCls(i)}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {rows.map((row, r) => (
            <tr key={r} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              {row.map((cell, c) => (
                <td key={c} className={`py-2 px-2 ${alignCls(c)} ${c === 0 ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
