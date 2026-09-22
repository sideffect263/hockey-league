import { useState } from 'react'
import { cn } from '@/lib/utils'
import { POSITIONS, CADENCES } from '../engine'

/**
 * The shirt.
 *
 * Costs almost nothing and does the most work on this screen: typing your own
 * surname and watching it appear on a jersey is the moment the career becomes
 * yours rather than a form you are filling in. Without it the setup page was
 * four inputs and a button, and nothing about it suggested a game.
 */
function Jersey({ lastName, number }) {
  return (
    <div className="rounded-2xl bg-surface-inset border border-line p-5 grid place-items-center">
      <svg viewBox="0 0 120 130" className="w-40 h-auto" role="img" aria-label="תצוגת חולצה">
        <path
          d="M40 8 L20 18 L8 40 L24 50 L24 122 A4 4 0 0 0 28 126 L92 126 A4 4 0 0 0 96 122 L96 50 L112 40 L100 18 L80 8 A22 16 0 0 1 40 8 Z"
          fill="rgb(var(--brand))"
        />
        <text
          x="60" y="58" textAnchor="middle"
          className="fill-brand-fg"
          style={{ fontSize: 13, fontWeight: 700 }}
        >
          {(lastName || 'שם').slice(0, 12)}
        </text>
        <text
          x="60" y="102" textAnchor="middle"
          className="fill-brand-fg tabular-nums"
          style={{ fontSize: 42, fontWeight: 900 }}
        >
          {number}
        </text>
      </svg>
    </div>
  )
}

function Choice({ selected, onClick, children, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-xl border px-3 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        selected
          ? 'bg-brand text-brand-fg border-brand'
          : 'bg-surface-inset border-line text-fg hover:bg-surface-sunken',
        className
      )}
    >
      {children}
    </button>
  )
}

export default function Setup({ onStart, onBack }) {
  const [lastName, setLastName] = useState('')
  const [number, setNumber] = useState(9)
  const [hand, setHand] = useState('right')
  const [position, setPosition] = useState('FWD')
  const [cadence, setCadence] = useState('intense')

  const cad = CADENCES.find((c) => c.key === cadence)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-fg-strong text-balance">הגדר את הזהות שלך</h1>
      <p className="text-sm text-fg-muted mt-1 mb-6 text-pretty">
        שחקן הוקי גלגיליות ישראלי בן 16. מכאן זה תלוי בך — ובמזל.
      </p>

      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Jersey lastName={lastName} number={number} />

        <div className="space-y-4">
          <section className="rounded-2xl bg-surface border border-line p-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="career-lastname" className="block text-2xs text-fg-muted mb-1">
                  שם משפחה
                </label>
                <input
                  id="career-lastname"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="שם משפחה"
                  maxLength={16}
                  className="w-full rounded-xl bg-surface-inset border border-line px-3 py-2 text-fg-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                />
              </div>
              <div>
                <label htmlFor="career-number" className="block text-2xs text-fg-muted mb-1">
                  מספר
                </label>
                <input
                  id="career-number"
                  type="number"
                  min={1}
                  max={99}
                  value={number}
                  onChange={(e) => setNumber(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                  className="w-full rounded-xl bg-surface-inset border border-line px-3 py-2 text-fg-strong tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                />
              </div>
            </div>

            <p className="text-2xs text-fg-muted mt-4 mb-1">יד חזקה</p>
            <div className="grid grid-cols-2 gap-2">
              {[['right', 'ימין'], ['left', 'שמאל']].map(([k, label]) => (
                <Choice key={k} selected={hand === k} onClick={() => setHand(k)}>
                  {label}
                </Choice>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-surface border border-line p-5">
            <p className="text-2xs text-fg-muted mb-2">עמדה</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
              {POSITIONS.map((p) => (
                <Choice
                  key={p.key}
                  selected={position === p.key}
                  onClick={() => setPosition(p.key)}
                  className="py-3"
                >
                  <span className="block font-semibold">{p.label}</span>
                  <span className="block text-3xs opacity-70">{p.key}</span>
                </Choice>
              ))}
            </div>

            <p className="text-2xs text-fg-muted mb-2">החלטה כל</p>
            <div className="grid grid-cols-3 gap-2">
              {CADENCES.map((c) => (
                <Choice key={c.key} selected={cadence === c.key} onClick={() => setCadence(c.key)}>
                  {c.label}
                </Choice>
              ))}
            </div>
            <p className="text-2xs text-fg-muted mt-2 text-pretty">{cad?.note}</p>
          </section>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        {onBack && (
          <button
            onClick={onBack}
            className="px-5 py-3 rounded-xl border border-line text-fg text-sm hover:bg-surface-sunken transition-colors"
          >
            חזרה
          </button>
        )}
        <button
          onClick={() => onStart({ lastName: lastName.trim() || 'השחקן', number, hand, position, cadence })}
          className="flex-1 px-5 py-3 rounded-xl bg-brand text-brand-fg font-semibold hover:bg-brand-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          להתחיל קריירה
        </button>
      </div>
    </div>
  )
}
