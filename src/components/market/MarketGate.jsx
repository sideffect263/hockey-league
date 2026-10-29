import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Loader2, ArrowLeft } from "lucide-react"
import { Birthday as Cake, Coin as Coins } from "@/components/icons/BrandIcons"
import { useAuth } from '@/lib/AuthContext'
import { setPlayerBirthDate, ageFromBirthDate } from '@/lib/birthDate'
import { BLOCK_COPY, START_BALANCE } from '@/lib/market'

/**
 * How to join in. The board itself is public; this says what it takes to predict.
 * `compact` renders it as a panel above the board (the market page); without it,
 * as a page of its own.
 *
 * Only 12 of the league's 96 player cards carry a birth date — nobody was ever
 * asked for one — so gating on age and then sending people off to find /me would
 * have shut the market for almost everyone on day one. The 'no-dob' case is
 * therefore not a dead end but the sign-up step: the date is collected here, and
 * the market opens on submit.
 */
export default function MarketGate({ reason, onUnlocked, compact = false }) {
  const { user, profile, openAuth } = useAuth()
  const copy = BLOCK_COPY[reason] || BLOCK_COPY['signed-out']

  if (reason === 'no-dob' && profile?.player_id) {
    return <BirthDateUnlock playerId={profile.player_id} onUnlocked={onUnlocked} compact={compact} />
  }

  if (compact) {
    return (
      <div className="mkt-card p-4 mb-5 flex items-start gap-3 flex-wrap sm:flex-nowrap border-brand/30 bg-brand/[0.04]">
        <span className="w-10 h-10 rounded-xl bg-surface flex items-center justify-center shrink-0">
          <Coins className="w-7 h-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-fg-strong">{copy.title}</p>
          <p className="text-xs text-fg-muted leading-relaxed mt-0.5">{copy.body}</p>
        </div>
        {!user && (
          <button onClick={openAuth} className="btn-primary shrink-0 self-center">התחברות</button>
        )}
        {reason === 'no-player' && (
          <Link to="/me" className="btn-secondary shrink-0 self-center inline-flex">
            לדף שלי <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-surface-sunken flex items-center justify-center mx-auto mb-5">
        <Lock className="w-6 h-6 text-fg-subtle" />
      </div>
      <h1 className="text-2xl font-black text-fg-strong mb-2">{copy.title}</h1>
      <p className="text-sm text-fg-muted leading-relaxed mb-6">{copy.body}</p>

      {!user && (
        <button onClick={openAuth} className="btn-primary">התחברות</button>
      )}
      {reason === 'no-player' && (
        <Link to="/me" className="btn-primary inline-flex">
          לדף שלי <ArrowLeft className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}

function BirthDateUnlock({ playerId, onUnlocked, compact = false }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const age = ageFromBirthDate(value)
  const tooYoung = value && age != null && age < 18

  const save = async (e) => {
    e.preventDefault()
    if (tooYoung) return
    setSaving(true); setErr(null)
    try {
      await setPlayerBirthDate(playerId, value)
      onUnlocked?.()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={compact ? 'max-w-md mx-auto mb-8' : 'max-w-md mx-auto px-4 py-14'}>
      <div className="text-center mb-7">
        <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center mx-auto mb-5">
          <Coins className="w-7 h-7 text-brand" />
        </div>
        <h2 className="text-2xl font-black text-fg-strong mb-2">מצטרפים לסטופר מרקט</h2>
        <p className="text-sm text-fg-muted leading-relaxed">
          התחזיות פתוחות לשחקני הליגה מגיל 18. נשאר רק להוסיף תאריך לידה לכרטיס
          השחקן שלך, ומחכים לך <span className="mkt-coin">{START_BALANCE.toLocaleString('he-IL')}</span> סטופרים,
          ועוד <span className="mkt-coin">10</span> בכל שבוע.
        </p>
      </div>

      <form onSubmit={save} className="mkt-card p-5 space-y-4">
        <label className="block">
          <span className="flex items-center gap-2 text-sm font-bold text-fg-strong mb-2">
            <Cake className="w-4 h-4 text-brand" /> תאריך לידה
          </span>
          <input
            type="date" value={value} onChange={e => setValue(e.target.value)}
            max={new Date().toLocaleDateString('en-CA')} required dir="ltr"
            className="w-full bg-surface-inset border border-line rounded-lg px-3 py-2.5 text-sm text-fg-soft focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>

        <p className="text-[11px] text-fg-subtle leading-relaxed">
          התאריך נשמר בכרטיס השחקן שלך ומשמש גם את חוקת ההשאלות של הליגה. אפשר לערוך
          אותו בכל רגע מהדף שלי.
        </p>

        {tooYoung && (
          <p className="text-xs text-neg font-semibold">
            לפי התאריך הזה עדיין לא מלאו לך 18. אפשר להמשיך לצפות, והאפשרות לחזות תיפתח מעצמה ביום ההולדת.
          </p>
        )}
        {err && <p className="text-xs text-neg">{err}</p>}

        <button type="submit" disabled={saving || !value || tooYoung}
          className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          פתיחת החשבון
        </button>
      </form>

      <p className="text-center text-[11px] text-fg-subtle mt-5 leading-relaxed">
        הסטופרים וירטואליים לחלוטין, אין להם שווי כספי
        <br />ואי אפשר לקנות או להמיר אותם. זה משחק תחזיות.
      </p>
    </div>
  )
}
