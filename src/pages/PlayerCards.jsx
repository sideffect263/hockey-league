import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useSeo } from "@/lib/seo"
import { getTeams } from "@/lib/api"
import { PlayerStatCard, loadLeague, cardFor } from "@/components/fl/cards/PlayerStatCard"
import { WEIGHTS } from "@/components/fl/cards/playerRating"
import { entityPath } from "@/lib/slugs"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import { Search } from "lucide-react"

/**
 * שחקנים — /players (was /cards; dev 2026-11-11 it replaced the old list page, Players.jsx).
 * An EA FC-style card for every player on a current senior team (referees who play included),
 * best OVR first; search, team and position filters, sort by rating or name — the old list's
 * search/filters kept. Same card and numbers as the game-preview hero.
 */
export default function PlayerCards() {
  useSeo({ title: "שחקנים", description: "כרטיס לכל שחקן בליגה: דירוג, השפעה, ניסיון, התקפה, הגנה והערצה", path: "/players" })
  const [data, setData] = useState(null)
  const [teams, setTeams] = useState([])
  const [team, setTeam] = useState("all")
  const [search, setSearch] = useState("")
  const [position, setPosition] = useState("all")
  const [sortBy, setSortBy] = useState("ovr")
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
      // the senior league's directory, like the old list: youth teams are browsed from /teams
      .filter(p => ageOf(teamById[p.team_id]) === DEFAULT_AGE)
      .map(p => ({ p, card: cardFor(p.id, data) }))
      .sort((a, b) => (b.card.ovr ?? 0) - (a.card.ovr ?? 0) || `${a.p.first_name}`.localeCompare(`${b.p.first_name}`, "he"))
  }, [data, teamById])
  const q = search.trim()
  const shown = rows
    .filter(r => team === "all" || r.p.team_id === team)
    .filter(r => position === "all" || (position === "gk") === !!r.card.goalie)
    .filter(r => !q || `${r.p.first_name} ${r.p.last_name}`.includes(q))
  if (sortBy === "name") shown.sort((a, b) => `${a.p.first_name} ${a.p.last_name}`.localeCompare(`${b.p.first_name} ${b.p.last_name}`, "he"))

  const pill = on => `shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-colors ${on ? "bg-fl-accent text-[#11161D] border-transparent" : "border-line bg-surface text-fg-strong hover:brightness-95"}`

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-5">
      <h1 className="text-[26px] font-black">שחקנים</h1>
      <p className="mt-1 text-[13px] opacity-70 leading-relaxed">
        {data && <><span className="tabular-nums">{rows.length}</span> שחקנים בליגה · </>}כרטיס לכל שחקן, מנתוני משחקי הליגה. <a href="#how" className="underline underline-offset-2">איך מחושב כל ערך</a>
      </p>
      <div className="mt-3 flex gap-2">
        <label className="relative flex-1 min-w-0 flex items-center gap-2 min-h-[44px] rounded-2xl bg-surface border border-line px-3.5">
          <Search className="w-4 h-4 text-fg-muted shrink-0" aria-hidden="true" />
          <span className="sr-only">חיפוש שחקן</span>
          <input type="search" placeholder="חיפוש שחקן…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[16px] text-fg-strong placeholder:text-fg-muted" />
        </label>
        <select aria-label="מיון השחקנים" value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="shrink-0 min-h-[44px] rounded-2xl bg-surface border border-line text-fg-strong px-3 text-[13.5px] font-bold">
          <option value="ovr">מיון: דירוג</option>
          <option value="name">מיון: שם</option>
        </select>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <button type="button" className={pill(team === "all")} onClick={() => setTeam("all")}>כל הליגה</button>
        {teams.filter(t => rows.some(r => r.p.team_id === t.id)).map(t => (
          <button key={t.id} type="button" className={pill(team === t.id)} onClick={() => setTeam(t.id)}>{t.name}</button>
        ))}
      </div>
      <div className="mt-2 flex gap-2" role="group" aria-label="סינון לפי עמדה">
        {[["all", "כל העמדות"], ["field", "שחקני שדה"], ["gk", "שוערים"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={position === k} className={pill(position === k)} onClick={() => setPosition(k)}>{l}</button>
        ))}
      </div>
      {err && <p className="mt-6 text-center opacity-70">לא הצלחנו לטעון את הכרטיסים</p>}
      {!data && !err && <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[430px] rounded-2xl bg-white/5 animate-pulse" />)}</div>}
      {data && (
        // auto-rows-fr: every row as tall as the tallest card, so all cards are the same height
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 auto-rows-fr gap-2 sm:gap-3">
          {shown.map(({ p, card }) => (
            <Link key={p.id} to={entityPath("players", p)} className="block h-full min-w-0 rounded-2xl focus-visible:outline-2">
              <PlayerStatCard who={{ name: `${p.first_name} ${p.last_name}`.trim(), number: p.jersey_number, core: p.is_core, totals: { goals: p.goals, games: p.games_played, blue: p.blue_cards, red: p.red_cards } }} team={teamById[p.team_id]} card={card} />
            </Link>
          ))}
        </div>
      )}
      {data && shown.length === 0 && <p className="mt-10 text-center opacity-70">אין שחקנים תואמים</p>}
      {data && <HowItsCalculated minGames={rows.find(r => r.card.minGames)?.card.minGames} fansPct={Math.round(WEIGHTS.fans * 100)} />}
    </div>
  )
}

const pct = w => Math.round(w * 100)

/** The explanation at the bottom: how every number on the card is made (playerRating.js). */
function HowItsCalculated({ minGames, fansPct }) {
  const items = [
    ["השפעה", "אצל שחקן שדה: כמה שערים הבקיע בממוצע למשחק, בשלוש העונות, לפי טופסי השיפוט. ממוצע ולא סך הכול, כדי ששחקן שעוד לא שיחק הרבה העונה לא ייענש. נספר רק אחרי מינימום המשחקים."],
    ["השפעה (שוערים)", "אצל שוער: ממוצע השערים שהקבוצה שלו ספגה בכל משחק העונה, במשחקים שבהם הוא רשום בטופס. כאן פחות זה טוב יותר: השוער שספג הכי מעט למשחק מקבל את הציון הגבוה. שוער שעוד לא שיחק העונה יקבל \"–\", ובדירוג זה נחשב 0. נספר רק אחרי מינימום המשחקים, שכולל גם את שתי העונות הקודמות."],
    ["ניסיון", "בכמה משחקים השחקן רשום בטופס השיפוט, בעונה הזו ובשתי העונות הקודמות (2024-25 ו-2025-26)."],
    ["התקפה", "חצי הקבוצה שלו, חצי הוא עצמו. חצי ראשון: כמה שערים הקבוצה שלו הבקיעה במשחקים שבהם שיחק, לעומת מה שהיריבה באותו משחק סופגת בדרך כלל. חצי שני: כמה הקבוצה הבקיעה איתו לעומת משחקים שלה בלעדיו. ככה שחקן טוב בקבוצה חלשה לא נענש על הקבוצה, ושחקן בקבוצה חזקה לא מקבל ציון רק בזכותה."],
    ["הגנה", "אותו דבר, בשערים שהקבוצה ספגה: חצי כמה הקבוצה שלו ספגה לעומת מה שהיריבה מבקיעה בדרך כלל, וחצי כמה פחות (או יותר) הקבוצה ספגה איתו לעומת בלעדיו. פחות ספיגות = ציון גבוה יותר."],
    ["הערצה", "כמה אנשים עוקבים אחרי השחקן באפליקציה. שחקני הקבוצה שלו לא נספרים."],
  ]
  return (
    <section id="how" className="mt-10 scroll-mt-20 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 text-[14px] leading-relaxed">
      <h2 className="text-[20px] font-black">איך מחושב כל ערך</h2>
      <p className="mt-1 opacity-75">
        כל מספר בכרטיס הוא ציון בין 30 ל-92, וגבוה יותר = טוב יותר. הוא בנוי מנתון אמיתי ממשחקי הליגה שהסתיימו, בעונה הזו ובשתי העונות הקודמות (2024-25 ו-2025-26), ומטופסי השיפוט שלהם. משחקי ידידות וטורנירים לא נספרים.
        הנה הנתון שמאחורי כל ציון:
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white/[0.04] p-3">
            <dt className="font-black">{k}</dt>
            <dd className="mt-0.5 opacity-80">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-6 text-[16px] font-black">איך הנתון הופך לציון</h3>
      <p className="mt-1 opacity-80">
        כל שחקן מושווה למוביל באותה עמדה (שחקני שדה מול שחקני שדה, שוערים מול שוערים). אין 99: המוביל מקבל 92, מי שאין לו כלום מקבל 30, וכל השאר באמצע לפי החלק היחסי שלהם.
        לדוגמה: אם המוביל מבקיע 2 שערים למשחק ושחקן מבקיע 0.2, הציון שלו בהשפעה יהיה 36.
        בהתקפה ובהגנה המוביל מקבל 92 והחלש ביותר 30.
        בהערצה הציון המלא שמור למי שיש לו לפחות 10 עוקבים, כדי שעוקב אחד לא ייראה כמו הרבה (עוקב אחד = 36).
        בגרף, כל נקודה רחוקה מהמרכז לפי החלק היחסי: המוביל בקצה, מי שאין לו כלום במרכז.
      </p>
      <h3 className="mt-6 text-[16px] font-black">הדירוג (OVR)</h3>
      <p className="mt-1 opacity-80">
        ממוצע משוקלל של חמשת הציונים, בסולם 40 עד 92: מי שמוביל בכל דבר יקבל 92. המשקלים: השפעה {pct(WEIGHTS.goals)}%, התקפה {pct(WEIGHTS.att)}%, הגנה {pct(WEIGHTS.def)}%, ניסיון {pct(WEIGHTS.exp)}%, הערצה {fansPct}%. הערצה שווה הכי מעט, כי היא מודדת פופולריות ולא משחק: גם 10 עוקבים מוסיפים לכל היותר {Math.round(52 * fansPct / 100)} נקודות.
      </p>
      <h3 className="mt-6 text-[16px] font-black">החיצים ▲▼</h3>
      <p className="mt-1 opacity-80">
        ליד הדירוג וליד כל ציון מופיע כמה הוא עלה (▲ ירוק) או ירד (▼ אדום) במשחק האחרון של השחקן. משווים את הכרטיס שלו היום לכרטיס שהיה לו רגע לפני המשחק הזה.
        כל ציון נמדד מול המוביל, אז אם אותו משחק שינה גם את המספרים של המוביל, זה יכול להזיז את הציון. אם לא היה שינוי, אין חץ.
      </p>
      <h3 className="mt-6 text-[16px] font-black">מינימום משחקים</h3>
      <p className="mt-1 opacity-80">
        כדי שמשחק אחד מוצלח לא יקבע דירוג, התקפה, הגנה, השפעה והדירוג מוצגים רק לשחקן ששיחק לפחות <b>{minGames} משחקים</b>, וגם משחקים משתי העונות הקודמות (2024-25 ו-2025-26) נספרים. עד אז יופיע "–".
      </p>
    </section>
  )
}
