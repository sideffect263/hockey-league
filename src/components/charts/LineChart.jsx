import { useRef, useState } from 'react'
import { useTheme } from '@/lib/ThemeContext'
import { chrome } from '@/lib/chartPalette'
import { axisTicks, scale, valueAt } from './chartUtils'

/**
 * Multi-series time line — the cumulative goal race.
 *
 * Palette rules honoured (multi-series is the strict case):
 *  - colour is NEVER the only cue. Every line is DIRECT-LABELLED at its end with
 *    the team crest + total in a de-collided right gutter, and a crest+swatch+name
 *    legend (rendered by the caller) backs it up. This is the mandatory secondary
 *    encoding for the dark-mode CVD floor band.
 *  - colour follows the ENTITY (caller passes a fixed per-team colour), so
 *    re-sorting the legend never repaints a line.
 *  - solid hairline grid + axis, 2px lines, crosshair + tooltip on hover. The
 *    tooltip is never the only way to read a value — ChartCard's table view is.
 *
 * `series` = [{ id, name, team, color, total, points:[{x:ms, y}] }] (points asc by x)
 * `xTicks` = [{ x:ms, label }]  month ticks along the bottom.
 */
const VB_W = 380
const M = { top: 12, right: 62, bottom: 22, left: 26 }

// vbH sets the viewBox height → the chart's aspect ratio. The default (250) is a
// compact card; the goal race passes a shorter value so, at full page width, it
// reads as a wide "hero" banner instead of a near-square block.
export default function LineChart({ series = [], xTicks = [], unit = '', vbH = 250 }) {
  const VB_H = vbH
  const { dark } = useTheme()
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  // A dead crest URL leaves an SVG <image> drawing nothing at all — the end-of-line
  // label loses its identity cue. <image> does fire an error event, so track the
  // failures and fall back to the coloured initial disc below (same shape as TeamLogo).
  const [crestFailed, setCrestFailed] = useState({})

  const drawable = series.filter((s) => s.points && s.points.length)
  if (!drawable.length) return null

  const c = chrome(dark)
  const ink = dark ? '#d2d8e8' : '#2d3752'
  const surface = c.surface

  const allX = drawable.flatMap((s) => s.points.map((p) => p.x))
  const tickXs = xTicks.map((t) => t.x)
  const minX = Math.min(...allX, ...tickXs)
  const maxX = Math.max(...allX)
  // Highest point, not the last one: a cumulative race ends at its max anyway, but a
  // daily series (admin ניתוח משתמשים) peaks mid-range and would be clipped.
  const maxY = Math.max(...drawable.flatMap((s) => s.points.map((p) => p.y)), 1)
  const { yMax, ticks } = axisTicks(maxY)

  const sx = scale(minX, maxX, M.left, VB_W - M.right)
  const sy = scale(0, yMax, VB_H - M.bottom, M.top)

  // Unique, sorted match-day x-values for crosshair snapping.
  const snapXs = Array.from(new Set(allX)).sort((a, b) => a - b)

  // End-of-line labels, de-collided vertically in the right gutter.
  const labelX = VB_W - M.right + 6
  const ends = drawable
    .map((s) => {
      const lp = s.points[s.points.length - 1]
      return { s, ex: sx(lp.x), ey: sy(lp.y) }
    })
    .sort((a, b) => a.ey - b.ey)
  const GAP = 15
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].ey < ends[i - 1].ey + GAP) ends[i].ey = ends[i - 1].ey + GAP
  }
  const bottom = VB_H - M.bottom
  const overflow = ends.length ? ends[ends.length - 1].ey - bottom : 0
  if (overflow > 0) ends.forEach((e) => { e.ey -= overflow })
  ends.forEach((e) => { e.ey = Math.max(M.top + 2, e.ey) })

  const handleMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const fx = (clientX - rect.left) / rect.width
    const vbX = Math.max(M.left, Math.min(VB_W - M.right, fx * VB_W))
    // nearest match-day
    let best = snapXs[0]
    let bestD = Infinity
    for (const x of snapXs) {
      const d = Math.abs(sx(x) - vbX)
      if (d < bestD) { bestD = d; best = x }
    }
    setHover(best)
  }
  const clear = () => setHover(null)

  const hoverVx = hover != null ? sx(hover) : null
  const tipRows = hover != null
    ? drawable
        .map((s) => ({ id: s.id, name: s.name, color: s.color, val: valueAt(s.points, hover) }))
        .sort((a, b) => b.val - a.val)
    : []
  const flip = hoverVx != null && hoverVx > VB_W / 2

  return (
    <div className="relative w-full">
      <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto block" role="img">
        {/* horizontal gridlines + y labels */}
        {ticks.map((t, i) => {
          const y = sy(t)
          return (
            <g key={`y${i}`}>
              <line x1={M.left} y1={y} x2={VB_W - M.right} y2={y} stroke={c.grid} strokeWidth="1" />
              <text x={M.left - 4} y={y + 3} textAnchor="end" fontSize="9" fill={c.muted}>{t}</text>
            </g>
          )
        })}

        {/* vertical month gridlines + x labels */}
        {xTicks.map((t, i) => {
          const x = sx(t.x)
          if (x < M.left - 0.5 || x > VB_W - M.right + 0.5) return null
          return (
            <g key={`x${i}`}>
              <line x1={x} y1={M.top} x2={x} y2={bottom} stroke={c.grid} strokeWidth="1" opacity="0.6" />
              <text x={x} y={bottom + 14} textAnchor="middle" fontSize="8.5" fill={c.muted}>{t.label}</text>
            </g>
          )
        })}

        {/* baseline axis */}
        <line x1={M.left} y1={bottom} x2={VB_W - M.right} y2={bottom} stroke={c.axis} strokeWidth="1" />

        {/* series lines */}
        {drawable.map((s) => (
          <polyline
            key={s.id}
            points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover == null ? 1 : 0.9}
          />
        ))}

        {/* crosshair + per-series markers at the snapped match-day */}
        {hoverVx != null && (
          <g pointerEvents="none">
            <line x1={hoverVx} y1={M.top} x2={hoverVx} y2={bottom} stroke={c.axis} strokeWidth="1" />
            {drawable.map((s) => (
              <circle key={s.id} cx={hoverVx} cy={sy(valueAt(s.points, hover))} r="3" fill={s.color} stroke={surface} strokeWidth="1.5" />
            ))}
          </g>
        )}

        {/* end-of-line direct labels: leader → crest → total */}
        {ends.map(({ s, ex, ey }) => {
          const cy = ey
          const cx = labelX + 7
          return (
            <g key={`end-${s.id}`} pointerEvents="none">
              <line x1={ex} y1={sy(s.points[s.points.length - 1].y)} x2={labelX - 2} y2={cy} stroke={s.color} strokeWidth="1" opacity="0.5" />
              <clipPath id={`lc-${s.id}`}><circle cx={cx} cy={cy} r="7" /></clipPath>
              {s.team?.logo_url && !crestFailed[s.id] ? (
                <>
                  <circle cx={cx} cy={cy} r="7" fill="#fff" />
                  <image href={s.team.logo_url} x={labelX + 1} y={cy - 6} width="12" height="12" clipPath={`url(#lc-${s.id})`} preserveAspectRatio="xMidYMid meet"
                         onError={() => setCrestFailed((f) => ({ ...f, [s.id]: true }))} />
                </>
              ) : (
                <>
                  <circle cx={cx} cy={cy} r="7" fill={s.color} />
                  <text x={cx} y={cy + 3} textAnchor="middle" fontSize="8" fill="#fff">{s.name?.charAt(0)}</text>
                </>
              )}
              <circle cx={cx} cy={cy} r="7" fill="none" stroke={surface} strokeWidth="1.5" />
              <text x={labelX + 17} y={cy + 3} fontSize="9" fontWeight="700" fill={ink}>{s.total}</text>
            </g>
          )
        })}

        {/* hover capture over the plot */}
        <rect
          x={M.left}
          y={M.top}
          width={VB_W - M.right - M.left}
          height={bottom - M.top}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={clear}
          onTouchStart={handleMove}
          onTouchMove={handleMove}
        />
      </svg>

      {/* tooltip */}
      {hover != null && (
        <div
          className="pointer-events-none absolute z-10 top-1 px-2 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-700 text-white text-[10px] leading-tight shadow-lg"
          style={{ left: `${(hoverVx / VB_W) * 100}%`, transform: `translateX(${flip ? 'calc(-100% - 8px)' : '8px'})` }}
        >
          <div className="font-bold mb-0.5">{new Date(hover).toLocaleDateString('he-IL')}</div>
          <div className="space-y-0.5">
            {tipRows.map((r) => (
              <div key={r.id} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
                <span className="flex-1">{r.name}</span>
                <span className="font-bold tabular-nums">{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
