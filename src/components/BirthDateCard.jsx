import { useState, useEffect } from "react"
import { Check, Loader2 } from "lucide-react"
import { Birthday as Cake, EditIcon as Pencil } from "@/components/icons/BrandIcons"
import { getMyBirthDate, setPlayerBirthDate, ageFromBirthDate, getMyBirthdayCelebration, setMyBirthdayCelebration } from "@/lib/birthDate"

/**
 * Date of birth on /me — and the prompt that gets it filled in.
 *
 * Existing players were never asked for one, so when it's missing this renders as a
 * highlighted request rather than a quiet, ignorable field: the league needs it to decide
 * whether a player may be borrowed by another team, and a rule nobody can evaluate is
 * worse than no rule.
 *
 * Once set it collapses to a single line with an edit pencil.
 */
export default function BirthDateCard({ playerId }) {
  const [birthDate, setBirthDate] = useState(null)
  const [value, setValue] = useState("")
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [ready, setReady] = useState(false)
  // null = unknown / not linked → the switch isn't shown.
  const [celebrate, setCelebrate] = useState(null)
  const [savingCelebrate, setSavingCelebrate] = useState(false)

  useEffect(() => {
    if (!playerId) { setReady(true); return }
    let alive = true
    getMyBirthDate(playerId).then(d => {
      if (!alive) return
      setBirthDate(d); setValue(d || ""); setReady(true)
    }).catch(() => setReady(true))
    getMyBirthdayCelebration().then(v => { if (alive) setCelebrate(v) })
    return () => { alive = false }
  }, [playerId])

  if (!playerId || !ready) return null

  const save = async (e) => {
    e.preventDefault()
    setSaving(true); setErr(null)
    try {
      await setPlayerBirthDate(playerId, value)
      setBirthDate(value); setEditing(false)
    } catch (e2) { setErr(e2.message) } finally { setSaving(false) }
  }

  const toggleCelebrate = async () => {
    if (savingCelebrate || celebrate == null) return
    const next = !celebrate
    setCelebrate(next); setSavingCelebrate(true); setErr(null)
    try { await setMyBirthdayCelebration(next) }
    catch (e2) { setCelebrate(!next); setErr(e2.message) }
    finally { setSavingCelebrate(false) }
  }

  const age = ageFromBirthDate(birthDate)
  const missing = !birthDate

  if (!missing && !editing) {
    return (
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Cake className="w-4 h-4 text-brand shrink-0" />
          <span className="text-sm text-slate-700 dark:text-slate-200">
            תאריך לידה: <span dir="ltr" className="tabular-nums">{new Date(birthDate).toLocaleDateString("he-IL")}</span>
            {age != null && <span className="text-slate-400 text-xs"> · גיל {age}</span>}
          </span>
          <button onClick={() => setEditing(true)} aria-label="עריכת תאריך לידה"
            className="ms-auto text-slate-400 hover:text-brand transition-colors"><Pencil className="w-4 h-4" /></button>
        </div>
        {celebrate != null && (
          <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">לחגוג את יום ההולדת שלי</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                פוסט ברכה בפיד ביום ההולדת. בלי תאריך ובלי גיל — רק "היום".
              </p>
            </div>
            <button type="button" role="switch" aria-checked={celebrate} aria-label="לחגוג את יום ההולדת שלי"
              onClick={toggleCelebrate} disabled={savingCelebrate}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-60 ${celebrate ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${celebrate ? "right-0.5" : "right-[1.375rem]"}`} />
            </button>
          </div>
        )}
        {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
      </div>
    )
  }

  return (
    <form onSubmit={save}
      className={`card p-4 space-y-2.5 ${missing ? "border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <Cake className="w-4 h-4 text-brand" /> תאריך לידה
      </p>
      {missing && (
        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
          חסר תאריך לידה בכרטיס השחקן שלך. הליגה משתמשת בו כדי לקבוע אם אפשר להשאיל
          שחקן/ית לקבוצה אחרת (עד גיל 18, או שוער/ת בכל גיל) — וגם כדי לאחל לך מזל טוב ביום ההולדת.
        </p>
      )}
      <input type="date" value={value} onChange={e => setValue(e.target.value)}
        max={new Date().toLocaleDateString("en-CA")} aria-label="תאריך לידה"
        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || !value}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שמירה
        </button>
        {!missing && (
          <button type="button" onClick={() => { setEditing(false); setValue(birthDate || ""); setErr(null) }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            ביטול
          </button>
        )}
      </div>
    </form>
  )
}
