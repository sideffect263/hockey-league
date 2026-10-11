import { Fragment } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@/lib/AuthContext"
import { splitMentions, canRemoveMention } from "@/lib/mentions"
import { entityPath } from "@/lib/slugs"

/**
 * A post / comment body with its active @-tags as links to the tagged player's page.
 * Only a "@<display>" backed by a mention row becomes a link; any other "@" stays text.
 */
export default function MentionText({ text, mentions }) {
  const runs = splitMentions(text, mentions)
  return runs.map((r, i) => r.mention ? (
    <Link key={i} to={entityPath("players", r.mention.player_id)} data-no-card-nav
      onClick={e => e.stopPropagation()}
      className="font-semibold text-brand dark:text-brand-light hover:underline">
      {r.text}
    </Link>
  ) : <Fragment key={i}>{r.text}</Fragment>)
}

/** Who is looking — for canRemoveMention. */
export function useMentionViewer() {
  const { user, profile, isAdmin, isContentEditor } = useAuth()
  return { userId: user?.id || null, playerId: profile?.player_id || null, isAdmin, isContentEditor }
}

/**
 * "הסר תיוג" entries for a ModerationMenu (`extraItems`), one per tag this viewer may remove.
 * `onRemove(mention)` does the RPC and the host's local state.
 */
export function untagItems(mentions, viewer, onRemove) {
  return (mentions || [])
    .filter(m => m.id && canRemoveMention(m, viewer))
    .map(m => ({ key: `untag-${m.id}`, label: `הסר תיוג · ${m.display}`, onClick: () => onRemove(m) }))
}
