import { Trophy, TrendingUp, TrendingDown, Minus, HeartPulse, Shield } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '../engine'
import { COUNTRY_FLAG } from '../clubs'

function Delta({ from, to }) {
  const d = to - from
  const Icon = d > 0 ? TrendingUp : d < 0 ? TrendingDown : Minus
  const tone = d > 0 ? 'text-pos' : d < 0 ? 'text-neg' : 'text-fg-muted'
  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="tabular-nums font-semibold">
        {from} → {to}
      </span>
      {d !== 0 && <span className="text-2xs">({d > 0 ? '+' : ''}{d})</span>}
    </span>
  )
}

function Num({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold text-fg-strong tabular-nums leading-none">{value}</div>
      <div className="text-3xs text-fg-muted mt-1">{label}</div>
    </div>
  )
}

/**
 * What just happened.
 *
 * Without this the game had no beat: you picked a club and the next decision
 * appeared, with the season only visible as a new row in a table you weren't
 * looking at. The season IS the reward — the goals, the medal, the OVR jump —
 * so it gets its own card, above the next decision, and it re-mounts on every
 * step so the entry animation replays.
 */
export default function SeasonRecap({ blocks, isGoalkeeper }) {
  if (!blocks?.length) return null

  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const podium = b.position <= 3
        return (
          <div
            key={`${b.season}-${i}`}
            className="rounded-2xl bg-surface border border-line overflow-hidden career-enter"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div
              className="relative px-4 py-2.5 flex items-center justify-between gap-3 border-b border-line-subtle"
            >
              {/* The club's own colour, as a rule down the leading edge rather
                  than a gradient wash — it identifies the club without tinting
                  the text behind it. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 start-0 w-1"
                style={{ background: b.clubColors?.[0] || 'rgb(var(--brand))' }}
              />
              <div className="min-w-0">
                <div className="font-semibold text-fg-strong truncate">
                  {COUNTRY_FLAG[b.country] || ''} {b.clubName}
                </div>
                <div className="text-2xs text-fg-muted truncate">
                  עונת {b.season} · גיל {b.age} · {b.role}
                </div>
              </div>
              <div
                className={cn(
                  "shrink-0 text-center px-2 py-1 rounded-lg",
                  b.position === 1 ? "bg-gold/20 text-gold" : podium ? "bg-surface-chip text-fg" : "bg-surface-inset text-fg-muted"
                )}
              >
                <div className="text-sm font-bold tabular-nums leading-none">{b.position}</div>
                <div className="text-3xs opacity-70">מתוך {b.tableSize}</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 px-4 py-3">
              <Num value={b.apps} label="הופעות" />
              {isGoalkeeper ? (
                <>
                  <Num value={b.cleanSheets} label="שערים נקיים" />
                  <Num value={b.assists} label="בישולים" />
                </>
              ) : (
                <>
                  <Num value={b.goals} label="שערים" />
                  <Num value={b.assists} label="בישולים" />
                </>
              )}
              <Num value={b.wage ? formatMoney(b.wage).replace('₪', '') : '—'} label="שכר" />
            </div>

            <div className="px-4 pb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-2xs">
              <Delta from={b.overallBefore} to={b.overallAfter} />

              {b.injuryWeeks > 0 && (
                <span className="inline-flex items-center gap-1 text-danger-500">
                  <HeartPulse className="size-3.5" aria-hidden="true" />
                  פציעה · {b.injuryWeeks} שבועות
                </span>
              )}

              {b.national && (
                <span className="inline-flex items-center gap-1 text-info-500">
                  <Shield className="size-3.5" aria-hidden="true" />
                  נבחרת · {b.national.caps} הופעות
                  {b.national.goals > 0 && `, ${b.national.goals} שערים`}
                </span>
              )}
            </div>

            {b.trophies.length > 0 && (
              <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                {b.trophies.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gold/15 text-2xs font-semibold text-gold"
                  >
                    <Trophy className="size-3" aria-hidden="true" />
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
