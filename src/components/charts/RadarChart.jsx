import { useState } from 'react'
import { useTheme } from '@/lib/ThemeContext'
import { flChrome } from '@/components/fl/teams/flChart'

/**
 * Radar / spider chart — one or more series plotted over a shared set of axes
 * (spokes). Handles both framings the Statistics page needs:
 *  - entity-as-axis: spokes are teams, series are measures (זכות / חובה).
 *  - metric-as-axis: spokes are achievement tiers, series are entities.
 *
 * Palette rules honoured: colour follows the series/entity; every series is in
 * the legend (rendered by the caller) so identity is never colour-alone; rings
 * and spokes are recessive hairlines; vertex markers ≥8px with a surface ring.
 *
 * `axes`   = [string]                    spoke labels, clockwise from top.
 * `series` = [{ id, name, color, values:[…aligned to axes] }]
 * `rings`  = [number]                    ring values to draw + label.
 */
const VB_W = 460
const VB_H = 360
const CX = VB_W / 2
const CY = 176
const RR = 128

export default function RadarChart({ axes = [], series = [], max = 1, rings = [] }) {
  const { dark } = useTheme()
  const [hover, setHover] = useState(null) // { s, a }

  if (!axes.length || !series.length) return null

  const c = flChrome(dark)
  const ink = flChrome(dark).ink
  const surface = c.surface
  const N = axes.length

  const pt = (i, r) => {
    const a = (-90 + (i * 360) / N) * (Math.PI / 180)
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)]
  }
  const poly = (vals) => vals.map((v, i) => pt(i, (Math.max(0, v) / max) * RR).map((n) => n.toFixed(1)).join(',')).join(' ')

  const hs = hover ? series[hover.s] : null

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto block" role="img">
        {/* rings */}
        {rings.map((t, i) => (
          <g key={`r${i}`}>
            <polygon points={poly(axes.map(() => t))} fill="none" stroke={c.grid} strokeWidth="1" opacity="0.6" />
            <text x={CX + 3} y={CY - (t / max) * RR + 3} fontSize="8.5" fill={c.muted}>{t}</text>
          </g>
        ))}

        {/* spokes + axis labels */}
        {axes.map((label, i) => {
          const e = pt(i, RR)
          const lp = pt(i, RR + 16)
          const anchor = Math.abs(lp[0] - CX) < 8 ? 'middle' : lp[0] > CX ? 'start' : 'end'
          return (
            <g key={`a${i}`}>
              <line x1={CX} y1={CY} x2={e[0]} y2={e[1]} stroke={c.grid} strokeWidth="1" opacity="0.5" />
              <text x={lp[0]} y={lp[1] + 3} textAnchor={anchor} fontSize="9.5" fill={c.muted}>{label}</text>
            </g>
          )
        })}

        {/* series polygons */}
        {series.map((s, si) => {
          const dim = hover && hover.s !== si
          return (
            <polygon
              key={s.id}
              points={poly(s.values)}
              fill={s.color}
              fillOpacity={dim ? 0.04 : 0.13}
              stroke={s.color}
              strokeWidth="2"
              opacity={dim ? 0.35 : 1}
              strokeLinejoin="round"
            />
          )
        })}

        {/* vertex markers + hit targets */}
        {series.map((s, si) =>
          s.values.map((v, ai) => {
            const p = pt(ai, (Math.max(0, v) / max) * RR)
            const isHover = hover && hover.s === si && hover.a === ai
            return (
              <g key={`${s.id}-${ai}`}>
                <circle cx={p[0]} cy={p[1]} r={isHover ? 5 : 3.5} fill={s.color} stroke={surface} strokeWidth="1.5" />
                <circle cx={p[0]} cy={p[1]} r="9" fill="transparent" onMouseEnter={() => setHover({ s: si, a: ai })} onMouseLeave={() => setHover(null)} onPointerDown={() => setHover({ s: si, a: ai })} />
              </g>
            )
          })
        )}

        {/* center hub */}
        <circle cx={CX} cy={CY} r="1.5" fill={c.muted} />
      </svg>

      {/* tooltip */}
      {hs && (
        <div className="pointer-events-none absolute z-10 left-1/2 top-1 -translate-x-1/2 px-2 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-700 text-white text-[10px] leading-tight shadow-lg whitespace-nowrap">
          <div className="font-bold mb-0.5" style={{ color: '#fff' }}>
            <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: hs.color }} />
            {hs.name}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-300">{axes[hover.a]}</span>
            <span className="font-bold tabular-nums">{hs.values[hover.a]}</span>
          </div>
        </div>
      )}
    </div>
  )
}
