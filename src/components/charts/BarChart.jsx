import { useState } from 'react'
import { useTheme } from '@/lib/ThemeContext'
import { singleColor } from '@/lib/chartPalette'
import { flChrome } from '@/components/fl/teams/flChart'
import { axisTicks, barPathTop, scale } from './chartUtils'

/**
 * Vertical single-series bar chart (monthly league goals, hat-tricks per month…).
 *
 * Palette rules honoured:
 *  - ONE series → ONE colour for every bar (never a value-ramp).
 *  - solid hairline gridlines + axis (never dashed), thin bars, generous padding,
 *    4px rounded tops anchored to the baseline.
 *  - the extreme is direct-labelled; the rest read via hover tooltip + the table
 *    view that ChartCard provides.
 *  - a zero-value datum (April) draws no bar but keeps its x-label, so the gap
 *    stays visible instead of collapsing.
 *
 * `data` = [{ label, value, lines?: string[] }]   `unit` = e.g. 'שערים'
 */
const VB_W = 380
const VB_H = 208
const M = { top: 16, right: 10, bottom: 26, left: 28 }

export default function BarChart({ data = [], unit = '', color }) {
  const { dark } = useTheme()
  const [hover, setHover] = useState(null)

  if (!data.length) return null

  const c = flChrome(dark)
  const barColor = color || singleColor(dark)
  const ink = flChrome(dark).ink

  const plotW = VB_W - M.left - M.right
  const plotH = VB_H - M.top - M.bottom
  const baseY = M.top + plotH

  const maxVal = Math.max(...data.map((d) => d.value), 0)
  const { yMax, ticks } = axisTicks(maxVal)
  const sy = scale(0, yMax, baseY, M.top)

  const slot = plotW / data.length
  const barW = Math.min(slot * 0.55, 26)
  const slotX = (i) => M.left + slot * i
  const barX = (i) => slotX(i) + (slot - barW) / 2

  // Index of the tallest bar — the one datum we print a number on.
  let maxIdx = 0
  data.forEach((d, i) => { if (d.value > data[maxIdx].value) maxIdx = i })

  const hd = hover != null ? data[hover] : null

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto block" role="img">
        {/* horizontal gridlines + y labels (solid hairlines) */}
        {ticks.map((t, i) => {
          const y = sy(t)
          return (
            <g key={i}>
              <line x1={M.left} y1={y} x2={VB_W - M.right} y2={y} stroke={c.grid} strokeWidth="1" />
              <text x={M.left - 5} y={y + 3} textAnchor="end" fontSize="9" fill={c.muted}>{t}</text>
            </g>
          )
        })}
        {/* baseline axis */}
        <line x1={M.left} y1={baseY} x2={VB_W - M.right} y2={baseY} stroke={c.axis} strokeWidth="1" />

        {/* bars */}
        {data.map((d, i) => {
          const h = baseY - sy(d.value)
          const x = barX(i)
          const y = sy(d.value)
          const isHover = hover === i
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={barPathTop(x, y, barW, h, 4)}
                  fill={barColor}
                  opacity={hover == null || isHover ? 1 : 0.55}
                  style={{ transition: 'opacity .12s' }}
                />
              )}
              {/* x label */}
              <text x={slotX(i) + slot / 2} y={baseY + 15} textAnchor="middle" fontSize="8.5" fill={c.muted}>
                {d.label}
              </text>
              {/* direct-label only the extreme */}
              {i === maxIdx && d.value > 0 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill={ink}>
                  {d.value}
                </text>
              )}
              {/* full-height transparent hit target */}
              <rect
                x={slotX(i)}
                y={M.top}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onPointerDown={() => setHover(i)}
              />
            </g>
          )
        })}
      </svg>

      {/* tooltip — percentage-positioned so it tracks the SVG at any width */}
      {hd && (
        <div
          className="pointer-events-none absolute z-10 px-2 py-1.5 rounded-lg bg-slate-900/95 dark:bg-slate-700 text-white text-[10px] leading-tight shadow-lg whitespace-nowrap"
          style={{
            left: `${((slotX(hover) + slot / 2) / VB_W) * 100}%`,
            top: `${(sy(hd.value) / VB_H) * 100}%`,
            transform: 'translate(-50%, -115%)',
          }}
        >
          <div className="font-bold">{hd.label}</div>
          <div>{hd.value} {unit}</div>
          {hd.lines?.map((l, i) => <div key={i} className="text-slate-300">{l}</div>)}
        </div>
      )}
    </div>
  )
}
