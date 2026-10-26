import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { PersonRemove as UserX } from "@/components/icons/BrandIcons"
import { getBlockedProfiles, unblockUser } from "@/lib/moderation"

/**
 * "Blocked users" manager for the /me page. Closes the web parity gap with iOS
 * (AccountView.blockedUsersSection): before this, a web user who blocked someone
 * had no way to see or undo it. Self-loads; renders nothing when the list is empty.
 */
export default function BlockedUsersCard() {
  const [blocked, setBlocked] = useState([])
  const [loading, setLoading] = useState(true)
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

  if (loading || blocked.length === 0) return null

  return (
    <div className="card p-5 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide">
        <UserX className="w-4 h-4 text-brand" /> משתמשים חסומים
      </h2>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">התוכן של משתמשים חסומים מוסתר ממך. אפשר לבטל חסימה בכל עת.</p>
      <div className="space-y-2">
        {blocked.map(u => {
          const nm = u.display_name || "משתמש"
          const initial = nm.trim().charAt(0).toUpperCase()
          return (
            <div key={u.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center gap-2.5 min-w-0">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-700" />
                ) : (
                  <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-slate-300 dark:bg-slate-600 text-white text-xs font-bold">{initial}</div>
                )}
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{nm}</span>
              </div>
              <button onClick={() => doUnblock(u.id)} disabled={busyId === u.id}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shrink-0">
                {busyId === u.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />} ביטול חסימה
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
