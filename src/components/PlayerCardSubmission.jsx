import { useState, useEffect } from "react"
import { X, Loader2 } from "lucide-react"
import { ApprovedStatus as CheckCircle2, PersonAdd } from "@/components/icons/BrandIcons"
import { getTeams } from "@/lib/api"
import { createPlayerSubmission } from "@/lib/playerSubmissions"
import { linkRequestErrorMessage } from "@/lib/linkRequests"

const inputCls = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

/**
 * Modal: a logged-in user proposes their own player card for a team. On submit it
 * files a PENDING player_submission; the team's coach (or an admin) approves it in
 * the admin "בקשות" tab, which creates the real players row and links this account.
 * Calls onSubmitted() so the caller can refresh its pending-submission state.
 * `initialName` ({ firstName, lastName }) prefills the form — onboarding passes what
 * the user just searched for and didn't find.
 */
export default function PlayerCardSubmission({ onClose, onSubmitted, initialName }) {
  const [teams, setTeams] = useState([])
  const [form, setForm] = useState({
    teamId: "", firstName: initialName?.firstName || "", lastName: initialName?.lastName || "",
    jerseyNumber: "", position: "Field Player", birthDate: "", note: "",
  })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { getTeams("name", true).then(setTeams).catch(() => setTeams([])) }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const canSubmit = form.teamId && form.firstName.trim() && form.lastName.trim() && form.birthDate && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      await createPlayerSubmission({
        teamId: form.teamId === "__free__" ? null : form.teamId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        jerseyNumber: form.jerseyNumber ? parseInt(form.jerseyNumber, 10) : null,
        position: form.position.trim() || null,
        birthDate: form.birthDate,
        note: form.note.trim() || null,
      })
      setDone(true)
      onSubmitted?.()
    } catch (e) {
      setError(linkRequestErrorMessage(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="סגור" className="absolute top-4 left-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
          <X className="w-5 h-5" />
        </button>

        {done ? (
          <div className="text-center px-6 py-8">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">הבקשה נשלחה 🛼</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              כרטיס השחקן שלך נשלח לאישור. תופיע/י בליגה מרגע שהבקשה תאושר.
            </p>
            <button onClick={onClose} className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors">
              סגירה
            </button>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <PersonAdd className="w-5 h-5 text-brand" />
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">צור כרטיס שחקן</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              מלא/י את הפרטים. בחירת קבוצה תישלח לאישור המאמן שלה; ללא קבוצה — לאישור מנהל הליגה.
            </p>

            <div className="space-y-3.5">
              <Field label="קבוצה">
                <select value={form.teamId} onChange={e => set("teamId", e.target.value)} className={inputCls}>
                  <option value="">בחר/י קבוצה…</option>
                  <option value="__free__">שחקן/ית חופשי/ה — ללא קבוצה</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="שם פרטי">
                  <input value={form.firstName} onChange={e => set("firstName", e.target.value.slice(0, 40))} className={inputCls} />
                </Field>
                <Field label="שם משפחה">
                  <input value={form.lastName} onChange={e => set("lastName", e.target.value.slice(0, 40))} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="מספר">
                  <input value={form.jerseyNumber} onChange={e => set("jerseyNumber", e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className={inputCls} />
                </Field>
                <Field label="עמדה">
                  <select value={form.position} onChange={e => set("position", e.target.value)} className={inputCls}>
                    <option value="Field Player">שחקן שדה</option>
                    <option value="Goalkeeper">שוער</option>
                  </select>
                </Field>
              </div>
              <Field label="תאריך לידה">
                <input type="date" dir="ltr" value={form.birthDate} max={new Date().toLocaleDateString("en-CA")} min="1930-01-02"
                  onChange={e => set("birthDate", e.target.value)} className={`${inputCls} tabular-nums`} />
                <p className="text-[11px] text-slate-400 mt-1">משמש לכללי ההשאלה (עד גיל 18, או שוער/ת). לא מוצג בפומבי.</p>
              </Field>
              <Field label="הערה למאמן (לא חובה)">
                <textarea value={form.note} onChange={e => set("note", e.target.value.slice(0, 200))} rows={2} className={inputCls} />
              </Field>
            </div>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button onClick={submit} disabled={!canSubmit}
              className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PersonAdd className="w-4 h-4" />}
              שליחה לאישור
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
