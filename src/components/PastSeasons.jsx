import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { History } from "lucide-react"
import { supabase } from "@/lib/supabase"

/**
 * "עונות קודמות" — a player's or team's frozen line from each archived season
 * (player_season_stats / team_season_stats), each linking to that season's page.
 * Renders nothing until there is at least one. api/seo.js prints the same lines
 * for crawlers, so keep the two in step.
 */
export default function PastSeasons({ playerId, teamId }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let alive = true
    const q = playerId
      ? supabase.from("player_season_stats").select("id, goals, games_played, blue_cards, red_cards, team_name, season:seasons(name, slug)").eq("player_id", playerId)
      : supabase.from("team_season_stats").select("id, final_rank, points, wins, ties, losses, goals_for, goals_against, season:seasons(name, slug)").eq("team_id", teamId)
    q.then(({ data }) => {
      if (alive) setRows((data || []).filter(r => r.season).sort((a, b) => b.season.name.localeCompare(a.season.name)))
    })
    return () => { alive = false }
  }, [playerId, teamId])

  if (!rows.length) return null

  return (
    <div className="card overflow-hidden">
      <h2 className="flex items-center gap-2 px-5 py-4 border-b border-line font-bold text-sm text-fg-strong">
        <History className="w-4 h-4 text-brand" /> עונות קודמות
      </h2>
      <ul className="divide-y divide-line-subtle">
        {rows.map(r => (
          <li key={r.id}>
            <Link to={`/archive/${encodeURIComponent(r.season.slug)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-sunken transition-colors">
              <span className="min-w-0">
                <span className="block text-sm font-bold text-fg-strong">עונת {r.season.name}</span>
                {playerId && r.team_name && <span className="block text-[11px] text-fg-muted">{r.team_name}</span>}
              </span>
              <span className="flex flex-wrap justify-end items-center gap-x-3 gap-y-0.5 text-xs text-fg-muted shrink-0">
                {playerId ? (
                  <>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{r.goals} שערים</span>
                    <span>{r.games_played} מש׳</span>
                    {r.blue_cards > 0 && <span className="text-blue-500">{r.blue_cards} כחול</span>}
                    {r.red_cards > 0 && <span className="text-red-500">{r.red_cards} אדום</span>}
                  </>
                ) : (
                  <>
                    <span className="font-bold text-fg-strong">מקום {r.final_rank}</span>
                    <span>{r.points} נק׳</span>
                    <span dir="ltr">{r.wins}-{r.ties}-{r.losses}</span>
                    <span dir="ltr">{r.goals_for}:{r.goals_against}</span>
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
