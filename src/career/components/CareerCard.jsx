import { useState } from 'react'
import { Trophy, Share2, Check, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { careerSummary, careerGrade, formatMoney } from '../engine'
import { shareUrl } from '../storage'
import { COUNTRY_FLAG } from '../clubs'

/** Colour per grade — gold at the top, cooling as it descends. */
const TONE = {
  S: 'text-gold', A: 'text-gold', B: 'text-brand',
  C: 'text-brand', D: 'text-fg', E: 'text-fg-muted',
}

function Big({ label, value }) {
  return (
    <div className="rounded-xl bg-surface-inset p-3 text-center">
      <div className="text-xl font-bold text-fg-strong tabular-nums">{value}</div>
      <div className="text-2xs text-fg-muted mt-0.5">{label}</div>
    </div>
  )
}

export default function CareerCard({ state, config, choices, onRestart }) {
  const [copied, setCopied] = useState(false)
  const sum = careerSummary(state)
  const g = { ...careerGrade(sum), tone: '' }
  g.tone = TONE[g.key]

  // Trophies collapse to name + count — twelve separate "אליפות OK ליגה" rows
  // is a worse brag than "אליפות OK ליגה ×4".
  const byName = sum.trophies.reduce((m, t) => ({ ...m, [t.name]: (m[t.name] || 0) + 1 }), {})

  const share = async () => {
    const url = shareUrl(config, choices)
    const text = `${config.lastName} · ${g.label} · שיא OVR ${sum.peak} · ${sum.goals} שערים ב-${sum.seasons} עונות`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'ליגיונר על גלגלים', text, url })
        return
      }
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      /* the user dismissed the share sheet — nothing to report */
    }
  }

  return (
    <div className="rounded-2xl bg-surface border border-line overflow-hidden">
      <div className="p-5 bg-brand/10 border-b border-line-subtle">
        <div className="flex items-start gap-4">
          <div className="shrink-0 size-16 rounded-2xl bg-surface-inset grid place-items-center">
            <div className={cn("text-3xl font-black", g.tone)}>{g.key}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-fg-muted">סוף הקריירה</div>
            <h2 className="text-xl font-bold text-fg-strong truncate text-balance">
              {config.lastName} <span className="text-fg-muted font-normal">#{config.number}</span>
            </h2>
            <div className={cn("text-sm font-semibold", g.tone)}>{g.label}</div>
            <div className="text-2xs text-fg-muted mt-0.5">
              הגיע עד: {sum.topBandLabel} · שיא OVR {sum.peak}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pb-1">
        <Big label="עונות" value={sum.seasons} />
        <Big label="הופעות" value={sum.apps} />
        <Big label="שערים" value={sum.goals} />
        <Big label="בישולים" value={sum.assists} />
        <Big label="מועדונים" value={sum.clubCount} />
        <Big label="נבחרת" value={sum.caps} />
      </div>

      <div className="px-4 py-3">
        <div className="text-2xs text-fg-muted mb-2">
          רווחי קריירה · {formatMoney(sum.earnings)}
        </div>

        {Object.keys(byName).length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byName).map(([name, n]) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-chip bg-gold/15 text-2xs text-gold"
              >
                <Trophy className="size-3" aria-hidden="true" />
                {name}
                {n > 1 && <span className="font-bold">×{n}</span>}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-2xs text-fg-subtle">ארון התארים נשאר ריק.</div>
        )}

        <div className="mt-3 text-2xs text-fg-muted">
          {COUNTRY_FLAG.IL} מסלול: {sum.clubs.join(' ← ')}
        </div>
      </div>

      <div className="flex gap-2 p-4 border-t border-line-subtle">
        <button
          onClick={share}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand text-brand-fg font-semibold text-sm"
        >
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
          {copied ? 'הקישור הועתק' : 'שתף את הקריירה'}
        </button>
        <button
          onClick={onRestart}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-line text-fg text-sm"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          קריירה חדשה
        </button>
      </div>
    </div>
  )
}
