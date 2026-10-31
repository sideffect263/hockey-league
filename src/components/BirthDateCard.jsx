import { useState, useEffect } from "react"
import { getMyBirthDate, setPlayerBirthDate, ageFromBirthDate, getMyBirthdayCelebration, setMyBirthdayCelebration } from "@/lib/birthDate"
import { AccRow, AccButton, AccSwitch, Spinner, inputCls, errText } from "@/components/fl/account/AccountKit"

/**
 * Date of birth on /me — rows of the "בריאות וזמינות" group (board MyPage), and the
 * request that gets it filled in.
 *
 * Existing players were never asked for one, so when it's missing this renders as a
 * highlighted request rather than a quiet, ignorable field: the league needs it to decide
 * whether a player may be borrowed by another team, and a rule nobody can evaluate is
 * worse than no rule. Once set it is one row with "עריכה", plus the birthday-post switch.
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
  const open = missing || editing

  return (
    <>
      <AccRow brand="birthday" label="תאריך לידה"
        className={missing ? "bg-[#F6EBD3]/70 dark:bg-amber-900/20" : ""}
        sub={missing
          ? "חסר בכרטיס השחקן שלך. הליגה משתמשת בו לכללי ההשאלה (עד גיל 18, או שוער/ת בכל גיל), וכדי לאחל לך מזל טוב. לא מוצג בפומבי."
          : <><span dir="ltr" className="tabular-nums">{new Date(birthDate).toLocaleDateString("he-IL")}</span>{age != null && ` · גיל ${age}`}</>}
        trailing={!open && <AccButton tone="quiet" onClick={() => setEditing(true)} aria-label="עריכת תאריך לידה">עריכה</AccButton>}>
        {open && (
          <form onSubmit={save} className={`px-3.5 pb-3 -mt-1 flex flex-col gap-2 ${missing ? "bg-[#F6EBD3]/70 dark:bg-amber-900/20" : ""}`}>
            <input type="date" dir="ltr" value={value} onChange={e => setValue(e.target.value)}
              max={new Date().toLocaleDateString("en-CA")} aria-label="תאריך לידה" className={`${inputCls} tabular-nums text-start`} />
            <div className="flex items-center gap-2">
              <AccButton type="submit" tone="ink" disabled={saving || !value}>{saving && <Spinner />} שמירה</AccButton>
              {!missing && (
                <AccButton tone="ghost" onClick={() => { setEditing(false); setValue(birthDate || ""); setErr(null) }}>ביטול</AccButton>
              )}
            </div>
            {err && <p role="alert" className={`text-[12.5px] font-semibold ${errText}`}>{err}</p>}
          </form>
        )}
      </AccRow>
      {celebrate != null && !missing && (
        <AccRow brand="celebrate" label="לחגוג את יום ההולדת שלי" sub='פוסט ברכה בפיד ביום ההולדת. בלי תאריך ובלי גיל, רק "היום".'
          trailing={<AccSwitch on={celebrate} onChange={toggleCelebrate} disabled={savingCelebrate} label="לחגוג את יום ההולדת שלי" />}>
          {err && !open && <p role="alert" className={`px-3.5 pb-3 text-[12.5px] font-semibold ${errText}`}>{err}</p>}
        </AccRow>
      )}
    </>
  )
}
