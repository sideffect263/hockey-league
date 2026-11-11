import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { getMyPlayerPhotos, submitPlayerPhoto, withdrawMyPlayerPhoto } from "@/lib/playerPhotos"
import { AccRow, AccChip, AccButton, Glyph, Spinner, Notice } from "@/components/fl/account/AccountKit"

const ERR = {
  "unreadable-image": "לא הצלחנו לקרוא את התמונה. נסו JPG או PNG",
  "too-small": "התמונה קטנה מדי. שלחו תמונה ברזולוציה מלאה",
}

/**
 * "תמונה לכרטיס" on /me: a linked player sends his own photo for his player card. The
 * background is removed automatically, an admin approves it, then it replaces the album/video
 * cutout on /cards. Never used on the Friday poster (supabase/player-photo-submissions.sql).
 */
export default function PlayerPhotoCard({ playerId }) {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const load = async () => {
    try { setSubs(await getMyPlayerPhotos(playerId)) } catch { /* keep last */ }
    setLoading(false)
  }
  useEffect(() => { load() }, [playerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const latest = subs.find(s => s.status !== "withdrawn" && s.status !== "replaced") || null
  const approved = subs.find(s => s.status === "approved") || null
  // poll while the worker is cutting it out
  useEffect(() => {
    if (latest?.status !== "processing") return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [latest?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null)
    try { await submitPlayerPhoto(playerId, file); await load() }
    catch (err) { setError(ERR[err?.message] || "ההעלאה נכשלה, נסו שוב") }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }
  const onWithdraw = async () => {
    setBusy(true); setError(null)
    try { await withdrawMyPlayerPhoto(); await load() }
    catch { setError("הביטול נכשל, נסו שוב") }
    finally { setBusy(false) }
  }

  if (loading) return <AccRow brand="cards" label="תמונה לכרטיס השחקן" sub="טוען…" />

  let st = { chip: null, sub: "שלחו תמונה שלכם והיא תופיע בכרטיס השחקן אחרי אישור" }
  if (latest?.status === "processing") st = { chip: { t: "בעיבוד", tone: "warn" }, sub: "מסירים את הרקע… זה לוקח כמה דקות" }
  else if (latest?.status === "ready") st = { chip: { t: "ממתין", tone: "warn" }, sub: "הרקע הוסר · ממתין לאישור מנהל הליגה" }
  else if (latest?.status === "failed") st = { chip: { t: "לא הצליח", tone: "err" }, sub: latest.note || "לא הצלחנו להפריד אתכם מהרקע. נסו תמונה אחרת" }
  else if (latest?.status === "rejected") st = { chip: { t: "נדחה", tone: "err" }, sub: latest.note ? `נדחה: ${latest.note}` : "נדחה. אפשר לשלוח תמונה אחרת" }
  else if (latest?.status === "approved") st = { chip: { t: "בכרטיס", tone: "ok" }, sub: "התמונה שלכם מופיעה בכרטיס השחקן" }

  const open = latest && (latest.status === "processing" || latest.status === "ready")
  const preview = latest?.cutout_url || approved?.cutout_url

  return (
    <AccRow brand="cards" label="תמונה לכרטיס השחקן" sub={st.sub}
      trailing={st.chip && <AccChip tone={st.chip.tone}>{st.chip.t}</AccChip>}>
      <div className="px-3.5 pb-3 -mt-1 flex flex-col gap-2.5">
        {preview && (
          <div className="flex items-end gap-3">
            <div className="h-36 w-28 rounded-xl bg-gradient-to-b from-[#1b2a52] to-[#0d1530] flex items-end justify-center overflow-hidden">
              <img src={preview} alt="" className="h-full w-full object-contain object-bottom" />
            </div>
            {latest?.status === "approved" && <Link to="/players" className="text-[13px] font-bold underline h-11 flex items-center">לכרטיס שלי</Link>}
          </div>
        )}
        {!latest && (
          <p className="text-[12.5px] leading-[1.5] text-fg-muted">
            הכי טוב: צילום מלא מהראש עד הגלגיליות, עומדים לבד, פנים למצלמה, בתלבושת הקבוצה, על רקע פשוט.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="sr-only" id="player-photo-file" tabIndex={-1} />
          <AccButton tone="ink" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Glyph d="upload" size={17} />} {busy ? "שולח…" : latest ? "שליחת תמונה אחרת" : "שליחת תמונה"}
          </AccButton>
          {open && <AccButton tone="outline" onClick={onWithdraw} disabled={busy}>ביטול</AccButton>}
        </div>
        {error && <Notice tone="err">{error}</Notice>}
      </div>
    </AccRow>
  )
}
