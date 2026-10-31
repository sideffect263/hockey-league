import { useState, useRef } from "react"
import { X, Loader2, Image as ImageIcon } from "lucide-react"
import { EditIcon as Pencil } from "@/components/icons/BrandIcons"
import { updateTeamDetails, uploadTeamLogo } from "@/lib/api"
import { isSafeImage, IMAGE_TYPE_MESSAGE, IMAGE_TYPE_ERROR } from "@/lib/imageType"
import { heroPalette, heroGradient } from "@/components/fl/teams/FLTeamsKit"
import TeamLogo from "@/components/TeamLogo"
import { REGISTER_LEAD_OPTIONS, setTeamRegisterLeadDays } from "@/lib/availability"

const inputCls = "w-full min-h-[44px] bg-surface-page border border-line rounded-control px-3.5 text-[15px] text-fg-strong placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-fg-strong/20 focus:border-fg-muted"
const labelCls = "block text-[12px] font-bold text-fg-muted mb-1.5"

/**
 * Coach/admin edits their team's descriptive fields + crest. Writes go through
 * update_team_details() and (for the crest) uploadTeamLogo() → set_team_logo().
 * Competitive stats (wins/points/goals) are NOT editable here — they stay
 * admin-only. onSaved() lets the caller refresh.
 */
export default function TeamEditModal({ team, onClose, onSaved }) {
  const [name, setName] = useState(team.name || "")
  const [city, setCity] = useState(team.city || "")
  const [venue, setVenue] = useState(team.home_venue || "")
  const [founded, setFounded] = useState(team.founded_year ? String(team.founded_year) : "")
  const [primary, setPrimary] = useState(team.primary_color || "#3B4FC4")
  const [secondary, setSecondary] = useState(team.secondary_color || "#1e2a78")
  const [leadDays, setLeadDays] = useState(team.register_lead_days ?? null)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
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

  const save = async () => {
    if (!name.trim()) { setError("שם קבוצה חובה"); return }
    setSaving(true); setError(null)
    try {
      if (logoFile) await uploadTeamLogo(team.id, logoFile)
      await updateTeamDetails(team.id, {
        name: name.trim(),
        city: city.trim() || null,
        home_venue: venue.trim() || null,
        primary_color: primary,
        secondary_color: secondary,
        founded_year: founded ? parseInt(founded, 10) : null,
      })
      if (leadDays !== (team.register_lead_days ?? null)) await setTeamRegisterLeadDays(team.id, leadDays)
      onSaved?.()
      onClose?.()
    } catch (e) {
      setError(
        e?.message === "not-authorized" ? "אין לך הרשאה לערוך קבוצה זו"
        : e?.message === "invalid founded year" ? "שנת ייסוד לא תקינה"
        // Unreachable via the picker, which blocks the file on selection —
        // mapped anyway so the guard in uploadTeamLogo can never surface as
        // the generic "something went wrong".
        : e?.message === IMAGE_TYPE_ERROR ? IMAGE_TYPE_MESSAGE
        : "שגיאה בשמירה, נסו שוב"
      )
    } finally { setSaving(false) }
  }

  // Live preview of the crest with the chosen file + color.
  const previewTeam = { ...team, name, primary_color: primary, secondary_color: secondary, logo_url: logoPreview || team.logo_url }
  // Live hero preview in the chosen colours (board CoachTools): a light pick (white /
  // grey) keeps its white → grey and flips the text to ink, exactly like the team page.
  const previewPal = heroPalette(previewTeam)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="עריכת קבוצה"
        className="w-full sm:max-w-md bg-surface rounded-t-[28px] sm:rounded-[24px] shadow-xl relative max-h-[92vh] overflow-y-auto fl-sheet-in pb-[env(safe-area-inset-bottom)]" onClick={e => e.stopPropagation()}>
        <span aria-hidden="true" className="sm:hidden block mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line" />
        <button onClick={onClose} aria-label="סגור" className="absolute top-3 left-3 size-11 inline-flex items-center justify-center rounded-full text-fg-muted hover:bg-surface-sunken transition-colors">
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Pencil className="w-6 h-6" />
            <h3 className="text-[22px] font-extrabold text-fg-strong">עריכת קבוצה</h3>
          </div>

          <div className="relative overflow-hidden rounded-[20px] mb-4 px-4 py-4 flex items-center gap-3" style={{ backgroundImage: heroGradient(previewPal), color: previewPal.ink }}>
            <TeamLogo team={previewTeam} px={56} disc={false} shadow />
            <div className="min-w-0">
              <p className="text-[20px] font-extrabold leading-tight truncate">{name || team.name}</p>
              <p className="text-[12px] opacity-80">{[city, founded ? `נוסדה ${founded}` : null].filter(Boolean).join(' · ') || 'תצוגה מקדימה'}</p>
            </div>
          </div>
          {previewPal.light && (
            <p className="-mt-2 mb-4 text-[12px] text-fg-muted">צבע בהיר: הטקסט על הקבוצה יופיע בכהה כדי שייקרא.</p>
          )}

          {/* Crest */}
          <div className="flex items-center gap-4 mb-4">
            <TeamLogo team={previewTeam} px={56} />
            <div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={pickLogo} className="hidden" />
              <button type="button" onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-control bg-surface-sunken text-fg-strong text-[13px] font-bold hover:brightness-95 transition">
                <ImageIcon className="w-3.5 h-3.5" /> {team.logo_url || logoFile ? "החלפת סמל" : "העלאת סמל"}
              </button>
              <p className="text-[12px] text-fg-muted mt-1.5">PNG/JPG · עד 3MB</p>
            </div>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className={labelCls}>שם הקבוצה</label>
              <input value={name} onChange={e => setName(e.target.value.slice(0, 50))} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>עיר</label>
                <input value={city} onChange={e => setCity(e.target.value.slice(0, 40))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>שנת ייסוד</label>
                <input value={founded} onChange={e => setFounded(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric" placeholder="—" className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>אולם ביתי</label>
              <input value={venue} onChange={e => setVenue(e.target.value.slice(0, 60))} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>צבע ראשי</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={primary} onChange={e => setPrimary(e.target.value)}
                    aria-label="צבע ראשי" className="size-11 rounded-control border border-line bg-transparent cursor-pointer" />
                  <span dir="ltr" className="text-[12px] font-mono text-fg-muted">{primary}</span>
                </div>
              </div>
              <div>
                <label className={labelCls}>צבע משני</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={secondary} onChange={e => setSecondary(e.target.value)}
                    aria-label="צבע משני" className="size-11 rounded-control border border-line bg-transparent cursor-pointer" />
                  <span dir="ltr" className="text-[12px] font-mono text-fg-muted">{secondary}</span>
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>תזכורת ראשונה להרשמה למשחק</label>
              <div className="grid grid-cols-2 gap-2">
                {REGISTER_LEAD_OPTIONS.map(o => (
                  <button key={o.days ?? 'default'} type="button" onClick={() => setLeadDays(o.days)}
                    aria-pressed={leadDays === o.days}
                    className={`min-h-[44px] px-2 rounded-control text-[13px] font-bold border transition-colors ${leadDays === o.days
                      ? 'bg-fg-strong text-surface border-fg-strong'
                      : 'bg-surface-page text-fg-strong border-line hover:border-fg-muted'}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-fg-muted mt-1.5">
                {leadDays ? 'מי שלא ענה יקבל תזכורת נוספת ביום ראשון של שבוע המשחק.' : 'השחקנים מקבלים את ההתראה ביום ראשון של שבוע המשחק.'}
              </p>
            </div>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-fl-red">{error}</p>}

          <div className="mt-5 flex gap-2">
            <button onClick={onClose} className="flex-1 min-h-[48px] rounded-control bg-surface-sunken text-fg-strong font-bold hover:brightness-95 transition">ביטול</button>
            <button onClick={save} disabled={saving}
              className="btn-primary flex-1 min-h-[48px] disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              שמירה
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
