import { ChevronLeft, Trophy, ArrowUp, ArrowDown, Equal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatMoney } from '../engine'
import { COUNTRY_FLAG, BAND_BADGE, CONTINENTAL_LABEL } from '../clubs'

/**
 * How this club sits relative to you.
 *
 * Worth surfacing because it is genuinely load-bearing now: growth scales with
 * how far ABOVE you a club is, so "a level up" is the mechanically interesting
 * move, not just a flavour note. Without this the player is guessing.
 */
function levelOf(overall, club) {
  const gap = overall - club.baseOverall
  if (gap <= -4) return { icon: ArrowUp, label: 'רמה מעליך', tone: 'text-brand' }
  if (gap >= 5) return { icon: ArrowDown, label: 'מתחת לרמה שלך', tone: 'text-fg-muted' }
  return { icon: Equal, label: 'ברמה שלך', tone: 'text-fg-muted' }
}

function Option({ children, onPick, optionKey, accent }) {
  return (
    <button
      onClick={() => onPick(optionKey)}
      className={cn(
        'group relative w-full text-right rounded-xl border border-line bg-surface-inset p-3',
        'flex items-center gap-3 transition-colors hover:bg-surface-sunken',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'
      )}
    >
      {accent && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-1 rounded-s-xl"
          style={{ background: accent }}
        />
      )}
      <div className="min-w-0 flex-1">{children}</div>
      <ChevronLeft className="size-4 text-fg-subtle shrink-0" aria-hidden="true" />
    </button>
  )
}

function OfferOption({ option, overall, onPick }) {
  const c = option.club
  const level = c ? levelOf(overall, c) : null
  const LevelIcon = level?.icon

  return (
    <Option optionKey={option.key} onPick={onPick} accent={c?.colors?.[0]}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-fg-strong truncate">
          <span aria-hidden="true">{COUNTRY_FLAG[c?.country] || ''}</span> {option.label}
        </span>
        {c && (
          <span className="px-1.5 py-0.5 rounded-chip bg-surface-chip text-3xs text-fg-muted">
            {BAND_BADGE[c.band]}
          </span>
        )}
        {c?.continental && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-chip bg-gold/15 text-3xs text-gold">
            <Trophy className="size-2.5" aria-hidden="true" />
            {CONTINENTAL_LABEL[c.continental]}
          </span>
        )}
      </div>

      <div className="text-2xs text-fg-muted mt-0.5 truncate">{option.sub}</div>

      <div className="mt-1.5 flex items-center gap-3 text-2xs">
        {level && (
          <span className={cn('inline-flex items-center gap-1', level.tone)}>
            <LevelIcon className="size-3" aria-hidden="true" />
            {level.label}
          </span>
        )}
        {option.role && <span className="text-fg">{option.role}</span>}
        {option.wage > 0 && <span className="text-fg-muted tabular-nums">{formatMoney(option.wage)}</span>}
      </div>
    </Option>
  )
}

function EventOption({ option, onPick }) {
  return (
    <Option optionKey={option.key} onPick={onPick}>
      <div className="font-semibold text-fg-strong text-pretty">{option.label}</div>
      <div className="text-2xs text-fg-muted mt-0.5 text-pretty">{option.sub}</div>
      {/* The odds are shown on purpose. A gamble you can't price isn't a
          decision, it's a coin flip with extra steps. */}
      {option.p != null && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1 w-16 rounded-full bg-surface-chip overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${option.p * 100}%` }} />
          </span>
          <span className="text-2xs text-fg-muted tabular-nums">{Math.round(option.p * 100)}% להצליח</span>
        </div>
      )}
    </Option>
  )
}

/**
 * The question. Given more visual weight than anything else on the page — a
 * heavier border and a labelled header — because when every panel shared one
 * card style, the thing you had to act on looked exactly like the history
 * table you were only reading.
 */
export default function DecisionCard({ card, overall, onPick }) {
  if (!card) return null

  return (
    <section className="rounded-2xl bg-surface border-2 border-brand/25 shadow-card">
      <header className="px-4 pt-4">
        <p className="text-3xs font-semibold uppercase text-brand mb-1">ההחלטה שלך</p>
        <h2 className="text-xl font-bold text-fg-strong text-balance">{card.title}</h2>
        <p className="text-sm text-fg-muted mt-1 text-pretty">{card.description}</p>
      </header>

      <div className="p-4 space-y-2">
        {card.options.map((o) =>
          o.kind === 'event' ? (
            <EventOption key={o.key} option={o} onPick={onPick} />
          ) : o.kind === 'retire' ? (
            <Option key={o.key} optionKey={o.key} onPick={onPick}>
              <div className="font-semibold text-fg-strong">{o.label}</div>
              <div className="text-2xs text-fg-muted mt-0.5">{o.sub}</div>
            </Option>
          ) : (
            <OfferOption key={o.key} option={o} overall={overall} onPick={onPick} />
          )
        )}
      </div>
    </section>
  )
}
