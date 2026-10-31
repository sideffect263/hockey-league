import { useTheme } from '@/lib/ThemeContext'
import { diverging } from '@/lib/chartPalette'
import { flChrome } from '@/components/fl/teams/flChart'
import TeamLogo from '@/components/TeamLogo'

/**
 * Diverging horizontal bars around a zero baseline — goal difference per team.
 *
 * Palette rules honoured:
 *  - polarity uses the validated DIVERGING pair: blue positive / red negative
 *    with a NEUTRAL solid centre axis (never a hue at the midpoint). This is the
 *    one sanctioned two-colour case; it is NOT a per-team hue.
 *  - team identity is carried by the crest + name beside each bar, never colour.
 *  - 4px rounded data-ends anchored to the centre baseline.
 *
 * Rendered as flex rows (not SVG) so the team crests embed crisply via TeamLogo;
 * widths are %-based so it stays responsive with no DOM measuring. The signed
 * value sits in its own trailing column so the longest bars never overflow.
 * ChartCard supplies the matching table view.
 *
 * `data` = [{ teamId, name, team, gd, gf, ga }] (already sorted by gd desc)
 */
export default function DivergingBar({ data = [] }) {
  const { dark } = useTheme()
  if (!data.length) return null

  const div = diverging(dark)
  const axis = flChrome(dark).axis
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.gd)))

  return (
    <div className="w-full">
      {data.map((d) => {
        const pct = (Math.abs(d.gd) / maxAbs) * 48 // leave a hair of track margin
        const pos = d.gd >= 0
        return (
          <div key={d.teamId} className="flex items-center gap-2 py-1">
            {/* team identity — crest + name (RTL so Hebrew reads naturally) */}
            <div dir="rtl" className="flex items-center gap-1.5 w-24 sm:w-32 shrink-0 min-w-0">
              <TeamLogo team={d.team} size={5} />
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">{d.name}</span>
            </div>

            {/* diverging track with a solid centre baseline */}
            <div className="relative flex-1 h-6 min-w-0">
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px" style={{ background: axis }} aria-hidden="true" />
              {pct > 0 && (pos ? (
                <div className="absolute top-1 bottom-1 left-1/2 rounded-r-[4px]" style={{ width: `${pct}%`, background: div.pos }} />
              ) : (
                <div className="absolute top-1 bottom-1 rounded-l-[4px]" style={{ left: `${50 - pct}%`, width: `${pct}%`, background: div.neg }} />
              ))}
            </div>

            {/* signed value in its own column — never overflows the track.
                Ink (not the bar hue) so the small text clears the contrast floor;
                the sign + bar direction already carry polarity. */}
            <span className="w-9 shrink-0 text-left text-[12px] font-bold tabular-nums text-slate-700 dark:text-slate-200">
              {pos ? `+${d.gd}` : d.gd}
            </span>
          </div>
        )
      })}
    </div>
  )
}
