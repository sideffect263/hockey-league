import { useEffect, useState } from "react"
import { BadgeCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getRoleBadges } from "@/lib/api"
import { RoleBadge, OgBadge, deriveRoleItems } from "@/components/RoleBadges"

/**
 * The badges next to a commenter's name — the same set a post author gets (שחקן,
 * OG #n, league roles), so a comment says who is talking just like a post does.
 *
 * Comments open one thread at a time, so lookups are batched per thread by
 * useCommentBadges and cached for the tab's life: re-opening a thread, or the same
 * person commenting under ten posts, costs nothing.
 */

const roleCache = new Map()   // userId → { isAdmin, roles } (null = no public role)
const ogCache = new Map()     // playerId → og_number | null

async function loadBadges(comments) {
  const userIds = [...new Set(comments.map(c => c.author_id).filter(id => id && !roleCache.has(id)))]
  const playerIds = [...new Set(comments.map(c => c.author?.player_id).filter(id => id && !ogCache.has(id)))]
  await Promise.all([
    userIds.length && getRoleBadges(userIds).then(map => {
      for (const id of userIds) roleCache.set(id, map[id] || null)
    }),
    // players has column-level grants — name the columns, never select('*').
    playerIds.length && supabase.from("players").select("id, og_number").in("id", playerIds).then(({ data }) => {
      const byId = Object.fromEntries((data || []).map(p => [p.id, p.og_number ?? null]))
      for (const id of playerIds) ogCache.set(id, byId[id] ?? null)
    }),
  ])
}

/** Re-renders the thread once its authors' badges are known. */
export function useCommentBadges(comments) {
  const [, bump] = useState(0)
  const key = (comments || []).map(c => c.author_id).join(",")
  useEffect(() => {
    if (!comments?.length) return
    let alive = true
    loadBadges(comments).then(() => alive && bump(n => n + 1)).catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

export default function CommentAuthorBadges({ authorId, playerId }) {
  const badge = roleCache.get(authorId)
  const roleItems = badge ? deriveRoleItems({ isAdmin: badge.isAdmin, roles: badge.roles }) : []
  const og = playerId ? ogCache.get(playerId) : null
  if (!playerId && !roleItems.length) return null
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {playerId && (
        <span title="מקושר לשחקן" className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
          <BadgeCheck className="w-3 h-3" /> שחקן
        </span>
      )}
      <OgBadge number={og} size="sm" />
      {roleItems.map(it => <RoleBadge key={it.role} role={it.role} size="sm" />)}
    </span>
  )
}
