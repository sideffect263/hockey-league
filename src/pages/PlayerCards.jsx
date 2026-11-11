import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeo } from "@/lib/seo"
import { getTeams } from "@/lib/api"
import { PlayerStatCard, loadLeague, cardFor } from "@/components/fl/cards/PlayerStatCard"
import { WEIGHTS } from "@/components/fl/cards/playerRating"

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
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-5">
      <h1 className="text-[26px] font-black">כרטיסי שחקנים</h1>
      <p className="mt-1 text-[13px] opacity-70 leading-relaxed">
        כרטיס לכל שחקן, מנתוני משחקי הליגה. <a href="#how" className="underline underline-offset-2">איך מחושב כל ערך</a>
      </p>
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <button type="button" className={pill(team === "all")} onClick={() => setTeam("all")}>כל הליגה</button>
        {teams.filter(t => rows.some(r => r.p.team_id === t.id)).map(t => (
          <button key={t.id} type="button" className={pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>
        ))}
      </div>
      {err && <p className="mt-6 text-center opacity-70">לא הצלחנו לטעון את הכרטיסים</p>}
      {!data && !err && <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[430px] rounded-2xl bg-white/5 animate-pulse" />)}</div>}
      {data && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {shown.map(({ p, card }) => (
            <Link key={p.id} to={`/players/${p.id}`} className="block min-w-0 rounded-2xl focus-visible:outline-2">
              <PlayerStatCard who={{ name: `${p.first_name} ${p.last_name}`.trim(), number: p.jersey_number }} team={teamById[p.team_id]} card={card} />
            </Link>
          ))}
        </div>
      )}
      {data && <HowItsCalculated minGames={rows.find(r => r.card.minGames)?.card.minGames} fansPct={Math.round(WEIGHTS.fans * 100)} />}
    </div>
  )
}

/** The explanation at the bottom: how every number on the card is made (playerRating.js). */
function HowItsCalculated({ minGames, fansPct }) {
  const items = [
    ["שערים", "כמה שערים השחקן הבקיע העונה, לפי טופסי השיפוט."],
    ["שערים נקיים (שוערים)", "אצל שוערים, במקום שערים: בכמה משחקים, בעונה הזו ובעונה שעברה, השוער רשום בטופס והקבוצה שלו לא ספגה אף שער."],
    ["ניסיון", "בכמה משחקים השחקן רשום בטופס השיפוט, בעונה הזו ובעונה שעברה."],
    ["התקפה", "ממוצע השערים שהקבוצה שלו הבקיעה במשחקים שבהם שיחק, בשתי העונות. נספרת הקבוצה ששיחק בה באותו משחק: בעונה שעברה זו הקבוצה שהיה בה אז, ובהשאלה הקבוצה ששיחק בשבילה."],
    ["הגנה", "ממוצע השערים שהקבוצה שלו ספגה במשחקים שבהם שיחק, בשתי העונות. פחות שערים = הגנה טובה יותר."],
    ["אוהדים", "כמה אנשים עוקבים אחרי השחקן באפליקציה. שחקני הקבוצה שלו לא נספרים."],
  ]
  return (
    <section id="how" className="mt-10 scroll-mt-20 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 text-[14px] leading-relaxed">
      <h2 className="text-[20px] font-black">איך מחושב כל ערך</h2>
      <p className="mt-1 opacity-75">
        כל המספרים מגיעים ממשחקי הליגה שהסתיימו, בעונה הזו ובעונה שעברה, ומטופסי השיפוט שלהם. שערים נספרים רק מהעונה הזו. משחקי ידידות וטורנירים לא נספרים.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.04] p-3">
            <dt className="font-black">{k}</dt>
            <dd className="mt-0.5 opacity-80">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 text-[16px] font-black">הגרף</h3>
      <p className="mt-1 opacity-80">
        כל נקודה בגרף משווה את השחקן למוביל באותה עמדה (שחקני שדה מול שחקני שדה, שוערים מול שוערים). המוביל מקבל נקודה מלאה, וכל השאר מקבלים את החלק היחסי שלהם.
        לדוגמה: אם המוביל הבקיע 10 שערים ושחקן הבקיע 1, הנקודה שלו בשערים תהיה 10% מהדרך.
        בהגנה הכיוון הפוך: המוביל הוא מי שהקבוצה שלו ספגה הכי מעט, והנקודה של כל שחקן היא היחס בין המוביל אליו.
        באוהדים הנקודה המלאה היא לפחות 10 עוקבים, כדי שעוקב אחד לא ייראה כמו הרבה.
      </p>
      <h3 className="mt-6 text-[16px] font-black">הדירוג (OVR)</h3>
      <p className="mt-1 opacity-80">
        ממוצע משוקלל של חמש הנקודות, בסולם 40 עד 99 (‏40 + 59 × הממוצע). שערים, ניסיון, התקפה והגנה שווים כל אחד כמעט רבע. אוהדים שווים רק {fansPct}% מהדירוג, כי הם מודדים פופולריות ולא משחק: גם 10 עוקבים מוסיפים לכל היותר {Math.round(59 * fansPct / 100)} נקודות.
      </p>
      <h3 className="mt-6 text-[16px] font-black">מינימום משחקים</h3>
      <p className="mt-1 opacity-80">
        כדי שמשחק אחד מוצלח לא יקבע דירוג, התקפה, הגנה והדירוג מוצגים רק לשחקן ששיחק לפחות <b>{minGames} משחקים</b> (בשתי העונות יחד). עד אז יופיע "–".
      </p>
    </section>
  )
}
