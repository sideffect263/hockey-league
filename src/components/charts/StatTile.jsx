import { Link } from 'react-router-dom'
import Sparkline from './Sparkline'

/**
 * Overview stat tile: a big number with a label, and optional icon, sub-line,
 * sparkline and link. When `to` is set the whole tile becomes a Link (used for
 * the record game → /games/:id).
 *
 * `accent`: 'brand' colours the value orange; otherwise it inherits ink.
 */
// Floodlight: card tile (radius 18), big .fl-num value; `accent="ink"` = the inverted ink tile
// (the season's goals on the Stats board), `className` for grid spans.
export default function StatTile({ icon, value, label, sub, accent = 'default', to, spark, sparkColor, className = '' }) {
  const inkTile = accent === 'brand' || accent === 'ink'
  const valueCls = inkTile ? 'text-surface' : 'text-fg-strong'
  const subCls = inkTile ? 'text-surface/80' : 'text-fg-muted'

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={`fl-num text-[30px] leading-none ${valueCls}`}>{value}</p>
        {icon && <span className={`shrink-0 ${inkTile ? 'text-surface/70' : 'text-fg-muted'}`}>{icon}</span>}
      </div>
      <p className={`text-[12.5px] font-medium mt-1.5 ${subCls}`}>{label}</p>
      {sub && <p className={`text-[12px] mt-0.5 truncate ${subCls}`}>{sub}</p>}
      {spark && spark.length > 0 && (
        <div className="h-6 mt-2 -mb-0.5" dir="ltr">
          <Sparkline values={spark} color={sparkColor || (inkTile ? '#F2B233' : undefined)} />
        </div>
      )}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={`rounded-[18px] p-3.5 flex flex-col group hover:brightness-[.98] dark:hover:brightness-110 transition ${inkTile ? 'bg-fg-strong' : 'bg-surface'} ${className}`}>
        {inner}
      </Link>
    )
  }
  return <div className={`rounded-[18px] p-3.5 flex flex-col ${inkTile ? 'bg-fg-strong' : 'bg-surface'} ${className}`}>{inner}</div>
}
