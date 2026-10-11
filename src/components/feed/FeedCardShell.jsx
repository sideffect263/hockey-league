import { motion } from "framer-motion"

/**
 * The one frame every feed card uses (2026-10-11): people's posts, news, results,
 * milestones, birthdays, season awards and הוקי מרקט all share it, so the feed reads
 * as one list instead of a patchwork of boxes.
 *
 *   header (round icon/avatar · title · grey meta line · ⋯)
 *   body   (the only part that differs by type)
 *   media  (edge to edge on a phone)
 *   footer (♥ 💬 … share — ReactionBar or PostCard's own row)
 *
 * On a phone the card runs edge to edge: the feed's p-4 gutter is undone with -mx-4
 * and anything that isn't media is put back with INSET. From sm up it is an ordinary
 * card in the column.
 */

export const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
}

// Horizontal padding for text rows inside a FeedCard (media rows skip it).
export const INSET = "px-4 sm:px-0"

export function FeedCard({ className = "", children, ...rest }) {
  return (
    <motion.div {...fade} {...rest}
      className={`card -mx-4 sm:mx-0 py-3 sm:p-4 rounded-none sm:rounded-2xl border-x-0 sm:border-x shadow-none sm:shadow-sm ${className}`}>
      {children}
    </motion.div>
  )
}

/* Round badge in the avatar slot for automatic posts. `tone` is a Tailwind
   bg/text pair so each kind keeps its colour without a coloured card. */
export function FeedIcon({ tone = "bg-brand/10 text-brand dark:text-brand-light", children }) {
  return (
    <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-base leading-none ${tone}`}>
      {children}
    </span>
  )
}

/* avatar: a FeedIcon or an Avatar. title: bold line (may hold badges). meta: grey line. */
export function FeedCardHeader({ avatar, title, meta, menu }) {
  return (
    <div className={`flex items-center gap-3 mb-3 ${INSET}`}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 text-sm font-bold text-slate-900 dark:text-white">
          {title}
        </div>
        {meta && <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1">{meta}</div>}
      </div>
      {menu}
    </div>
  )
}
