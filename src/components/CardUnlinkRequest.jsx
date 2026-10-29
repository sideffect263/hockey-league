import { useState, useEffect } from "react"
import { Unlink, Loader2 } from "lucide-react"
import { Hourglass } from "@/components/icons/BrandIcons"
import { getMyCardUnlinkRequest, requestCardUnlink, cancelCardUnlinkRequest } from "@/lib/roleRequests"

/**
 * "זה לא הכרטיס שלי" on /me. A linked (= approved) card is no longer unlinked on the spot:
 * the account files a request with an optional reason and a league manager approves it
 * (supabase/card-unlink-requests.sql). While it waits: "הבקשה אצל מנהל הליגה" + cancel.
 * Before the migration is applied the request fails with a friendly line, nothing else.
 */
export default function CardUnlinkRequest({ playerId }) {
  const [pending, setPending] = useState(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    getMyCardUnlinkRequest().then(r => { if (alive) setPending(r) })
    return () => { alive = false }
  }, [playerId])

  const send = async () => {
    setBusy(true); setErr(null)
    try {
      await requestCardUnlink(reason.trim() || null)
      setPending(await getMyCardUnlinkRequest() || { id: "sent", status: "pending" })
      setOpen(false); setReason("")
    } catch (e) {
      setErr(e?.message === "not-available" ? "האפשרות עוד לא זמינה. נסו שוב מאוחר יותר" : "שליחת הבקשה נכשלה, נסו שוב")
    } finally { setBusy(false) }
  }

  const cancel = async () => {
    setBusy(true); setErr(null)
    try { await cancelCardUnlinkRequest(); setPending(null) }
    catch { setErr("ביטול הבקשה נכשל, נסו שוב") }
    finally { setBusy(false) }
  }

  if (pending) {
    return (
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <Hourglass className="w-3.5 h-3.5" /> בקשת הניתוק מהכרטיס אצל מנהל הליגה
        </span>
        <button onClick={cancel} disabled={busy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "ביטול הבקשה"}
        </button>
        {err && <p className="w-full text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    )
  }

  if (open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-slate-600 dark:text-slate-300">
          מנהל הליגה יבדוק ויאשר. אחרי האישור החשבון יתנתק מהכרטיס; הכרטיס, הסטטיסטיקות וההיסטוריה נשארים בליגה.
        </p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={300}
          placeholder="סיבה (לא חובה), למשל: זה הכרטיס של אח שלי"
          className="filter-input w-full text-sm" />
        <div className="flex items-center gap-2">
          <button onClick={send} disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} שליחה למנהל הליגה
          </button>
          <button onClick={() => { setOpen(false); setErr(null) }} disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            ביטול
          </button>
        </div>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    )
  }

  return (
    <button onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors">
      <Unlink className="w-3.5 h-3.5" /> זה לא הכרטיס שלי
    </button>
  )
}
