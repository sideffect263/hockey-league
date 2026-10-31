import { useState } from 'react'
import { useTheme } from '@/lib/ThemeContext'
import { flChrome } from '@/components/fl/teams/flChart'
import TeamLogo from '@/components/TeamLogo'

/**
 * Quadrant scatter — two measures plotted against each other, split into four
 * quadrants by a threshold on each axis. Used for attack-vs-defense (goal diff)
 * and volume-vs-explosiveness (scoring).
 *
 * Palette rules honoured:
 *  - colour follows the ENTITY (caller passes a per-point colour), never rank.
 *  - the position IS the encoding; colour only carries identity. Every point is
 *    direct-labelled (short name) and the hover tooltip + crest back it up.
 *  - recessive hairline grid + threshold lines; 4px… n/a (dots), ≥8px markers
 *    with a 2px surface ring.
 *
 * The plot is wrapped in `dir="ltr"` by ChartCard, so x grows left→right and the
 * axis titles read naturally even on the RTL page.
 *
 * `points` = [{ id, x, y, name, color, team?, label?, tip:[{k,v}] }]
 * `yUp` — true: higher y sits higher (more = better, e.g. hat-tricks).
 *         false: higher y sits lower (more = worse, e.g. goals-against).
 */
const VB_W = 460
const VB_H = 340
const M = { top: 22, right: 18, bottom: 42, left: 44 }

export default function ScatterChart({
  points = [],
  xMax = 100,
  yMax = 100,
  xTicks = [],
  yTicks = [],
  xThreshold,
  yThreshold,
  yUp = true,
  diagonal = false,
  quadrants,
  xLabel = '',
  yLabel = '',
}) {
  const { dark } = useTheme()
  const [hover, setHover] = useState(null)

  if (!points.length) return null

  const c = flChrome(dark)
  const ink = flChrome(dark).ink
  const surface = c.surface

  const L = M.left
  const R = VB_W - M.right
  const T = M.top
  const B = VB_H - M.bottom
  const sx = (v) => L + (v / xMax) * (R - L)
  const sy = (v) => (yUp ? B - (v / yMax) * (B - T) : T + (v / yMax) * (B - T))

  const hp = hover != null ? points[hover] : null

  // Precompute label positions, pushing labels apart vertically within each
  // side (left/right of centre) so names never overlap — same idea as the line
  // chart's end-labels. `ly` is the (possibly nudged) label y; `dy` the dot's.
  const labels = (() => {
    const items = points
      .map((p, i) => ({ i, dx: sx(p.x), dy: sy(p.y), left: sx(p.x) > (L + R) / 2 }))
      .filter((o) => points[o.i].label)
    const GAP = 11.5
    ;['L', 'R'].forEach((side) => {
      const g = items.filter((o) => (o.left ? 'L' : 'R') === side).sort((a, b) => a.dy - b.dy)
      for (let k = 0; k < g.length; k++) {
        g[k].ly = k > 0 && g[k].dy < g[k - 1].ly + GAP ? g[k - 1].ly + GAP : g[k].dy
      }
    })
    return items.map((o) => ({ ...o, ly: (o.ly ?? o.dy) + 3 }))
  })()

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto block" role="img">
        {/* plot frame */}
        <rect x={L} y={T} width={R - L} height={B - T} fill="none" stroke={c.grid} strokeWidth="1" />

        {/* x gridlines + labels */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={sx(t)} y1={T} x2={sx(t)} y2={B} stroke={c.grid} strokeWidth="1" opacity="0.55" />
            <text x={sx(t)} y={B + 14} textAnchor="middle" fontSize="9" fill={c.muted}>{t}</text>
          </g>
        ))}
        {/* y gridlines + labels */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={L} y1={sy(t)} x2={R} y2={sy(t)} stroke={c.grid} strokeWidth="1" opacity="0.55" />
            <text x={L - 6} y={sy(t) + 3} textAnchor="end" fontSize="9" fill={c.muted}>{t}</text>
          </g>
        ))}

        {/* zero-difference diagonal (x === y) */}
        {diagonal && (
          <line x1={sx(0)} y1={sy(0)} x2={sx(Math.min(xMax, yMax))} y2={sy(Math.min(xMax, yMax))} stroke={c.axis} strokeWidth="1" strokeDasharray="5 4" opacity="0.7" />
        )}

        {/* quadrant threshold lines */}
        {xThreshold != null && (
          <line x1={sx(xThreshold)} y1={T} x2={sx(xThreshold)} y2={B} stroke={c.axis} strokeWidth="1" strokeDasharray="3 3" />
        )}
        {yThreshold != null && (
          <line x1={L} y1={sy(yThreshold)} x2={R} y2={sy(yThreshold)} stroke={c.axis} strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* quadrant corner labels */}
        {quadrants && (
          <g>
            <text x={R - 6} y={T + 13} textAnchor="end" fontSize="10.5" fontWeight="600" fill={c.muted} opacity="0.85">{quadrants.tr}</text>
            <text x={L + 6} y={T + 13} textAnchor="start" fontSize="10.5" fontWeight="600" fill={c.muted} opacity="0.85">{quadrants.tl}</text>
            <text x={R - 6} y={B - 7} textAnchor="end" fontSize="10.5" fontWeight="600" fill={c.muted} opacity="0.85">{quadrants.br}</text>
            <text x={L + 6} y={B - 7} textAnchor="start" fontSize="10.5" fontWeight="600" fill={c.muted} opacity="0.85">{quadrants.bl}</text>
          </g>
        )}

        {/* dots + hit targets */}
        {points.map((p, i) => {
          const x = sx(p.x)
          const y = sy(p.y)
          const isHover = hover === i
          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r={isHover ? 7 : 5.5} fill={p.color} stroke={surface} strokeWidth="1.5" style={{ transition: 'r .1s' }} opacity={hover == null || isHover ? 1 : 0.7} />
              <circle cx={x} cy={y} r="11" fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onPointerDown={() => setHover(i)} />
            </g>
          )
        })}

        {/* labels — de-collided vertically within each side, with a connector
            when a label had to be nudged off its dot */}
        {labels.map(({ i, dx, dy, ly, left }) => {
          const p = points[i]
          const dim = hover != null && hover !== i
          const tx = left ? dx - 8 : dx + 8
          return (
            <g key={`lbl-${p.id}`} opacity={dim ? 0.3 : 1}>
              {Math.abs(ly - dy) > 2 && (
                <line x1={left ? dx - 2 : dx + 2} y1={dy} x2={tx} y2={ly - 3} stroke={c.axis} strokeWidth="0.75" opacity="0.5" />
              )}
              <text x={tx} y={ly} textAnchor={left ? 'end' : 'start'} fontSize="9.5" fontWeight="600" fill={ink}>{p.label}</text>
            </g>
          )
        })}

        {/* axis titles */}
        {xLabel && <text x={(L + R) / 2} y={VB_H - 6} textAnchor="middle" fontSize="10.5" fill={c.muted}>{xLabel}</text>}
        {yLabel && <text x={13} y={(T + B) / 2} textAnchor="middle" fontSize="10.5" fill={c.muted} transform={`rotate(-90 13 ${(T + B) / 2})`}>{yLabel}</text>}
      </svg>

      {/* tooltip */}
      {hp && (
        <div
          className="pointer-events-none absolute z-10 px-2 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-700 text-white text-[10px] leading-tight shadow-lg whitespace-nowrap"
          style={{
            left: `${(sx(hp.x) / VB_W) * 100}%`,
            top: `${(sy(hp.y) / VB_H) * 100}%`,
            transform: `translate(${sx(hp.x) > VB_W / 2 ? '-108%' : '8%'}, -115%)`,
          }}
        >
          <div className="flex items-center gap-1.5 font-bold mb-0.5">
            {hp.team && <TeamLogo team={hp.team} size={4} />}
            {hp.name}
          </div>
          {hp.tip?.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{r.k}</span>
              <span className="font-bold tabular-nums">{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
