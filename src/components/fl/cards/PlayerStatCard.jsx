/**
 * EA FC-style player card: OVR, the player's background-free cutout (player_cutouts) and a
 * five-axis radar of real numbers (playerRating.js) — nothing on the card is typed in by hand.
 * Used by the game-preview hero (PreviewStatCards) and the league-wide /cards page.
 */
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { CrestDisc } from "@/components/fl/Floodlight"
import { aggregate, playerCard } from "./playerRating"

const PAGE = 1000

async function allRows(fn, args) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

let leagueData // one fetch per page load, shared by every card
export function loadLeague() {
  leagueData ??= (async () => {
    const [{ data: seasons, error: se }, { data: plist, error: pe }, { data: cuts }, { data: frozen }] = await Promise.all([
      supabase.from("seasons").select("id, status"),
      supabase.from("players").select("id, first_name, last_name, jersey_number, team_id, position, is_referee"),
      supabase.from("player_cutouts").select("player_ids, image_url").eq("status", "approved"),
      supabase.from("player_season_stats").select("season_id, player_id, team_id"),
    ])
    if (se) throw se
    if (pe) throw pe
    const { data: fanRows } = await supabase.rpc("follower_counts", { p_type: "player", p_ids: (plist || []).map(p => p.id) })
    const per = await Promise.all((seasons || []).map(s => Promise.all([
      allRows("season_games", { p_season_id: s.id }),
      allRows("season_game_stats", { p_season_id: s.id }),
    ])))
    const players = Object.fromEntries((plist || []).map(p => [p.id, p]))
    const currentSeasonId = seasons?.find(s => s.status === "active")?.id
    const seasonTeams = {}
    for (const r of frozen || []) (seasonTeams[r.season_id] ??= {})[r.player_id] = r.team_id
    const totals = aggregate({ games: per.flatMap(([g]) => g), stats: per.flatMap(([, st]) => st), players, currentSeasonId, seasonTeams })
    const fans = Object.fromEntries((fanRows || []).map(r => [r.target_id, Number(r.followers)]))
    // a player's own solo cutouts, first one (1.png) first
    const cutouts = {}
    for (const c of [...(cuts || [])].sort((a, b) => a.image_url.localeCompare(b.image_url))) {
      if (c.player_ids?.length === 1) (cutouts[c.player_ids[0]] ??= c.image_url)
    }
    return { totals, players, fans, cutouts }
  })().catch(err => { leagueData = undefined; throw err })
  return leagueData
}

export function usePlayerCards(ids) {
  const key = ids.join(",")
  const [cards, setCards] = useState(null)
  useEffect(() => {
    let live = true
    loadLeague()
      .then(d => { if (live) setCards(ids.map(id => (id ? cardFor(id, d) : null))) })
      .catch(() => { if (live) setCards([]) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return cards
}

/** Card data for one player: rating (null axes when he has no games yet) + his cutout. */
export function cardFor(id, d) {
  return { ...(playerCard(id, d) || {}), cutout: d.cutouts[id] }
}

/** Pentagon radar: the shape is the percentile, the labels are the real numbers. */
export function Radar({ axes, size = 132 }) {
  const c = size / 2, R = size / 2 - 24
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length
    return [c + r * Math.cos(a), c + r * Math.sin(a)]
  }
  const ring = f => axes.map((_, i) => pt(i, R * f).join(",")).join(" ")
  const shape = axes.map((ax, i) => pt(i, R * Math.max(0.1, ax.pct)).join(",")).join(" ")
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[160px] mx-auto block" role="img"
      aria-label={axes.map(ax => `${ax.label} ${ax.shown}`).join(", ")}>
      {[1, 0.66, 0.33].map(f => <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" /> })}
      <polygon points={shape} fill="rgba(74,222,128,0.38)" stroke="#4ade80" strokeWidth="1.6" strokeLinejoin="round" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R + 14)
        return (
          <text key={ax.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff">
            <tspan x={x} dy="-4" fontSize="8.5" fontWeight="700" fill="rgba(255,255,255,0.7)">{ax.label}</tspan>
            <tspan x={x} dy="10.5" fontSize="11" fontWeight="900">{ax.shown}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

export function PlayerStatCard({ who, team, card }) {
  const accent = team?.primary_color || "#4ade80"
  return (
    <div dir="rtl" className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(160deg,rgba(22,28,40,0.92),rgba(8,11,17,0.95))] text-white p-2.5 sm:p-3.5 shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] sm:text-[17px] font-black leading-tight truncate">{who.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/75 whitespace-nowrap">
            <span className="size-1.5 rounded-full bg-[#4ade80]" aria-hidden="true" />
            {card?.goalie ? "שוער" : "שחקן שדה"}
            {who.number != null && <span dir="ltr">· #{who.number}</span>}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] font-bold min-w-0">
            <CrestDisc team={team} size={18} disc={false} />
            <span className="truncate">{team?.name}</span>
          </p>
        </div>
        <div className="text-left leading-none shrink-0">
          <span className="block text-[10px] font-bold tracking-wide text-white/60" dir="ltr">OVR</span>
          <span className="block fl-num text-[34px] sm:text-[40px] font-black text-[#4ade80] tabular-nums" dir="ltr">{card?.ovr ?? "–"}</span>
        </div>
      </div>
      <div className="relative mt-1 h-44 sm:h-56 flex items-end justify-center">
        <span aria-hidden="true" className="absolute inset-x-2 bottom-2 top-4 rounded-full blur-2xl opacity-40" style={{ background: `radial-gradient(closest-side, ${accent}, transparent)` }} />
        {card?.cutout ? (
          <img src={card.cutout} alt={who.name} loading="lazy" decoding="async"
            className="relative h-full w-auto max-w-full object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.55)]" />
        ) : card && (
          <svg viewBox="0 0 100 140" aria-hidden="true" className="relative h-[85%] w-auto opacity-35">
            <circle cx="50" cy="30" r="20" fill={accent} />
            <path d="M12 140 C12 88 30 64 50 64 C70 64 88 88 88 140 Z" fill={accent} />
          </svg>
        )}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-[rgba(10,13,19,0.9)]" />
      </div>
      <div className="border-t border-white/10 pt-1">
        {card?.axes ? <Radar axes={card.axes} />
          : card ? <div className="aspect-square max-w-[160px] mx-auto grid place-items-center text-[12px] text-white/55">עוד אין משחקים</div>
          : <div className="aspect-square max-w-[160px] mx-auto" />}
      </div>
    </div>
  )
}
