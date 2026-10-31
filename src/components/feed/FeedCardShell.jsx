import { motion } from "framer-motion"

/**
 * The one frame every feed card uses (2026-10-11): people's posts, news, results,
 * milestones, birthdays, season awards and סטופר מרקט all share it, so the feed reads
 * as one list instead of a patchwork of boxes.
 *
 *   header (round icon/avatar · title · grey meta line · ⋯)
 *   body   (the only part that differs by type)
 *   media  (edge to edge on a phone)
 *   footer (♥ 💬 … share — ReactionBar or PostCard's own row)
 *
 * On a phone the card runs edge to edge: the feed's p-4 gutter is undone with -mx-4
 * and anything that isn't media is put back with INSET. From sm up it is an ordinary
 * card in the column. Floodlight (2026-10-31, FeedPosts / GamePost boards): paper card,
 * no border or shadow on a phone, an 8px strip of page colour between posts (the feed
 * list's gap), 36px round avatar, 14px bold name, 12px grey meta.
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
      className={`bg-surface text-fg -mx-4 sm:mx-0 pt-3 pb-3.5 sm:p-4 rounded-none sm:rounded-card sm:border sm:border-line ${className}`}>
      {children}
    </motion.div>
  )
}

/* Round badge in the avatar slot for automatic posts. `tone` is a Tailwind
   bg/text pair so each kind keeps its colour without a coloured card. */
export function FeedIcon({ tone = "bg-surface-sunken text-fg-strong", children }) {
  return (
    <span className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-base leading-none ${tone}`}>
      {children}
    </span>
  )
}

/* avatar: a FeedIcon or an Avatar. title: bold line (may hold badges). meta: grey line. */
export function FeedCardHeader({ avatar, title, meta, menu }) {
  return (
    <div className={`flex items-center gap-2.5 mb-3 ${INSET}`}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 text-[14px] font-bold text-fg-strong">
          {title}
        </div>
        {meta && <div className="text-[12px] text-fg-muted flex flex-wrap items-center gap-1">{meta}</div>}
      </div>
      {menu}
    </div>
  )
}
