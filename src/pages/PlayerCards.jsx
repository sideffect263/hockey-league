import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeo } from "@/lib/seo"
import { getTeams } from "@/lib/api"
import { PlayerStatCard, loadLeague, cardFor } from "@/components/fl/cards/PlayerStatCard"

/**
 * כרטיסי שחקנים — /cards (dev trial). An EA FC-style card for every player on a current team (referees who play included), best OVR
 * first, filterable by team. Same card and numbers as the game-preview hero.
 */
export default function PlayerCards() {
  useSeo({ title: "כרטיסי שחקנים", description: "כרטיס לכל שחקן בליגה: דירוג, שערים, ניסיון, התקפה, הגנה ואוהדים", path: "/cards" })
  const [data, setData] = useState(null)
  const [teams, setTeams] = useState([])
  const [team, setTeam] = useState("all")
  const [err, setErr] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([loadLeague(), getTeams("name", true)])
      .then(([d, t]) => { if (live) { setData(d); setTeams(t || []) } })
      .catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [])

  const teamById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])
  const rows = useMemo(() => {
    if (!data) return []
    return Object.values(data.players)
      // is_referee = "also referees", not "not a player": many of the league's players judge
      // too (e.g. עדן אמון, עדי רז), so they stay. Only players on a real current team show.
      .filter(p => p.team_id && teamById[p.team_id] && !teamById[p.team_id].name?.startsWith("🧪"))
      .map(p => ({ p, card: cardFor(p.id, data) }))
      .sort((a, b) => (b.card.ovr ?? 0) - (a.card.ovr ?? 0) || `${a.p.first_name}`.localeCompare(`${b.p.first_name}`, "he"))
  }, [data, teamById])
  const shown = team === "all" ? rows : rows.filter(r => r.p.team_id === team)

  const pill = on => `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-colors ${on ? "bg-fl-accent text-[#11161D] border-transparent" : "border-white/15 text-current hover:bg-white/5"}`

  return (
    <div className="max-w-6xl mx-auto px-4 py-5">
      <h1 className="text-[26px] font-black">כרטיסי שחקנים</h1>
      <p className="mt-1 text-[13px] opacity-70 leading-relaxed">
        שערים: העונה · ניסיון (משחקים), התקפה / הגנה: ממוצע השערים שהקבוצה הבקיעה / ספגה במשחקים שבהם שיחק, מכל העונות · אוהדים: עוקבים אמיתיים
      </p>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <button type="button" className={pill(team === "all")} onClick={() => setTeam("all")}>כל הליגה</button>
        {teams.filter(t => rows.some(r => r.p.team_id === t.id)).map(t => (
          <button key={t.id} type="button" className={pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>
        ))}
      </div>
      {err && <p className="mt-6 text-center opacity-70">לא הצלחנו לטעון את הכרטיסים</p>}
      {!data && !err && <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[430px] rounded-2xl bg-white/5 animate-pulse" />)}</div>}
      {data && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {shown.map(({ p, card }) => (
            <Link key={p.id} to={`/players/${p.id}`} className="block min-w-0 rounded-2xl focus-visible:outline-2">
              <PlayerStatCard who={{ name: `${p.first_name} ${p.last_name}`.trim(), number: p.jersey_number }} team={teamById[p.team_id]} card={card} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
