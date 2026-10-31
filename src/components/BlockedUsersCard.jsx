import { useState, useEffect } from "react"
import { getBlockedProfiles, unblockUser } from "@/lib/moderation"
import { AccRow, AccButton, Glyph, Spinner } from "@/components/fl/account/AccountKit"

/**
 * "משתמשים חסומים" row of the פרטיות group on /me (board MyPage). Closes the web parity
 * gap with iOS (AccountView.blockedUsersSection): a web user who blocked someone can see
 * and undo it. Self-loads; "אין חסומים" when the list is empty, the list opens in place.
 */
export default function BlockedUsersCard() {
  const [blocked, setBlocked] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    let alive = true
    getBlockedProfiles()
      .then(list => alive && setBlocked(list))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const doUnblock = async (id) => {
    setBusyId(id)
    try {
      await unblockUser(id)
      setBlocked(prev => prev.filter(b => b.id !== id))
    } catch { /* ignore — stays in the list, user can retry */ }
    finally { setBusyId(null) }
  }

  const n = blocked.length
  const sub = loading ? "טוען…" : n === 0 ? "אין חסומים" : n === 1 ? "משתמש אחד חסום · התוכן שלו מוסתר ממך" : `${n} משתמשים חסומים · התוכן שלהם מוסתר ממך`
  return (
    <AccRow line="block" label="משתמשים חסומים" sub={sub}
      onClick={n ? () => setOpen(v => !v) : undefined}
      trailing={n ? <Glyph d="chev" size={18} className={`text-fg-subtle transition-transform ${open ? "rotate-90" : "-rotate-90"}`} /> : undefined}>
      {open && n > 0 && (
        <ul className="mx-3.5 mb-3 rounded-[14px] bg-surface-page divide-y divide-line">
          {blocked.map(u => {
            const nm = u.display_name || "משתמש"
            return (
              <li key={u.id} className="flex items-center gap-2.5 px-3 py-1.5 min-h-[56px]">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 bg-surface-sunken" />
                ) : (
                  <span className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-surface-sunken text-fg-strong text-xs font-bold">{nm.trim().charAt(0)}</span>
                )}
                <span className="flex-1 min-w-0 text-[14px] font-semibold text-fg-strong truncate">{nm}</span>
                <AccButton tone="outline" onClick={() => doUnblock(u.id)} disabled={busyId === u.id} aria-label={`ביטול חסימה: ${nm}`}>
                  {busyId === u.id && <Spinner />} ביטול חסימה
                </AccButton>
              </li>
            )
          })}
        </ul>
      )}
    </AccRow>
  )
}
