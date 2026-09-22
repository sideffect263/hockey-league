import { useState } from 'react'
import { Trophy, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FOREIGN_CLUBS, BAND_LABEL, COUNTRY_FLAG } from '../clubs'
import Setup from './Setup'

/**
 * The ladder, built from the real club table.
 *
 * This exists because the first landing page was a headline and a button in
 * the middle of an empty 900px viewport — it said nothing about the sport, the
 * stakes, or what you were about to do. The ladder IS the game, it is made
 * entirely of real clubs, and showing it answers "what am I playing" in one
 * glance. Israeli rungs name our own clubs; the rest sample the table.
 */
function ladderRungs(israeliTeams) {
  const sample = (band, n) =>
    FOREIGN_CLUBS.filter((c) => c.band === band)
      .sort((a, b) => b.baseOverall - a.baseOverall)
      .slice(0, n)
      .map((c) => `${COUNTRY_FLAG[c.country] || ''} ${c.name}`)

  const local = (israeliTeams || []).slice(0, 3).map((t) => `🇮🇱 ${t.name}`)

  // Top of the list is the top of the ladder. Built the other way round first,
  // which put the biggest rung at the BOTTOM — directly contradicting the
  // sentence beside it saying Barcelona is six steps *above* you.
  return [
    { band: 'world', note: 'ליגת האלופות', clubs: sample('world', 3) },
    { band: 'elite', note: 'ליגות הצמרת של הענף', clubs: sample('elite', 3) },
    { band: 'strong', note: 'ליגות מקצועניות', clubs: sample('strong', 3) },
    { band: 'entry', note: 'החוזה הראשון בחו״ל', clubs: sample('entry', 3) },
    { band: 'israel', note: 'שבע קבוצות, ליגה אחת', clubs: local },
    { band: 'academy', note: 'כאן אתה מתחיל, בגיל 16', clubs: local, start: true },
  ]
}

function Rung({ rung, index, total }) {
  // Each rung is visually stronger than the one below it, so the size of the
  // climb is something you see rather than read.
  const strength = 1 - index / (total - 1)
  return (
    <li className="relative flex items-stretch gap-3">
      <div className="flex flex-col items-center shrink-0 w-6" aria-hidden="true">
        <span
          className={cn('rounded-full shrink-0 mt-3.5', rung.start ? 'size-3.5 ring-4 ring-brand/20' : 'size-2.5')}
          style={{ background: `rgb(var(--brand) / ${0.25 + strength * 0.75})` }}
        />
        {index < total - 1 && <span className="w-px flex-1 bg-line" />}
      </div>

      <div className="flex-1 min-w-0 pb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3
            className={cn('font-semibold', rung.start ? 'text-brand' : 'text-fg-strong')}
            style={{ fontSize: `${0.875 + strength * 0.25}rem` }}
          >
            {BAND_LABEL[rung.band]}
          </h3>
          {rung.start && (
            <span className="px-1.5 py-0.5 rounded-chip bg-brand/15 text-3xs font-semibold text-brand">
              נקודת ההתחלה
            </span>
          )}
          <span className="text-2xs text-fg-muted text-pretty">{rung.note}</span>
        </div>
        <p className="text-2xs text-fg-muted mt-1 truncate">{rung.clubs.join(' · ')}</p>
      </div>
    </li>
  )
}

export default function Landing({ hall, teams, onStart }) {
  const [setup, setSetup] = useState(false)
  if (setup) return <Setup onStart={onStart} onBack={() => setSetup(false)} />

  const rungs = ladderRungs(teams)

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black text-fg-strong text-balance">
            ליגיונר על גלגלים
          </h1>
          <p className="text-fg-muted mt-3 text-pretty">
            ישראל מדורגת 26 בעולם בהוקי גלגיליות, והליגה שלנו מונה שבע קבוצות.
            ברצלונה נמצאת שישה שלבים מעליך.
          </p>
          <p className="text-fg-muted mt-2 text-pretty">
            אתה מתחיל בן 16 במחלקת נוער אמיתית מהליגה הישראלית, ומקבל החלטה בכל עונה.
            הגורל עושה את השאר.
          </p>

          <button
            onClick={() => setSetup(true)}
            className={cn(
              'mt-6 inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl',
              'bg-brand text-brand-fg font-bold text-lg transition-colors hover:bg-brand-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60'
            )}
          >
            להתחיל קריירה
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>

          <p className="text-3xs text-fg-subtle mt-3">
            בלי הרשמה · הקריירה נשמרת במכשיר שלך
          </p>
        </div>

        <section className="rounded-2xl bg-surface border border-line p-5">
          <h2 className="text-sm font-semibold text-fg-strong mb-4">הסולם</h2>
          <ol className="flex flex-col">
            {rungs.map((r, i) => (
              <Rung key={r.band} rung={r} index={i} total={rungs.length} />
            ))}
          </ol>
        </section>
      </div>

      {hall.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-fg-muted mb-3 flex items-center gap-2">
            <Trophy className="size-4" aria-hidden="true" />
            הקריירות שלך
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {hall.slice(0, 8).map((h) => (
              <div
                key={h.seed}
                className="rounded-xl bg-surface border border-line px-3 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-fg-strong truncate">{h.lastName}</p>
                  <p className="text-2xs text-fg-muted truncate">
                    {h.topBand} · {h.seasons} עונות · {h.goals} שערים
                    {h.trophies > 0 && ` · ${h.trophies} תארים`}
                  </p>
                </div>
                <div className="shrink-0 text-center">
                  <p className="font-bold text-fg-strong tabular-nums">{h.peak}</p>
                  <p className="text-3xs text-fg-muted">שיא OVR</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
