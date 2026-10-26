import { useState, useEffect } from "react"
import { Loader2, Check } from "lucide-react"
import { Announce as Megaphone } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { broadcastToGame, getGameAudienceSize, BROADCAST_MAX } from "@/lib/broadcast"

/**
 * P4 / sheet row 25 — the league manager writes directly to everyone involved in one
 * game ("המשחק עשוי לעבור לביאליק בגלל גשם").
 *
 * The recipient count is shown up front and deliberately: it is the number of people
 * with a linked ACCOUNT, which is far smaller than the number of players. A manager who
 * thinks he just told the whole league, when he reached a third of it, is worse off
 * than one who can see the gap.
 */
export default function GameBroadcast({ game }) {
  const { isAdmin, isLeagueManager } = useAuth()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null)
  const [audience, setAudience] = useState(null)
  const [err, setErr] = useState(null)

  const allowed = isAdmin || isLeagueManager

  useEffect(() => {
    if (!allowed || !open) return
    let alive = true
    getGameAudienceSize(game.id).then(n => { if (alive) setAudience(n) }).catch(() => {})
    return () => { alive = false }
  }, [allowed, open, game.id])

  if (!allowed || game.status === "completed") return null

  const send = async (e) => {
    e.preventDefault()
    setSending(true); setErr(null)
    try {
      const n = await broadcastToGame(game.id, message)
      setSent(n)
      setMessage("")
      setTimeout(() => { setSent(null); setOpen(false) }, 2500)
    } catch (e2) { setErr(e2.message) } finally { setSending(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
        <Megaphone className="w-4 h-4" /> שליחת הודעה למשתתפי המשחק
      </button>
    )
  }

  return (
    <form onSubmit={send} className="card p-4 space-y-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
        <Megaphone className="w-4 h-4 text-brand" /> הודעה למשתתפי המשחק
      </p>

      <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={BROADCAST_MAX}
        aria-label="תוכן ההודעה" placeholder="למשל: המשחק עשוי לעבור לביאליק בגלל גשם"
        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          {audience == null
            ? "…"
            : <>ההודעה תגיע ל־<strong className="tabular-nums">{audience}</strong> משתתפים עם חשבון</>}
        </span>
        <span className="tabular-nums">{message.length}/{BROADCAST_MAX}</span>
      </div>

      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
      {sent != null && (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <Check className="w-3.5 h-3.5" /> ההודעה נשלחה ל־{sent} משתתפים
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={sending || !message.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-4 h-4" />} שליחה
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(null); setMessage("") }}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          ביטול
        </button>
      </div>
    </form>
  )
}
