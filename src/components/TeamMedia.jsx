import { useState } from "react"
import { Link } from "react-router-dom"
import { Film, Play } from "lucide-react"
import { format } from "date-fns"
import { entityPath } from "@/lib/slugs"
import { ilDate } from "@/lib/ilTime"

/**
 * Team (and player) page media wall: the newest clip big, the next ones in a grid, full-game
 * videos as rows. Every item names its game. Filter chips appear only when there
 * is more than one kind. Items come from getTeamMedia().
 */

const KINDS = [
  { key: "clip", label: "קליפים" },
  { key: "photo", label: "תמונות" },
  { key: "story", label: "סיפורי משחק" },
  { key: "full", label: "משחקים מלאים" },
]
const GRID = 4

function gameLabel(item, teamId, teamsMap) {
  const g = item.game
  if (!g) return null
  const oppId = g.home_team_id === teamId ? g.away_team_id : g.home_team_id
  const opp = teamsMap[oppId]?.name
  return `${opp ? `מול ${opp} · ` : ""}${format(ilDate(g.game_date), "d/M")}`
}

function itemLink(item) {
  if (item.to) return item.to
  return entityPath("games", item.game || item.gameId) || "#"
}

function Poster({ item, className = "" }) {
  return item.poster
    ? <img src={item.poster} alt="" loading="lazy" className={`w-full h-full object-cover ${className}`} />
    : <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-900" />
}

function PlayDot({ small }) {
  return (
    <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 grid place-items-center shadow ${small ? "w-7 h-7" : "w-11 h-11"}`}>
      <Play className={`${small ? "w-3.5 h-3.5" : "w-5 h-5"} text-slate-900 fill-slate-900 ms-0.5`} />
    </span>
  )
}

/** `title` overrides the "<team> בווידאו" heading (the player page passes the player's name). */
export default function TeamMedia({ items, team, teamsMap, title }) {
  const [kind, setKind] = useState("all")
  const [showAll, setShowAll] = useState(false)
  const kinds = KINDS.map(k => ({ ...k, n: items.filter(i => i.kind === k.key).length })).filter(k => k.n)
  const shown = kind === "all" ? items : items.filter(i => i.kind === kind)
  const tiles = shown.filter(i => i.kind !== "full")
  const fulls = shown.filter(i => i.kind === "full")
  const [feature, ...rest] = tiles.length ? tiles : fulls.slice(0, 1)
  const gridItems = tiles.length ? (showAll ? rest : rest.slice(0, GRID)) : []
  const rowFulls = tiles.length ? fulls : fulls.slice(1)
  const hidden = tiles.length ? Math.max(0, rest.length - GRID) : 0

  return (
    <div className="card overflow-hidden">
      <div className="px-5 pt-4 pb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
          <Film className="w-4 h-4 text-brand" /> {title || team.name} בווידאו
        </h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{items.length} פריטים</span>
      </div>

      {kinds.length > 1 && (
        <div className="flex gap-1.5 px-4 pt-2 overflow-x-auto">
          {[{ key: "all", label: "הכל", n: items.length }, ...kinds].map(k => (
            <button key={k.key} onClick={() => { setKind(k.key); setShowAll(false) }}
              className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${kind === k.key
                ? "bg-brand text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}>
              {k.label}{k.key !== "all" && <span className="opacity-70"> · {k.n}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 sm:p-4 space-y-2.5">
        {feature && (
          <Link to={itemLink(feature)} className="group relative block aspect-video max-w-full rounded-xl overflow-hidden bg-black">
            <Poster item={feature} className="group-hover:scale-[1.02] transition-transform duration-300" />
            <span className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/10 to-transparent" />
            {feature.kind !== "photo" && <PlayDot />}
            <span className="absolute bottom-2.5 inset-x-3 text-white">
              <span className="block font-bold text-[15px] leading-snug line-clamp-2">{feature.title}</span>
              <span className="block text-xs opacity-80 mt-0.5">{[feature.kind === "full" && feature.cameras > 1 ? `${feature.cameras} הקלטות` : null, gameLabel(feature, team.id, teamsMap)].filter(Boolean).join(" · ")}</span>
            </span>
          </Link>
        )}

        {gridItems.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {gridItems.map(item => (
              <Link key={item.key} to={itemLink(item)} className="group relative block aspect-[16/10] rounded-lg overflow-hidden bg-black">
                <Poster item={item} className="group-hover:scale-[1.03] transition-transform duration-300" />
                <span className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/10 to-transparent" />
                {item.kind !== "photo" && <PlayDot small />}
                <span className="absolute bottom-1.5 inset-x-2 text-white">
                  <span className="block font-bold text-xs leading-snug truncate">{item.title}</span>
                  <span className="block text-[10.5px] opacity-80 truncate">{gameLabel(item, team.id, teamsMap)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}

        {rowFulls.map(item => (
          <Link key={item.key} to={itemLink(item)}
            className="group flex items-center gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <span className="relative w-28 shrink-0 aspect-video rounded-lg overflow-hidden bg-black">
              <Poster item={item} />
              <PlayDot small />
            </span>
            <span className="min-w-0">
              <span className="block font-bold text-sm text-slate-900 dark:text-white group-hover:text-brand transition-colors">📺 {item.title}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                {[gameLabel(item, team.id, teamsMap), item.cameras > 1 ? `${item.cameras} הקלטות` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
        ))}

        {hidden > 0 && !showAll && (
          <button onClick={() => setShowAll(true)} className="w-full py-2 text-xs font-bold text-brand dark:text-brand-light hover:underline">
            הצג עוד {hidden}
          </button>
        )}
      </div>
    </div>
  )
}

/** Shown in place of the wall until the team's first filmed game. */
export function TeamMediaEmpty({ team, nextGame, teamsMap }) {
  const opp = nextGame && teamsMap[nextGame.home_team_id === team.id ? nextGame.away_team_id : nextGame.home_team_id]
  return (
    <div className="card p-4">
      <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white mb-3">
        <Film className="w-4 h-4 text-brand" /> {team.name} בווידאו
      </h2>
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 p-4">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-brand/10 dark:bg-brand/20 grid place-items-center">
          <Film className="w-5 h-5 text-brand dark:text-brand-light" />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-sm text-slate-900 dark:text-white">עוד אין סרטונים של {team.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
            גולים ומשחקים מלאים יופיעו כאן אחרי משחק מצולם.
            {nextGame && <> המשחק הבא: {format(ilDate(nextGame.game_date), "d/M")}{opp ? ` מול ${opp.name}` : ""}.</>}
          </p>
        </div>
      </div>
    </div>
  )
}
