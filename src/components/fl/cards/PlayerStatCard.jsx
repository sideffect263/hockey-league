/**
 * EA FC-style player card: OVR, the player's background-free cutout (player_cutouts) and a
 * five-axis radar of real numbers (playerRating.js) — nothing on the card is typed in by hand.
 * Used by the game-preview hero (PreviewStatCards) and the league-wide /cards page.
 */
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { CrestDisc } from "@/components/fl/Floodlight"
import { KeeperStickMark, FieldStickMark } from "@/components/fl/teams/FLTeamsKit"
import { aggregate, playerCard, lastGameChange } from "./playerRating"

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
/** Every season's games + sheets, players, fans and cutouts. Last season's games are matched to
 *  the team each player was on THAT season (player_season_stats, frozen at season close). */
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
    const [{ data: fanRows }, per] = await Promise.all([
      supabase.rpc("follower_counts", { p_type: "player", p_ids: (plist || []).map(p => p.id) }),
      Promise.all((seasons || []).map(s => Promise.all([
        allRows("season_games", { p_season_id: s.id }),
        allRows("season_game_stats", { p_season_id: s.id }),
      ]))),
    ])
    const players = Object.fromEntries((plist || []).map(p => [p.id, p]))
    const currentSeasonId = seasons?.find(s => s.status === "active")?.id
    const seasonTeams = {}
    for (const r of frozen || []) (seasonTeams[r.season_id] ??= {})[r.player_id] = r.team_id
    const games = per.flatMap(([g]) => g), stats = per.flatMap(([, st]) => st)
    const totals = aggregate({ games, stats, players, currentSeasonId, seasonTeams })
    const fans = Object.fromEntries((fanRows || []).map(r => [r.target_id, Number(r.followers)]))
    // a player's own solo cutouts, first one (1.png) first
    const cutouts = {}
    for (const c of [...(cuts || [])].sort((a, b) => a.image_url.localeCompare(b.image_url))) {
      if (c.player_ids?.length === 1) (cutouts[c.player_ids[0]] ??= c.image_url)
    }
    return { totals, players, fans, cutouts, games, stats, currentSeasonId, seasonTeams, changeCache: new Map() }
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
  return { ...(playerCard(id, d) || {}), cutout: d.cutouts[id], change: lastGameChange(id, d, d.changeCache) }
}

/** ▲4 / ▼3 since the player's last game; nothing when it didn't move. */
export function Delta({ d, className = "" }) {
  if (!d) return null
  const up = d > 0
  return (
    <span dir="ltr" className={`inline-block font-black tabular-nums ${up ? "text-[#4ade80]" : "text-[#f87171]"} ${className}`}
      aria-label={`${up ? "עלה" : "ירד"} ${Math.abs(d)} מהמשחק הקודם`}>
      {up ? "▲" : "▼"}{Math.abs(d)}
    </span>
  )
}

/** Pentagon radar: the shape is the share of the best, the labels are the real numbers.
 *  Labels are HTML laid over the SVG, not SVG <text>: iOS Safari breaks Hebrew <tspan>s
 *  mid-word in an RTL page ("ניסיו / ן"). */
export function Radar({ axes, size = 132, padX = 0, className = "max-w-[160px]", labelClass = "text-[9px]", valueClass = "text-[12px]", changes }) {
  const c = size / 2, R = size / 2 - 26
  const W = size + 2 * padX
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length
    return [c + r * Math.cos(a), c + r * Math.sin(a)]
  }
  const ring = f => axes.map((_, i) => pt(i, R * f).join(",")).join(" ")
  const shape = axes.map((ax, i) => pt(i, R * Math.max(0.1, ax.pct)).join(",")).join(" ")
  return (
    <div className={`relative w-full mx-auto ${className}`} role="img" aria-label={axes.map(ax => `${ax.label} ${ax.shown}`).join(", ")}>
      <svg viewBox={`${-padX} 0 ${W} ${size}`} className="w-full block" aria-hidden="true">
        {[1, 0.66, 0.33].map(f => <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />)}
        {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" /> })}
        <polygon points={shape} fill="rgba(74,222,128,0.38)" stroke="#4ade80" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R + 15)
        return (
          <div key={ax.key} aria-hidden="true" className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-[1.1] whitespace-nowrap"
            style={{ left: `${((x + padX) / W) * 100}%`, top: `${(y / size) * 100}%` }}>
            <span className={`block font-bold text-white/70 ${labelClass}`}>{ax.label}</span>
            <span className={`block font-black text-white tabular-nums ${valueClass}`} dir="ltr">{ax.shown}{changes?.[ax.key] ? <Delta d={changes[ax.key]} className="ms-0.5 text-[0.7em] align-[0.15em]" /> : null}</span>
          </div>
        )
      })}
    </div>
  )
}

export function PlayerStatCard({ who, team, card }) {
  const accent = team?.primary_color || "#4ade80"
  return (
    <div dir="rtl" className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(160deg,rgba(22,28,40,0.92),rgba(8,11,17,0.95))] text-white p-2.5 sm:p-3.5 shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] sm:text-[17px] font-black leading-tight line-clamp-2 break-words">{who.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/75 whitespace-nowrap">
            <span className="size-1.5 rounded-full bg-[#4ade80]" aria-hidden="true" />
            {card?.goalie ? "שוער" : "שחקן שדה"}
            {card?.goalie
              ? <KeeperStickMark size={20} className="!text-white" title="" />
              : <FieldStickMark size={20} title="" />}
            {who.number != null && <span dir="ltr">#{who.number}</span>}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] sm:text-[12px] font-bold min-w-0 leading-tight">
            <CrestDisc team={team} size={18} disc={false} />
            <span className="line-clamp-2">{team?.name}</span>
          </p>
        </div>
        <div className="text-left leading-none shrink-0">
          <span className="block text-[10px] font-bold tracking-wide text-white/60" dir="ltr">OVR</span>
          <span className="block fl-num text-[30px] sm:text-[40px] font-black text-[#4ade80] tabular-nums" dir="ltr">{card?.ovr ?? "–"}</span>
          {card?.change?.ovr ? <Delta d={card.change.ovr} className="mt-0.5 text-[12px] sm:text-[13px]" /> : null}
          {card?.axes && card.ovr == null && (
            <span className="block mt-1 text-[9.5px] font-bold text-white/55 whitespace-nowrap">אחרי {card.minGames} משחקים</span>
          )}
        </div>
      </div>
      <div className={`relative mt-1 ${card?.cutout ? "h-40" : "h-20"} sm:h-56 flex items-end justify-center`}>
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
        {card?.axes ? <Radar axes={card.axes} changes={card.change?.axes} padX={18} className="max-w-[210px]" labelClass="text-[10px] sm:text-[11px]" valueClass="text-[13px] sm:text-[14px]" />
          : card ? <div className="aspect-square max-w-[150px] mx-auto grid place-items-center text-[12px] text-white/55">עוד אין משחקים</div>
          : <div className="aspect-square max-w-[160px] mx-auto" />}
      </div>
    </div>
  )
}
