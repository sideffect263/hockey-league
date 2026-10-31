import { useState, useEffect, useRef } from "react"
import {
  getMyMedicalHistory, effectiveMedical, isValidMedical, isOpenMedical,
  uploadMedical, withdrawMedical, openMedical,
} from "@/lib/medical"
import { format } from "date-fns"
import { AccRow, AccChip, AccButton, Glyph, Spinner, Notice, errText } from "@/components/fl/account/AccountKit"

const day = (v) => (v ? format(new Date(v), "d/M/yyyy") : null)
const isPdf = (c) => /\.pdf$/i.test(c?.file_path || "")

/** History row chip: status incl. בוטל (a replaced or withdrawn upload — never deleted). */
function chip(c) {
  const expired = c.status === "approved" && c.expires_at && !isValidMedical(c)
  if (c.status === "approved") return expired ? { label: "פג", tone: "quiet" } : { label: "אושר", tone: "ok" }
  if (isOpenMedical(c)) return { label: "ממתין", tone: "warn" }
  if (c.status === "rejected") return { label: "נדחה", tone: "err" }
  if (c.status === "withdrawn") return { label: "בוטל", tone: "quiet" }
  return { label: c.status, tone: "quiet" }
}

function detail(c) {
  const parts = []
  if (c.status === "withdrawn") parts.push(c.withdrawn_at ? `בוטל ב־${day(c.withdrawn_at)}` : "בוטל")
  else if (c.status === "approved" && c.expires_at) parts.push(`בתוקף עד ${day(c.expires_at)}`)
  else if (c.status === "pending") parts.push("ממתין לאישור המאמן")
  else if (c.status === "pending_manager") parts.push("המאמן אישר · ממתין למנהלת")
  parts.push(isPdf(c) ? "PDF" : "תמונה")
  return parts.join(" · ")
}

/** Days until an approved certificate expires (null = no date / not approved). */
export function medicalDaysLeft(cert) {
  if (cert?.status !== "approved" || !cert.expires_at) return null
  const ms = new Date(cert.expires_at).setHours(23, 59, 59) - Date.now()
  return Math.ceil(ms / 86400000)
}

/**
 * The player's medical certificate, as rows of the "בריאות וזמינות" group on /me (board
 * MyPage). Uploads a photo/PDF of the yearly physical to the private bucket for coach
 * approval, and shows the current status. A new upload replaces one still waiting
 * ("החלפת קובץ"); "ביטול / הסרה" withdraws the waiting one after a confirm; "היסטוריה"
 * lists every upload ever made, each opens with a short-lived signed link. Nothing is
 * deleted — a replaced or withdrawn upload stays in the history as "בוטל".
 * `onStatus(cert, history)` lets the page show the urgent banner. Linked player only.
 */
export default function MedicalCertificateCard({ playerId, onStatus }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [opening, setOpening] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const load = async () => {
    try {
      const h = await getMyMedicalHistory(playerId)
      setHistory(h); setLoadFailed(false)
      onStatus?.(effectiveMedical(h), h)
    } catch { setLoadFailed(true) }
    setLoading(false)
  }
  useEffect(() => { load() }, [playerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null); setConfirming(false)
    try {
      await uploadMedical(playerId, file)
      await load()
    } catch (err) {
      setError(err?.message === "medical-already-pending" ? "כבר יש אישור שממתין לבדיקה" : "ההעלאה נכשלה, נסו שוב")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const cert = effectiveMedical(history)
  const open = history.find(isOpenMedical) || null
  const validNow = isValidMedical(cert)
  const latest = history.find(c => c.status !== "withdrawn") || null

  const onWithdraw = async () => {
    if (!open) return
    setWithdrawing(true); setError(null)
    try { await withdrawMedical(open.id); setConfirming(false); await load() }
    catch (err) { setError(err?.message || "הביטול נכשל, נסו שוב") }
    finally { setWithdrawing(false) }
  }

  const onOpen = async (c) => {
    setOpening(c.id); setError(null)
    if (!(await openMedical(c.file_path))) setError("פתיחת הקובץ נכשלה")
    setOpening(null)
  }

  if (loading) {
    return <AccRow brand="medical" label="אישור רפואי" sub="טוען…" />
  }
  const isExpired = cert?.status === "approved" && cert.expires_at && !validNow
  // Status: approved shows validity; an expired cert reads as "renew"; stage 2 says who
  // is holding it and that he still cannot play (else the first blocked sign-up is a support call).
  let st = { chip: null, sub: "עוד לא הועלה. בלי אישור בתוקף אי אפשר להירשם למשחקים" }
  if (cert?.status === "pending") st = { chip: { t: "ממתין", tone: "warn" }, sub: "ממתין לאישור המאמן" }
  else if (cert?.status === "pending_manager") st = { chip: { t: "ממתין", tone: "warn" }, sub: "המאמן אישר · ממתין לאישור המנהלת. עד אז אי אפשר להירשם" }
  else if (cert?.status === "approved" && !isExpired) st = { chip: { t: "בתוקף", tone: "ok" }, sub: cert.expires_at ? `אושר · בתוקף עד ${day(cert.expires_at)}` : "אושר" }
  else if (isExpired) st = { chip: { t: "פג תוקף", tone: "err" }, sub: "פג תוקף. יש להעלות אישור חדש" }
  else if (cert?.status === "rejected") st = { chip: { t: "נדחה", tone: "err" }, sub: "נדחה. יש להעלות מחדש" }

  const uploadLabel = !cert ? "העלאת אישור" : open ? "החלפת קובץ" : (cert.status === "rejected" || isExpired) ? "העלאה מחדש" : "העלאת אישור חדש"

  return (
    <>
      <AccRow brand="medical" label="אישור רפואי"
        sub={<>{st.sub}<span className="block">הקובץ פרטי: נראה רק לך, למאמן ולמנהל הליגה</span></>}
        trailing={st.chip && <AccChip tone={st.chip.tone}>{st.chip.t}</AccChip>}>
        <div className="px-3.5 pb-3 -mt-1 flex flex-col gap-2.5">
          {open && validNow && (
            <Notice tone="warn">קובץ חדש ממתין לאישור (הועלה ב־<span dir="ltr">{day(open.created_at)}</span>). האישור הנוכחי נשאר בתוקף עד שהחדש יאושר.</Notice>
          )}
          {loadFailed ? (
            <p className={`text-[13px] ${errText}`}>טעינת הסטטוס נכשלה. <button className="underline font-bold h-11" onClick={load}>נסו שוב</button></p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} className="sr-only" id="medical-file" tabIndex={-1} />
              <AccButton tone="ink" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <Glyph d="upload" size={17} />} {uploading ? "מעלה…" : uploadLabel}
              </AccButton>
              {open && (
                <AccButton tone="outline" onClick={() => setConfirming(true)} disabled={withdrawing}>ביטול / הסרה</AccButton>
              )}
            </div>
          )}
          {open && <p className="text-[12px] text-fg-muted">העלאה חדשה תחליף את הקובץ הממתין. הקובץ הקודם יישמר בהיסטוריה.</p>}

          {confirming && open && (
            <div role="alertdialog" aria-labelledby="med-withdraw-title" className="rounded-[14px] bg-red-50 dark:bg-red-950/30 p-3.5 flex flex-col gap-2">
              <p id="med-withdraw-title" className="text-[14px] font-extrabold text-fg-strong">לבטל את הקובץ הממתין?</p>
              <p className="text-[13px] text-fg">
                המאמן לא יבדוק אותו. {validNow ? "האישור הקיים שלך נשאר בתוקף." : "בלי אישור בתוקף אי אפשר להירשם למשחקים."} הקובץ לא נמחק, הוא נשאר בהיסטוריה כ״בוטל״.
              </p>
              <div className="flex flex-wrap gap-2">
                <AccButton tone="danger" onClick={onWithdraw} disabled={withdrawing}>{withdrawing && <Spinner />} ביטול הקובץ</AccButton>
                <AccButton tone="ghost" onClick={() => setConfirming(false)} disabled={withdrawing}>השארת הקובץ</AccButton>
              </div>
            </div>
          )}
          {error && <p role="alert" className={`text-[13px] font-semibold ${errText}`}>{error}</p>}
        </div>
      </AccRow>

      {latest && (
        <AccRow line="doc" label="לצפות בקובץ שהעליתי"
          sub={`הועלה ב־${day(latest.created_at)} · ${isPdf(latest) ? "PDF" : "תמונה"} · קישור פרטי לשתי דקות`}
          onClick={() => onOpen(latest)} trailing={opening === latest.id ? <Spinner /> : undefined} chevron={opening !== latest.id} />
      )}

      {history.length > 0 && (
        <AccRow line="history" label={`היסטוריית העלאות (${history.length})`} sub="כל קובץ שהעלית, גם אלה שבוטלו"
          onClick={() => setShowHistory(v => !v)}
          trailing={<Glyph d="chev" size={18} className={`text-fg-subtle transition-transform ${showHistory ? "rotate-90" : "-rotate-90"}`} />}>
          {showHistory && (
            <ul className="mx-3.5 mb-3 rounded-[14px] bg-surface-page divide-y divide-line overflow-hidden">
              {history.map(c => {
                const ch = chip(c)
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpen(c)}
                      className="w-full min-h-[52px] flex items-center gap-3 px-3 py-2 text-start hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fl-accent">
                      <Glyph d="doc" size={18} className="text-fg-muted" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13.5px] font-bold text-fg-strong">הועלה ב־<span dir="ltr">{day(c.created_at)}</span></span>
                        <span className="block text-[12px] text-fg-muted">{detail(c)}</span>
                      </span>
                      {opening === c.id ? <Spinner /> : <AccChip tone={ch.tone}>{ch.label}</AccChip>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </AccRow>
      )}
    </>
  )
}
