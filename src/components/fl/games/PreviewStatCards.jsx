/**
 * EA FC-style player cards under the game-preview clip: the two players in the video, each
 * with an OVR, a six-axis radar and their plain league numbers. Everything is computed from
 * real games of every season (playerRating.js) — nothing on the card is typed in by hand.
 * Physical left → right: away, home, matching the clip.
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

let leagueData // one fetch per page load, shared by both cards
function loadLeague() {
  leagueData ??= (async () => {
    const [{ data: seasons, error: se }, { data: plist, error: pe }] = await Promise.all([
      supabase.from("seasons").select("id, status"),
      supabase.from("players").select("id, team_id, position"),
    ])
    if (se) throw se
    if (pe) throw pe
    const per = await Promise.all((seasons || []).map(s => Promise.all([
      allRows("season_games", { p_season_id: s.id }),
      allRows("season_game_stats", { p_season_id: s.id }),
    ])))
    const players = Object.fromEntries((plist || []).map(p => [p.id, p]))
    const currentSeasonId = seasons?.find(s => s.status === "active")?.id
    const totals = aggregate({
      games: per.flatMap(([g]) => g),
      stats: per.flatMap(([, st]) => st),
      players,
      currentSeasonId,
    })
    return { totals, players }
  })().catch(err => { leagueData = undefined; throw err })
  return leagueData
}

function usePlayerCards(ids) {
  const key = ids.join(",")
  const [cards, setCards] = useState(null)
  useEffect(() => {
    let live = true
    loadLeague()
      .then(d => { if (live) setCards(ids.map(id => (id ? playerCard(id, d) : null))) })
      .catch(() => { if (live) setCards([]) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return cards
}

/** Hexagon radar, values 0–99, axis 0 at the top, clockwise. */
function Radar({ axes, size = 128 }) {
  const c = size / 2, R = size / 2 - 22
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length
    return [c + r * Math.cos(a), c + r * Math.sin(a)]
  }
  const ring = f => axes.map((_, i) => pt(i, R * f).join(",")).join(" ")
  const shape = axes.map((ax, i) => pt(i, R * Math.max(0.08, ax.value / 99)).join(",")).join(" ")
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[150px] mx-auto block" role="img"
      aria-label={axes.map(ax => `${ax.label} ${ax.value}`).join(", ")}>
      {[1, 0.66, 0.33].map(f => <polygon key={f} points={ring(f)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />)}
      {axes.map((_, i) => { const [x, y] = pt(i, R); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" /> })}
      <polygon points={shape} fill="rgba(74,222,128,0.38)" stroke="#4ade80" strokeWidth="1.6" strokeLinejoin="round" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R + 13)
        return (
          <text key={ax.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#fff">
            <tspan x={x} dy="-4" fontSize="8.5" fontWeight="700" fill="rgba(255,255,255,0.7)">{ax.label}</tspan>
            <tspan x={x} dy="10" fontSize="10.5" fontWeight="900">{ax.value}</tspan>
          </text>
        )
      })}
    </svg>
  )
}

function Card({ who, team, card, face }) {
  const accent = team?.primary_color || "#4ade80"
  return (
    <div dir="rtl" className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(160deg,rgba(22,28,40,0.92),rgba(8,11,17,0.95))] text-white p-2.5 sm:p-3.5 shadow-[0_6px_24px_rgba(0,0,0,0.35)]">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-2">
        {face
          ? <img src={face} alt="" loading="lazy" className="size-14 sm:size-16 rounded-xl object-cover bg-black/40" />
          : <span className="size-14 sm:size-16 rounded-xl bg-white/5" />}
        <div className="text-left leading-none">
          <span className="block text-[10px] font-bold tracking-wide text-white/60" dir="ltr">OVR</span>
          <span className="block fl-num text-[34px] sm:text-[40px] font-black text-[#4ade80] tabular-nums" dir="ltr">{card?.ovr ?? "–"}</span>
        </div>
      </div>
      <p className="mt-2 text-[15px] sm:text-[17px] font-black leading-tight truncate">{who.name}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-white/75">
        <span className="size-1.5 rounded-full bg-[#4ade80]" aria-hidden="true" />
        {card?.goalie ? "שוער" : "שחקן שדה"}
        {who.number != null && <span dir="ltr">· #{who.number}</span>}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold min-w-0">
        <CrestDisc team={team} size={18} disc={false} />
        <span className="truncate">{team?.name}</span>
      </p>
      <div className="mt-1.5 border-t border-white/10 pt-1.5">
        {card ? <Radar axes={card.axes} /> : <div className="aspect-square max-w-[150px] mx-auto" />}
      </div>
      {card && (
        <dl className="mt-1 grid grid-cols-3 text-center border-t border-white/10 pt-2">
          {[["שערים", card.raw.goals], ["משחקים", card.raw.gp], [card.goalie ? "נקיים" : "העונה", card.goalie ? card.raw.cs : card.raw.seasonGoals]].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] text-white/60">{k}</dt>
              <dd className="fl-num text-[15px] font-black tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export default function PreviewStatCards({ preview, home, away }) {
  const cards = usePlayerCards([preview.away?.playerId, preview.home?.playerId])
  return (
    <div dir="ltr" className="relative mt-3 grid grid-cols-2 gap-2 sm:gap-4 max-w-2xl mx-auto">
      <Card who={preview.away} team={away} card={cards?.[0]} face={preview.awayFace} />
      <Card who={preview.home} team={home} card={cards?.[1]} face={preview.homeFace} />
      <p dir="rtl" className="col-span-2 text-center text-[10.5px] text-white/55">
        הדירוג מחושב מכל משחקי הליגה בכל העונות, ביחס לשחקנים באותה עמדה
      </p>
    </div>
  )
}
