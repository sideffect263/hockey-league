import { useState, useRef } from "react"
import { X, Loader2, Image as ImageIcon } from "lucide-react"
import { Squad as Users, ApprovedStatus as CheckCircle2, TeamIcon } from "@/components/icons/BrandIcons"
import { AGE_GROUPS } from "@/lib/ageGroups"
import { requestTeam, uploadTeamLogo } from "@/lib/api"
import { isSafeImage, IMAGE_TYPE_MESSAGE } from "@/lib/imageType"
import TeamLogo from "@/components/TeamLogo"

const inputCls = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"

/**
 * Modal: a linked player proposes a new team. Files a PENDING team via the
 * request_team RPC; a league-manager/admin approves it in Admin → קבוצות, which
 * activates it and makes the creator its coach. Calls onCreated() so the caller
 * can refresh its "my pending teams" state.
 */
export default function CreateTeamModal({ onClose, onCreated }) {
  const [name, setName] = useState("")
  const [city, setCity] = useState("")
  const [groups, setGroups] = useState(["senior"])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const fileRef = useRef(null)

  // Checked against the file's BYTES, not its extension or the browser's
  // file.type — both of which happily called an AVIF a PNG and left four teams
  // with crests that WhatsApp could not render. See lib/imageType.js.
  const pickLogo = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 3 * 1024 * 1024) { setError("תמונה עד 3MB"); return }
    if (!(await isSafeImage(f))) { setError(IMAGE_TYPE_MESSAGE); return }
    setError(null); setLogoFile(f); setLogoPreview(URL.createObjectURL(f))
  }

  const toggle = (g) => setGroups(cur => cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g])
  const canSubmit = name.trim() && groups.length > 0 && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true); setError(null)
    try {
      const newId = await requestTeam(name.trim(), groups, city.trim() || null)
      if (logoFile && newId) {
        // crest is optional — a failed upload must not undo the already-created team request
        try { await uploadTeamLogo(newId, logoFile) } catch { /* ignore */ }
      }
      setDone(true)
      onCreated?.()
    } catch (e) {
      setError(e?.message === "not-linked-player"
        ? "רק שחקן/ית משויכ/ת יכול/ה לפתוח קבוצה"
        : "שגיאה בשליחת הבקשה, נסו שוב")
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
              הקבוצה שלך ממתינה לאישור מנהל הליגה. ברגע שתאושר תופיע בעמוד הקבוצות ותהיו המאמן/ת שלה.
            </p>
            <button onClick={onClose} className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors">סגירה</button>
          </div>
        ) : (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-1">
              <TeamIcon className="w-5 h-5 text-brand" />
              <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">פתיחת קבוצה חדשה</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">הקבוצה תישלח לאישור מנהל הליגה. לאחר אישור תהיו המאמן/ת שלה.</p>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">שם הקבוצה</label>
                <input value={name} onChange={e => setName(e.target.value.slice(0, 50))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">עיר (לא חובה)</label>
                <input value={city} onChange={e => setCity(e.target.value.slice(0, 40))} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">קטגוריות גיל</label>
                <div className="flex flex-wrap gap-2">
                  {AGE_GROUPS.map(a => {
                    const on = groups.includes(a.value)
                    return (
                      <button key={a.value} type="button" onClick={() => toggle(a.value)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${on ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">סמל הקבוצה (לא חובה)</label>
                <div className="flex items-center gap-3">
                  <TeamLogo team={{ name, primary_color: "#3B4FC4", logo_url: logoPreview }} size={12} />
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={pickLogo} className="hidden" />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                    <ImageIcon className="w-3.5 h-3.5" /> {logoFile ? "החלפת סמל" : "העלאת סמל"}
                  </button>
                </div>
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button onClick={submit} disabled={!canSubmit}
              className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              שליחה לאישור
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
