import { useState, useEffect } from "react"
import { getTeams } from "@/lib/api"
import { createPlayerSubmission } from "@/lib/playerSubmissions"
import { linkRequestErrorMessage } from "@/lib/linkRequests"
import { BrandIcon } from "@/components/icons/BrandIcons"
import { Sheet, CTA, Field, Spinner, Notice, inputCls } from "@/components/fl/account/AccountKit"

export const emptyCard = (initialName) => ({
  teamId: "", firstName: initialName?.firstName || "", lastName: initialName?.lastName || "",
  jerseyNumber: "", position: "Field Player", birthDate: "", note: "",
})

export const cardComplete = (f) => !!(f.teamId && f.firstName.trim() && f.lastName.trim() && f.birthDate)

/** Exactly what the server has always received for a new card. */
export function submitCard(form) {
  return createPlayerSubmission({
    teamId: form.teamId === "__free__" ? null : form.teamId,
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    jerseyNumber: form.jerseyNumber ? parseInt(form.jerseyNumber, 10) : null,
    position: form.position.trim() || null,
    birthDate: form.birthDate,
    note: form.note.trim() || null,
  })
}

/**
 * The new-card fields (board OnbNewCard): team or free agent, first/last name, number,
 * position (two big choices), birth date (required, not public), a note to the coach.
 * Controlled: `form` + `onChange(next)`. Shared by the /me sheet and onboarding.
 */
export function NewCardFields({ form, onChange, idPrefix = "nc" }) {
  const [teams, setTeams] = useState([])
  useEffect(() => { getTeams("name", true).then(setTeams).catch(() => setTeams([])) }, [])
  const set = (k, v) => onChange({ ...form, [k]: v })
  const id = (k) => `${idPrefix}-${k}`
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="שם פרטי" htmlFor={id("first")}>
          <input id={id("first")} value={form.firstName} onChange={e => set("firstName", e.target.value.slice(0, 40))} autoComplete="given-name" className={inputCls} />
        </Field>
        <Field label="שם משפחה" htmlFor={id("last")}>
          <input id={id("last")} value={form.lastName} onChange={e => set("lastName", e.target.value.slice(0, 40))} autoComplete="family-name" className={inputCls} />
        </Field>
      </div>
      <Field label="קבוצה" htmlFor={id("team")} hint="בחירת קבוצה נשלחת לאישור המאמן שלה; בלי קבוצה, לאישור מנהל הליגה.">
        <select id={id("team")} value={form.teamId} onChange={e => set("teamId", e.target.value)} className={`${inputCls} appearance-none`}>
          <option value="">בחירת קבוצה…</option>
          <option value="__free__">שחקן/ית חופשי/ה, בלי קבוצה</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-[96px_1fr] gap-3">
        <Field label="מספר" htmlFor={id("num")}>
          <input id={id("num")} value={form.jerseyNumber} onChange={e => set("jerseyNumber", e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric" dir="ltr" className={`${inputCls} fl-num text-center text-[18px]`} />
        </Field>
        <fieldset className="flex flex-col gap-1.5 min-w-0">
          <legend className="text-[13px] font-bold text-fg-strong mb-1.5">עמדה</legend>
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {[["Field Player", "שחקן שדה", "squad"], ["Goalkeeper", "שוער", "goalkeeper"]].map(([v, l, ic]) => {
              const on = form.position === v
              return (
                <button key={v} type="button" role="radio" aria-checked={on} onClick={() => set("position", v)}
                  className={`h-12 rounded-[14px] inline-flex items-center justify-center gap-1.5 text-[14px] font-bold border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${
                    on ? "border-fg-strong bg-surface text-fg-strong" : "border-transparent bg-surface text-fg-muted hover:text-fg-strong"}`}>
                  <BrandIcon name={ic} className="w-5 h-5" /> {l}
                </button>
              )
            })}
          </div>
        </fieldset>
      </div>
      <Field label="תאריך לידה" htmlFor={id("dob")} hint="משמש לכללי ההשאלה (עד גיל 18, או שוער/ת). לא מוצג בפומבי.">
        <input id={id("dob")} type="date" dir="ltr" value={form.birthDate} max={new Date().toLocaleDateString("en-CA")} min="1930-01-02"
          onChange={e => set("birthDate", e.target.value)} className={`${inputCls} tabular-nums text-start`} />
      </Field>
      <Field label="הערה למאמן (לא חובה)" htmlFor={id("note")}>
        <textarea id={id("note")} value={form.note} onChange={e => set("note", e.target.value.slice(0, 200))} rows={2}
          className={`${inputCls} h-auto py-2.5 resize-none`} placeholder="למשל: שיחקתי בעונה שעברה בקבוצה אחרת" />
      </Field>
    </div>
  )
}

/**
 * Sheet (phones) / dialog (desktop): a logged-in user proposes their own player card for
 * a team. On submit it files a PENDING player_submission; the team's coach (or an admin)
 * approves it in the admin "בקשות" tab, which creates the real players row and links this
 * account. Calls onSubmitted() so the caller can refresh its pending-submission state.
 * `initialName` ({ firstName, lastName }) prefills the form.
 */
export default function PlayerCardSubmission({ onClose, onSubmitted, initialName }) {
  const [form, setForm] = useState(() => emptyCard(initialName))
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const canSubmit = cardComplete(form) && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      await submitCard(form)
      setDone(true)
      onSubmitted?.()
    } catch (e) {
      setError(linkRequestErrorMessage(e))
    } finally { setSaving(false) }
  }

  if (done) {
    return (
      <Sheet onClose={onClose} title="הבקשה נשלחה" hideTitle footer={<CTA onClick={onClose} data-autofocus>סגירה</CTA>}>
        <div className="text-center py-6">
          <span className="mx-auto mb-4 w-[72px] h-[72px] rounded-[22px] bg-surface flex items-center justify-center"><BrandIcon name="verified" variant="large" className="w-11 h-11" /></span>
          <h3 className="text-[24px] font-black text-fg-strong">הבקשה נשלחה</h3>
          <p className="mt-2 text-[15px] text-fg-muted">כרטיס השחקן שלך נשלח לאישור. תופיע/י בליגה מרגע שהבקשה תאושר.</p>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose} title="כרטיס שחקן חדש" wide
      footer={<>
        {error && <Notice tone="err" className="mb-2">{error}</Notice>}
        <CTA onClick={submit} disabled={!canSubmit}>{saving && <Spinner />} שליחה לאישור</CTA>
      </>}>
      <p className="text-[14px] text-fg-muted mb-4">ממלאים פעם אחת. המאמן מאשר, ואז הכרטיס מופיע בליגה ומשויך לחשבון שלך.</p>
      <NewCardFields form={form} onChange={setForm} idPrefix="pcs" />
    </Sheet>
  )
}
