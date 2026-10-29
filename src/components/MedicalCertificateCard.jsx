import { useState, useEffect, useRef } from "react"
import {
  getMyMedicalHistory, effectiveMedical, isValidMedical, isOpenMedical,
  uploadMedical, withdrawMedical, openMedical,
} from "@/lib/medical"
import { Upload, Loader2, History, ChevronDown, XCircle as XIcon, FileText } from "lucide-react"
import { ApprovedStatus as CheckCircle2, Rejected as XCircle, Clock, Medical } from "@/components/icons/BrandIcons"
import { format } from "date-fns"

const day = (v) => (v ? format(new Date(v), "d/M/yyyy") : null)
const isPdf = (c) => /\.pdf$/i.test(c?.file_path || "")

/** History row chip: status incl. בוטל (a replaced or withdrawn upload — never deleted). */
function chip(c) {
  const expired = c.status === "approved" && c.expires_at && !isValidMedical(c)
  if (c.status === "approved") return expired
    ? { label: "פג", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" }
    : { label: "אושר", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }
  if (isOpenMedical(c)) return { label: "ממתין", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" }
  if (c.status === "rejected") return { label: "נדחה", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
  if (c.status === "withdrawn") return { label: "בוטל", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" }
  return { label: c.status, cls: "bg-slate-200 text-slate-600" }
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

/**
 * The player's medical-certificate card (#2). Uploads a photo/PDF of the yearly
 * physical to the private bucket for coach approval, and shows the current status.
 * A new upload replaces one still waiting ("החלפת קובץ"); "ביטול / הסרה" withdraws the
 * waiting one after a confirm; "היסטוריה" lists every upload ever made. Nothing is
 * deleted — a replaced or withdrawn upload stays in the history as "בוטל".
 * Renders for a linked player only.
 */
export default function MedicalCertificateCard({ playerId }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const load = async () => {
    try { setHistory(await getMyMedicalHistory(playerId)); setLoadFailed(false) }
    catch { setLoadFailed(true) }
    setLoading(false)
  }
  useEffect(() => { load() }, [playerId])

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

  const onWithdraw = async () => {
    if (!open) return
    setWithdrawing(true); setError(null)
    try { await withdrawMedical(open.id); setConfirming(false); await load() }
    catch (err) { setError(err?.message || "הביטול נכשל, נסו שוב") }
    finally { setWithdrawing(false) }
  }

  const onOpen = async (c) => {
    if (!(await openMedical(c.file_path))) setError("פתיחת הקובץ נכשלה")
  }

  if (loading) return null
  const isExpired = cert?.status === "approved" && cert.expires_at && !validNow
  // Status line — approved shows validity/expiry; an expired cert reads as "renew".
  let st = null
  if (cert?.status === "pending") st = { label: "ממתין לאישור המאמן", cls: "text-amber-600 dark:text-amber-400", Icon: Clock }
  // Stage 2 — say who is holding it and that he still cannot play, otherwise this
  // reads as "approved" and the first blocked game registration is a support call.
  else if (cert?.status === "pending_manager") st = { label: "המאמן אישר · ממתין לאישור המנהלת", cls: "text-amber-600 dark:text-amber-400", Icon: Clock }
  else if (cert?.status === "approved" && !isExpired) st = { label: cert.expires_at ? `אושר · בתוקף עד ${day(cert.expires_at)}` : "אושר", cls: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 }
  else if (cert?.status === "approved" && isExpired) st = { label: "פג תוקף — יש לחדש", cls: "text-red-600 dark:text-red-400", Icon: XCircle }
  else if (cert?.status === "rejected") st = { label: "נדחה — יש להעלות מחדש", cls: "text-red-600 dark:text-red-400", Icon: XCircle }

  const uploadLabel = !cert ? "העלאת אישור" : open ? "החלפת קובץ" : (cert.status === "rejected" || isExpired) ? "העלאה מחדש" : "העלאת אישור חדש"

  return (
    <div className="card p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <Medical className="w-4 h-4" /> אישור רפואי
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        העלו צילום של הבדיקה הרפואית השנתית לאישור המאמן. הקובץ פרטי — נראה רק לך, למאמן ולמנהל.
      </p>

      {st && (
        <div className={`flex items-center gap-2 text-sm font-semibold ${st.cls}`}>
          <st.Icon className="w-4 h-4" /> {st.label}
        </div>
      )}
      {open && validNow && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
          <Clock className="w-3.5 h-3.5" />
          קובץ חדש ממתין לאישור (הועלה ב־{day(open.created_at)}) — האישור הנוכחי נשאר בתוקף עד שהחדש יאושר
        </div>
      )}
      {loadFailed && <p className="text-xs text-red-600 dark:text-red-400">טעינת הסטטוס נכשלה — <button className="underline" onClick={load}>נסו שוב</button></p>}

      {!loadFailed && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} className="hidden" id="medical-file" />
          <label htmlFor="medical-file"
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors cursor-pointer">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploadLabel}
          </label>
          {open && (
            <button type="button" onClick={() => setConfirming(true)} disabled={withdrawing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              <XIcon className="w-3.5 h-3.5" /> ביטול / הסרה
            </button>
          )}
          {history.length > 0 && (
            <button type="button" onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
              <History className="w-3.5 h-3.5" /> היסטוריה ({history.length})
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
      {open && <p className="text-[11px] text-slate-500 dark:text-slate-400">העלאה חדשה תחליף את הקובץ הממתין. הקובץ הקודם יישמר בהיסטוריה.</p>}

      {confirming && open && (
        <div role="alertdialog" aria-labelledby="med-withdraw-title"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
          <p id="med-withdraw-title" className="text-sm font-bold text-slate-900 dark:text-white">לבטל את הקובץ הממתין?</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            המאמן לא יבדוק אותו. {validNow ? "האישור הקיים שלך נשאר בתוקף." : "בלי אישור בתוקף אי אפשר להירשם למשחקים."} הקובץ לא נמחק — הוא נשאר בהיסטוריה כ״בוטל״.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onWithdraw} disabled={withdrawing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">
              {withdrawing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} ביטול הקובץ
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={withdrawing}
              className="text-xs font-semibold px-3 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
              השארת הקובץ
            </button>
          </div>
        </div>
      )}

      {showHistory && history.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700">
          {history.map(c => {
            const ch = chip(c)
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onOpen(c)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <FileText className="w-4 h-4 shrink-0 text-slate-500" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">הועלה ב־<span dir="ltr">{day(c.created_at)}</span></span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{detail(c)}</span>
                  </span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ch.cls}`}>{ch.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
