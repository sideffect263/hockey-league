import { useEffect, useRef } from "react"
import { Person as User } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import Composer from "@/components/feed/Composer"

/**
 * The composer as a bottom sheet (Composer board): slides up on a phone, a centred dialog
 * on desktop. Opened from the feed's "מה קורה בליגה?" row and from the + fan's "פוסט חדש"
 * (/?compose=1, read and dropped by Feed.jsx). Esc / backdrop / ביטול close it.
 */
export default function ComposerSheet({ open, onClose, onPosted }) {
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <button type="button" aria-label="סגירה" onClick={onClose} className="absolute inset-0 bg-[rgba(7,11,16,.6)] fl-fade-in cursor-default" tabIndex={-1} />
      <section ref={panel} role="dialog" aria-modal="true" aria-label="פוסט חדש"
        className="relative w-full sm:max-w-[560px] max-h-[92vh] overflow-y-auto overscroll-contain bg-surface rounded-t-[28px] sm:rounded-[28px] px-4 pt-2.5 pb-[max(20px,env(safe-area-inset-bottom))] fl-sheet-in">
        <span aria-hidden="true" className="mx-auto mb-2 block h-[5px] w-10 rounded-full bg-line-strong sm:hidden" />
        <Composer autoFocus onCancel={onClose} onPosted={(p, tags) => { onPosted?.(p, tags); onClose() }} />
        <p className="mt-3 text-[12px] text-fg-subtle">העלאת וידאו פתוחה למנהלים ולעורכי תוכן. לשאר: טקסט, תמונה, תיוג ומשחק.</p>
      </section>
    </div>
  )
}

/** The feed's entry row for staff who can post: avatar + "מה קורה בליגה?". */
export function ComposerPrompt({ onOpen }) {
  const { user, canPost, profile } = useAuth()
  if (!user || !canPost) return null
  const initial = (profile?.display_name || user.email || "").trim().charAt(0).toUpperCase()
  return (
    <button type="button" onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-card bg-surface border border-line p-3 text-right hover:border-line-strong transition-colors">
      <span className="size-10 shrink-0 rounded-full bg-brand text-brand-fg flex items-center justify-center font-bold">{initial || <User className="w-5 h-5" />}</span>
      <span className="flex-1 min-w-0 min-h-[44px] flex items-center rounded-full bg-surface-inset px-4 text-[14px] text-fg-subtle truncate">מה קורה בליגה? (@ לתיוג שחקן)</span>
    </button>
  )
}
