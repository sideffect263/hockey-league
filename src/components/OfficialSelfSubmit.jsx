import { useState, useEffect } from "react"
import { Loader2, Check } from "lucide-react"
import { Medical as HeartPulse, EditIcon as Pencil, Gavel } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { applyAsOfficial, getMyOfficialRoles, OFFICIAL_ROLE_LABEL } from "@/lib/officials"
import { getMyContact, saveMyContact, officialApplyError } from "@/lib/contact"

const roleIcon = { judge: Gavel, medic: HeartPulse }

/**
 * D4 — a judge/medic self-submits to work an upcoming game; the league manager approves
 * it (in the Officials admin tab). Renders only for a scheduled game to a judge/medic.
 *
 * Sheet rows 16, 17: the name on the game sheet comes from the account, so nothing is
 * demanded of a judge. A MEDIC must have a phone on file — that is the number you call
 * when someone is hurt — and it is collected right here, at the moment it matters,
 * rather than by sending him off to /me.
 *
 * The server also refuses an application when the game involves the applicant's own team,
 * or when he already holds the other role in that game.
 */
export default function OfficialSelfSubmit({ game }) {
  const { isJudgeRole, isMedic } = useAuth()
  const roles = [...(isJudgeRole ? ["judge"] : []), ...(isMedic ? ["medic"] : [])]
  const [mine, setMine] = useState([])
  const [busy, setBusy] = useState(null)
  const [contact, setContact] = useState(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [savingContact, setSavingContact] = useState(false)
  const [err, setErr] = useState(null)

  const active = roles.length > 0 && game.status === "scheduled"

  useEffect(() => {
    if (!active) return
    let alive = true
    Promise.all([getMyOfficialRoles(game.id), getMyContact()]).then(([r, c]) => {
      if (!alive) return
      setMine(r)
      setContact(c)
      setName(c?.full_name || "")
      setPhone(c?.phone || "")
    }).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, roles.length, game.status])

  if (!active) return null

  // A full name is no longer demanded — the account's own name is the name that goes on
  // the sheet. Only the medic's PHONE is required, because that is the number you call
  // when someone is hurt.
  const needsPhone = isMedic && !contact?.phone?.trim()
  const showForm = editing || needsPhone

  const saveContact = async (e) => {
    e.preventDefault()
    setSavingContact(true); setErr(null)
    try {
      await saveMyContact(name, phone)
      setContact({ full_name: name.trim(), phone: phone.trim() })
      setEditing(false)
    } catch (e2) { setErr(e2.message) } finally { setSavingContact(false) }
  }

  const apply = async (role) => {
    setBusy(role); setErr(null)
    try {
      await applyAsOfficial(game.id, role)
      setMine(await getMyOfficialRoles(game.id))
    } catch (e2) {
      // Previously swallowed. The refusal is now usually something the user can fix in
      // the form right above, so saying nothing would be the worst possible response.
      setErr(officialApplyError(e2))
      setEditing(true)
    } finally { setBusy(null) }
  }

  // 'assigned' is a manager's direct assignment — as confirmed as 'approved', and it must
  // NOT fall through to the waiting branch. It used to: a judge the manager had put on
  // the game read "ממתין לאישור מנהל הליגה" indefinitely, with no way to make it change.
  // Nothing writes 'assigned' any more, but old rows still carry it.
  const statusOf = (s) => s === "approved" || s === "assigned"
    ? { t: "שובצת", c: "text-[#1B5E2A] dark:text-emerald-300" }
    : s === "rejected" ? { t: "המועמדות נדחתה", c: "text-[#B4231A] dark:text-[#FF8A7A]" }
    : { t: "ממתין לאישור מנהל הליגה", c: "text-[#7A5200] dark:text-amber-200" }

  return (
    <div className="bg-surface rounded-card p-4 space-y-3">
      <p className="text-[16px] font-extrabold text-fg-strong flex items-center gap-2">
        <Gavel className="w-5 h-5" /> הגשת מועמדות לשיבוץ
      </p>

      {showForm ? (
        <form onSubmit={saveContact} className="space-y-2.5 p-3 rounded-[16px] bg-surface-page">
          <p className="text-[12.5px] text-fg">
            {needsPhone
              ? "חובש חייב להזין מספר טלפון — הוא מופיע בטופס המשחק"
              : "פרטי הקשר שלך (השם נלקח מהחשבון; אפשר לדייק אותו כאן)"}
          </p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" aria-label="שם מלא"
            className="w-full h-11 bg-surface border border-line rounded-[12px] px-3 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fl-accent/60" />
          {/* dir=ltr so a phone number reads left-to-right inside the RTL card */}
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" dir="ltr"
            placeholder={isMedic ? "טלפון (חובה לחובש)" : "טלפון (רשות)"} aria-label="טלפון"
            className="w-full h-11 bg-surface border border-line rounded-[12px] px-3 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-fl-accent/60" />
          <button type="submit" disabled={savingContact}
            className="w-full h-11 flex items-center justify-center gap-1.5 text-[14px] font-bold px-3 rounded-[12px] bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {savingContact ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שמירת פרטים
          </button>
        </form>
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] text-fg-muted">
          {/* contact may be null — a judge is no longer forced to fill anything in, so
              this branch is now reachable with no row at all. */}
          <span className="truncate">
            {contact?.full_name?.trim() || "השם מהחשבון"}
            {contact?.phone ? <> · <span dir="ltr">{contact.phone}</span></> : null}
          </span>
          <button onClick={() => setEditing(true)} aria-label="עריכת פרטי קשר"
            className="shrink-0 size-11 -my-3 flex items-center justify-center text-fg-muted hover:text-fg-strong transition-colors">
            <Pencil className="w-4 h-4" />
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {roles.map(role => {
          const RIcon = roleIcon[role]
          const m = mine.find(x => x.role === role)
          if (m) {
            const st = statusOf(m.status)
            return (
              <span key={role} className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${st.c}`}>
                <RIcon className="w-3.5 h-3.5" /> {OFFICIAL_ROLE_LABEL[role]}: {st.t}
              </span>
            )
          }
          // A medic needs a phone; a judge only a name. Disable rather than let the
          // server refuse, and say why in the tooltip.
          const blocked = role === "medic" && !contact?.phone?.trim()
          return (
            <button key={role} onClick={() => apply(role)} disabled={busy === role || blocked}
              title={blocked ? "חובש חייב להזין טלפון תחילה" : undefined}
              className="inline-flex items-center gap-1.5 h-11 text-[14px] font-bold px-4 rounded-[12px] bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === role ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RIcon className="w-3.5 h-3.5" />}
              הגש מועמדות כ{OFFICIAL_ROLE_LABEL[role]}
            </button>
          )
        })}
      </div>

      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}
