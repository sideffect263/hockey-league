import { Link } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { entityPath } from "@/lib/slugs"
import { gameLabel } from "@/lib/gamePosts"

/**
 * "🏒 <home> נגד <away> · DD.MM" under a post attached to a game (posts.game_id) → the
 * game page. Without the game row (not loaded yet) it still links, as "למשחק".
 */
export default function GameChip({ gameId, game, teamsMap, className = "" }) {
  if (!gameId) return null
  const label = game ? gameLabel(game, teamsMap || {}) : "למשחק"
  return (
    <Link to={entityPath("games", game?.id === gameId ? game : gameId) || `/games/${gameId}`}
      className={`inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/[0.07] dark:bg-brand/15 text-xs font-semibold text-brand dark:text-brand-light hover:bg-brand/[0.12] transition-colors ${className}`}>
      <span aria-hidden>🏒</span>
      <span className="truncate">{label}</span>
      <ArrowLeft className="w-3 h-3 shrink-0" />
    </Link>
  )
}
