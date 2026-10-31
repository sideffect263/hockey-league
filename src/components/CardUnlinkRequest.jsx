import { useState, useEffect } from "react"
import { getMyCardUnlinkRequest, requestCardUnlink, cancelCardUnlinkRequest } from "@/lib/roleRequests"
import { AccRow, AccButton, AccChip, Spinner, inputCls, errText } from "@/components/fl/account/AccountKit"

/**
 * "זה לא הכרטיס שלי" on /me (a row of הכרטיס והקבוצה, board MyPage). A linked (= approved)
 * card is not unlinked on the spot: the account files a request with an optional reason and
 * a league manager approves it (supabase/card-unlink-requests.sql). While it waits:
 * "הבקשה אצל מנהל הליגה" + cancel. Before the migration is applied the request fails with
 * a friendly line, nothing else.
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
      <AccRow line="unlink" label="זה לא הכרטיס שלי" sub="בקשת הניתוק מהכרטיס אצל מנהל הליגה"
        trailing={<AccButton tone="outline" onClick={cancel} disabled={busy}>{busy ? <Spinner /> : "ביטול הבקשה"}</AccButton>}>
        {err && <p role="alert" className={`px-3.5 pb-3 text-[12.5px] font-semibold ${errText}`}>{err}</p>}
      </AccRow>
    )
  }

  return (
    <AccRow line="unlink" label="זה לא הכרטיס שלי" tone="muted" sub="ניתוק השיוך: הכרטיס נשאר בליגה, החשבון מתנתק ממנו"
      onClick={open ? undefined : () => setOpen(true)} trailing={open ? <AccChip tone="warn">בקשה</AccChip> : undefined}>
      {open && (
        <div className="px-3.5 pb-3 -mt-1 flex flex-col gap-2">
          <p className="text-[13px] text-fg">מנהל הליגה יבדוק ויאשר. אחרי האישור החשבון יתנתק מהכרטיס; הכרטיס, הסטטיסטיקות וההיסטוריה נשארים בליגה.</p>
          <label htmlFor="unlink-reason" className="sr-only">סיבה (לא חובה)</label>
          <textarea id="unlink-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={300}
            placeholder="סיבה (לא חובה), למשל: זה הכרטיס של אח שלי" className={`${inputCls} h-auto py-2.5 resize-none`} />
          <div className="flex flex-wrap items-center gap-2">
            <AccButton tone="ink" onClick={send} disabled={busy}>{busy && <Spinner />} שליחה למנהל הליגה</AccButton>
            <AccButton tone="ghost" onClick={() => { setOpen(false); setErr(null) }} disabled={busy}>ביטול</AccButton>
          </div>
          {err && <p role="alert" className={`text-[12.5px] font-semibold ${errText}`}>{err}</p>}
        </div>
      )}
    </AccRow>
  )
}
