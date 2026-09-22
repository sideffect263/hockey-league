import { cn } from '@/lib/utils'
import { formatMoney } from '../engine'
import { COUNTRY_FLAG, BAND_BADGE } from '../clubs'

function Stat({ label, value, strong = false }) {
  return (
    <div className="text-center">
      <div className={cn('font-bold text-fg-strong tabular-nums leading-none', strong ? 'text-2xl' : 'text-lg')}>
        {value}
      </div>
      <div className="text-2xs text-fg-muted mt-1">{label}</div>
    </div>
  )
}

/**
 * Identity strip. Full width at the top of the screen rather than a card in a
 * column, because it answers "who am I right now" — the question every other
 * panel is relative to — and squeezing it into a third of the page made the
 * numbers too small to read at a glance.
 */
export default function PlayerHud({ state, club }) {
  const { identity, player, totals, national } = state
  const isGoalkeeper = player.archetype === 'goalkeeper'
  const flag = COUNTRY_FLAG[club?.country] || COUNTRY_FLAG.IL
  const ceiling = Math.max(player.potential, player.overall)

  return (
    <div className="rounded-2xl bg-surface border border-line">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4">
        {/* Identity */}
        <div className="flex items-center gap-4 min-w-0 sm:flex-1">
          {/* The ring reads current OVR against this player's OWN ceiling —
              "is there still room to grow" is the single most useful thing to
              know mid-career, and it was previously invisible. */}
          <div className="relative size-16 shrink-0">
            <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(var(--surface-chip))" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="16" fill="none"
                stroke="rgb(var(--brand))" strokeWidth="3" strokeLinecap="round"
                pathLength="100"
                strokeDasharray={`${Math.round((player.overall / ceiling) * 100)} 100`}
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-3xs leading-none text-fg-muted">OVR</div>
              <div className="text-2xl font-black leading-none tabular-nums text-fg-strong">{player.overall}</div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-fg-strong truncate">{identity.lastName}</span>
              <span className="text-xs text-fg-muted tabular-nums shrink-0">
                #{identity.number} · {player.position}
              </span>
            </div>
            <div className="text-sm text-fg truncate mt-0.5">
              <span aria-hidden="true">{flag}</span> {club ? club.name : 'שחקן חופשי'}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-2xs text-fg-muted">
              <span className="tabular-nums">גיל {player.age}</span>
              {club && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{club.league}</span>
                  <span className="px-1.5 py-0.5 rounded-chip bg-surface-chip text-3xs shrink-0">
                    {BAND_BADGE[club.band]}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Career totals. Goalkeepers are not measured in goals — showing one a
            permanent "0 שערים" made the headline stat useless. */}
        <div className="grid grid-cols-4 gap-2 sm:gap-4 sm:border-e sm:border-line-subtle sm:pe-4">
          <Stat strong label="הופעות" value={totals.apps} />
          <Stat
            strong
            label={isGoalkeeper ? 'שערים נקיים' : 'שערים'}
            value={isGoalkeeper ? totals.cleanSheets : totals.goals}
          />
          <Stat strong label="בישולים" value={totals.assists} />
          <Stat strong label="תארים" value={state.trophies.length} />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:w-44">
          <Stat label="רווחי קריירה" value={formatMoney(state.careerEarnings)} />
          <Stat label="נבחרת ישראל" value={national.caps} />
        </div>
      </div>
    </div>
  )
}
