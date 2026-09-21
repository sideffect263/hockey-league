import { useMemo, useId } from 'react'
import { pct } from '@/lib/market'
import { useTheme } from '@/lib/ThemeContext'
import { seriesTeamColors } from '@/lib/teamMarkColor'

const W = 640, PAD_Y = 10

/** The outcomes a chart draws: the front of the field, never more than three. */
export const topOutcomes = market => [...market.outcomes].sort((a, b) => b.price - a.price).slice(0, 3)

/**
 * Line colour per drawn outcome, keyed by outcome id.
 *
 * Exported so the featured card can dot its outcome rows in the same colours the
 * chart drew them in, instead of repeating the chart's legend right next to it.
 * Colour follows the entity, not the ranking: if a line overtakes another the
 * colours must not swap, or a reader who learned "רמת ישי is the red one" is
 * misled the moment the lead changes.
 */
export function useSeriesColors(market) {
  const { dark } = useTheme()
  return useMemo(() => {
    const top = topOutcomes(market)
    const cs = seriesTeamColors(
      top.map(o => ({
        color: o.markTeam?.primary_color,
        teamId: o.markTeam?.id || o.id,
      })),
      dark,
    )
    return new Map(top.map((o, i) => [o.id, cs[i]]))
  }, [market, dark])
}

/**
 * How the odds moved.
 *
 * Every trade stored the whole price map as it stood immediately after it, so the
 * series needs no reconstruction and can never disagree with the book. Only the
 * leading outcomes are drawn: on a 20-runner futures market, twenty lines is a
 * scribble, and the story is always at the front of the field.
 *
 * Lines are coloured by team — the club's own hue, conditioned to be visible on
 * the card (see lib/teamMarkColor). They used to be one emerald at three
 * opacities, which made the leader and the third-placed line the same colour at
 * different strengths: legible as a ranking, useless for telling בלג נוער from
 * קריית ביאליק. A player's line takes the colour of the team they play for.
 *
 * `variant="hero"` is the same chart, taller, with the probability scale and the
 * live price called out — for the featured slot, where the graph is the point of
 * the card rather than one panel inside it.
 */
export default function PriceChart({ market, trades, variant = 'card' }) {
  const gid = useId()
  const colorOf = useSeriesColors(market)
  const hero = variant === 'hero'
  const H = hero ? 220 : 160

  const { series, empty, points } = useMemo(() => {
    // Oldest first — getTrades returns newest first for the tape.
    const rows = [...(trades || [])].reverse().filter(t => t.prices && typeof t.prices === 'object')

    // The opening price is real data, not padding: before the first coin moved
    // every outcome sat at 1/n, and the field is frozen the moment a market
    // trades, so that opening is exactly this field at even odds. Seeding it
    // means the first trade already has a line to move, instead of a market
    // reading "not enough trading" until somebody bets a second time.
    const n = market.outcomes.length
    const open = { prices: Object.fromEntries(market.outcomes.map(o => [o.id, 1 / n])) }
    // An untraded market has one point, which is not a line. The card says so
    // and shows nothing; the featured slot — which exists to hold a graph —
    // draws the opening price flat across, captioned as exactly that.
    const all = rows.length ? [open, ...rows] : (hero ? [open, open] : [open])
    if (all.length < 2) return { series: [], empty: true, points: 0 }

    const top = topOutcomes(market)
    const len = all.length
    return {
      empty: false,
      points: rows.length,
      series: top.map(o => ({
        outcome: o,
        open: Number(all[0].prices[o.id] ?? 0),
        points: all.map((t, i) => {
          const p = Number(t.prices[o.id] ?? 0)
          return [
            len === 1 ? W : (i / (len - 1)) * W,
            H - PAD_Y - p * (H - PAD_Y * 2),
          ]
        }),
      })),
    }
  }, [trades, market, H, hero])

  if (empty) {
    return (
      <div className={hero ? '' : 'mkt-card p-4'}>
        <p className="text-xs text-fg-subtle text-center py-8">
          עדיין אין מספיק מסחר כדי להציג גרף
        </p>
      </div>
    )
  }

  const chart = (
    <>
      {/* The featured card lists these outcomes, in these colours, right beside
          the chart — a legend there would say everything twice. */}
      {!hero && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {series.map(s => (
            <span key={s.outcome.id} className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: colorOf.get(s.outcome.id) }} />
              <span className="text-fg-muted truncate max-w-[120px]">{s.outcome.label}</span>
              <span className="mkt-num text-fg-strong">{pct(s.outcome.price)}</span>
            </span>
          ))}
        </div>
      )}

      {/* The scale sits in HTML rather than in the SVG: the graph is stretched to
          the card's width (preserveAspectRatio="none"), which would squash any
          text or circle drawn inside it. */}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none"
          role="img" aria-label="גרף מחירים">
          {[0.25, 0.5, 0.75].map(g => (
            <line key={g} x1="0" x2={W} y1={H - PAD_Y - g * (H - PAD_Y * 2)} y2={H - PAD_Y - g * (H - PAD_Y * 2)}
              stroke="rgb(var(--line))" strokeWidth="1" strokeDasharray="3 4" />
          ))}
          {series.map((s, i) => (
            <g key={s.outcome.id}>
              <defs>
                <linearGradient id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorOf.get(s.outcome.id)} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={colorOf.get(s.outcome.id)} stopOpacity="0" />
                </linearGradient>
              </defs>
              {i === 0 && (
                <polygon fill={`url(#${gid}-${i})`}
                  points={`0,${H} ${s.points.map(p => p.join(',')).join(' ')} ${W},${H}`} />
              )}
              <polyline
                fill="none" stroke={colorOf.get(s.outcome.id)}
                strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={s.points.map(p => p.join(',')).join(' ')} />
            </g>
          ))}
        </svg>

        {hero && (
          <>
            {[1, 0.5, 0].map(g => (
              <span key={g} dir="ltr"
                className="mkt-num absolute text-[10px] text-fg-subtle start-0 -translate-y-1/2 bg-surface/80 px-1 rounded pointer-events-none"
                style={{ top: `${((1 - g) * (H - PAD_Y * 2) + PAD_Y) / H * 100}%` }}>
                {Math.round(g * 100)}%
              </span>
            ))}
            {/* The leader's live price, parked at the end of its own line. */}
            <span dir="ltr"
              className="mkt-num absolute end-0 -translate-y-1/2 text-[11px] font-bold px-1.5 py-0.5 rounded-md pointer-events-none"
              style={{
                top: `${series[0].points.at(-1)[1] / H * 100}%`,
                color: colorOf.get(series[0].outcome.id),
                backgroundColor: 'rgb(var(--surface-sunken))',
              }}>
              {pct(series[0].outcome.price)}
            </span>
          </>
        )}
      </div>

      {hero && (
        <p className="text-[10px] text-fg-subtle mt-2">
          {points > 0
            ? `מפתיחת השוק ועד עכשיו · ${points === 1 ? 'עסקה אחת' : `${points} עסקאות`}`
            : 'השוק עוד לא נסחר — המחירים הם מחירי הפתיחה'}
        </p>
      )}
    </>
  )

  return hero ? chart : <div className="mkt-card p-4">{chart}</div>
}
