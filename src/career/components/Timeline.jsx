import { Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRY_FLAG } from '../clubs'

/**
 * Season-by-season history — the thing players screenshot.
 *
 * Deliberately NOT a table any more. At six columns the headers had to be
 * abbreviated to "ש/ב" and the club name was squeezed into a third of the
 * width; as a list of rows, the club leads and the numbers sit under it where
 * there is room to label them.
 */
export default function Timeline({ blocks, highlightFrom = 0 }) {
  if (!blocks.length) {
    return (
      <div className="rounded-2xl bg-surface border border-line p-6 text-center">
        <p className="text-sm text-fg-muted text-pretty">
          הקריירה עוד לא התחילה. בחר מחלקת נוער כדי לשחק את העונה הראשונה.
        </p>
      </div>
    )
  }

  return (
    <section className="rounded-2xl bg-surface border border-line overflow-hidden">
      <header className="px-4 py-2.5 border-b border-line-subtle flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg-strong">מסלול הקריירה</h2>
        <span className="text-2xs text-fg-muted tabular-nums">{blocks.length} עונות</span>
      </header>

      <ol className="max-h-[30rem] overflow-y-auto">
        {blocks.map((b, i) => {
          const delta = b.overallAfter - b.overallBefore
          return (
            <li
              key={`${b.season}-${b.clubId}-${i}`}
              className={cn(
                'relative px-4 py-2.5 border-b border-line-subtle last:border-0',
                i >= highlightFrom && 'bg-brand/5'
              )}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 start-0 w-1"
                style={{ background: b.clubColors?.[0] || 'rgb(var(--line))' }}
              />

              <div className="flex items-baseline gap-2">
                <span className="text-2xs text-fg-muted tabular-nums shrink-0 w-6">{b.age}</span>
                <span className="font-medium text-fg-strong truncate min-w-0 flex-1">
                  <span aria-hidden="true">{COUNTRY_FLAG[b.country] || ''}</span> {b.clubName}
                </span>
                <span className="text-sm font-bold text-fg-strong tabular-nums shrink-0">{b.overallAfter}</span>
                {delta !== 0 && (
                  <span className={cn('text-3xs tabular-nums shrink-0', delta > 0 ? 'text-pos' : 'text-neg')}>
                    {delta > 0 ? '+' : ''}{delta}
                  </span>
                )}
              </div>

              <div className="ps-8 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
                <span className="truncate">{b.league} · {b.role}</span>
                <span className="tabular-nums">
                  {b.apps} הופעות · {b.goals} שערים · {b.assists} בישולים
                </span>
                {b.injuryWeeks > 0 && (
                  <span className="text-danger-500 tabular-nums">פציעה · {b.injuryWeeks} שב׳</span>
                )}
              </div>

              {b.trophies.length > 0 && (
                <div className="ps-8 mt-1 flex flex-wrap gap-1">
                  {b.trophies.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-chip bg-gold/15 text-3xs text-gold"
                    >
                      <Trophy className="size-2.5" aria-hidden="true" />
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
