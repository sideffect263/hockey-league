import { useState, useEffect, useRef } from "react"
import { getMyMedical, uploadMedical } from "@/lib/medical"
import { HeartPulse, Upload, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { format } from "date-fns"

/**
 * The player's medical-certificate card (#2). Uploads a photo/PDF of the yearly
 * physical to the private bucket for coach approval, and shows the current status.
 * Renders for a linked player only.
 */
export default function MedicalCertificateCard({ playerId }) {
  const [cert, setCert] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const load = async () => { setCert(await getMyMedical(playerId)); setLoading(false) }
  useEffect(() => { load() }, [playerId])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
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

  if (loading) return null
  const isExpired = cert?.status === "approved" && cert.expires_at && new Date(cert.expires_at) < new Date()
  const canUpload = !cert || cert.status === "rejected" || isExpired
  // Status line — approved shows validity/expiry; an expired cert reads as "renew".
  let st = null
  if (cert?.status === "pending") st = { label: "ממתין לאישור המאמן", cls: "text-amber-600 dark:text-amber-400", Icon: Clock }
  // Stage 2 — say who is holding it and that he still cannot play, otherwise this
  // reads as "approved" and the first blocked game registration is a support call.
  else if (cert?.status === "pending_manager") st = { label: "המאמן אישר · ממתין לאישור המנהלת", cls: "text-amber-600 dark:text-amber-400", Icon: Clock }
  else if (cert?.status === "approved" && !isExpired) st = { label: cert.expires_at ? `אושר · בתוקף עד ${format(new Date(cert.expires_at), "d/M/yyyy")}` : "אושר", cls: "text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 }
  else if (cert?.status === "approved" && isExpired) st = { label: "פג תוקף — יש לחדש", cls: "text-red-600 dark:text-red-400", Icon: XCircle }
  else if (cert?.status === "rejected") st = { label: "נדחה — יש להעלות מחדש", cls: "text-red-600 dark:text-red-400", Icon: XCircle }

  return (
    <div className="card p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <HeartPulse className="w-4 h-4 text-orange-500" /> אישור רפואי
      </h3>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        העלו צילום של הבדיקה הרפואית השנתית לאישור המאמן. הקובץ פרטי — נראה רק לך, למאמן ולמנהל.
      </p>

      {st && (
        <div className={`flex items-center gap-2 text-sm font-semibold ${st.cls}`}>
          <st.Icon className="w-4 h-4" /> {st.label}
        </div>
      )}

      {canUpload && (
        <div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onFile} className="hidden" id="medical-file" />
          <label htmlFor="medical-file"
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors cursor-pointer">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {(cert?.status === "rejected" || isExpired) ? "העלאה מחדש" : "העלאת אישור"}
          </label>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
