import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, BarChart3, Crosshair, Flame, PlayCircle, Users, Activity, Info, FlaskConical } from "lucide-react"
import { useSeo } from "@/lib/seo"
import { useSlugId, entityPath } from "@/lib/slugs"
import { getTeams } from "@/lib/api"
import TeamLogo from "@/components/TeamLogo"

/**
 * "מרכז המשחק" — FIFA-style end-of-match stats computed from the game video by the
 * match engine (video-analysis/game_events.py). PREVIEW: the data is a static JSON
 * exported by video-analysis/match_stats_export.py into public/match-stats/<game_id>.json.
 * Every number carries a reliability chip from the engine's measured accuracy against
 * human review, so nothing shaky is presented as fact.
 */

const RELIABILITY = {
  good: { label: "אמין", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  fair: { label: "בערך", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  exp: { label: "ניסיוני", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  official: { label: "רשמי", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
}
const f1 = (a) => (a && a.precision != null && a.recall != null && a.precision + a.recall > 0)
  ? (2 * a.precision * a.recall) / (a.precision + a.recall) : null
function grade(acc) {
  const f = f1(acc)
  if (f == null) return "exp"
  return f >= 0.7 ? "good" : f >= 0.55 ? "fair" : "exp"
}

const OUTCOME = {
  goal: { label: "גול", r: 0.75 },
  saved: { label: "נעצר בשוער", r: 0.5 },
  blocked: { label: "נחסם", r: 0.45 },
  wide: { label: "החוצה", r: 0.45 },
}
const EVENT_LABEL = { pass: "מסירה", shot: "בעיטה", pass_lost: "מסירה שאבדה", interception: "יירוט", steal: "חטיפה" }

const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

function useMatchData(gameId) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    if (!gameId) { setState({ data: null, error: null, loading: false }); return }
    let off = false
    fetch(`/match-stats/${gameId}.json`)
      .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
      .then((data) => !off && setState({ data, error: null, loading: false }))
      .catch((error) => !off && setState({ data: null, error, loading: false }))
    return () => { off = true }
  }, [gameId])
  return state
}

export default function MatchStats() {
  const { id: param } = useParams()
  const { id: gameId, loading: idLoading } = useSlugId("games", param)
  const { data, loading } = useMatchData(gameId)
  const [videoT, setVideoT] = useState(null)
  const videoRef = useRef(null)

  useSeo({ title: "מרכז המשחק · סטטיסטיקות מהווידאו", noindex: true })

  const seek = (t) => {
    setVideoT(Math.max(0, Math.round(t - 4)))
    videoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (idLoading || loading) {
    return <div className="max-w-5xl mx-auto px-4 py-10 text-center text-fg-muted">טוען…</div>
  }
  if (!data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-3">
        <BarChart3 className="w-10 h-10 mx-auto text-slate-400" />
        <p className="font-bold">אין עדיין סטטיסטיקות מהווידאו למשחק הזה</p>
        <p className="text-sm text-fg-muted">הסטטיסטיקות נבנות ממשחקים שצולמו במצלמה רחבה מלמעלה.</p>
        {param && <Link to={`/games/${param}`} className="text-brand text-sm font-semibold">חזרה לעמוד המשחק</Link>}
      </div>
    )
  }

  const { teams, team_stats: ts, accuracy, coverage } = data
  const home = Object.keys(teams).find((k) => teams[k].side === "home")
  const away = Object.keys(teams).find((k) => teams[k].side === "away")

  return (
    <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
      <Link to={`/games/${param}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-brand">
        <ArrowRight className="w-4 h-4" /> לעמוד המשחק
      </Link>

      <Scoreboard data={data} home={home} away={away} />
      <PreviewNote coverage={coverage} engine={data.engine} />

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamCompare ts={ts} teams={teams} home={home} away={away} accuracy={accuracy} coverage={coverage} />
        <div className="space-y-4">
          <div ref={videoRef}>
            <VideoCard youtubeId={data.youtube_id} t={videoT} />
          </div>
          <Momentum possession={data.possession} teams={teams} home={home} away={away} />
        </div>
      </div>

      <ShotMap data={data} home={home} away={away} onSeek={seek} />
      <Players data={data} home={home} away={away} />
      <HeatMap data={data} home={home} away={away} />
      <Timeline data={data} onSeek={seek} />
      <Accuracy accuracy={accuracy} coverage={coverage} />
    </div>
  )
}

// ---------------------------------------------------------------------------

function Card({ title, icon: Icon, subtitle, right, children, className = "" }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
            {Icon && <Icon className="w-4 h-4 text-brand" />} {title}
          </h2>
          {subtitle && <p className="text-[11px] text-fg-muted mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Chip({ grade: g }) {
  const r = RELIABILITY[g] || RELIABILITY.exp
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${r.cls}`}>{r.label}</span>
}

function Seg({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap rounded-lg bg-slate-100 dark:bg-slate-700/50 p-0.5 gap-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
            value === o.key ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400"}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Scoreboard({ data, home, away }) {
  const { teams, team_stats: ts } = data
  const [rows, setRows] = useState([])
  useEffect(() => { getTeams().then(setRows).catch(() => {}) }, [])
  const side = (k) => (
    <Link to={entityPath("teams", teams[k].slug)} className="flex flex-col items-center gap-2 min-w-0">
      <span className="rounded-full p-1" style={{ boxShadow: `0 0 0 3px ${teams[k].color}` }}>
        <TeamLogo team={rows.find((t) => t.name === teams[k].name) || { name: teams[k].name }} size={14} />
      </span>
      <span className="font-bold text-sm sm:text-base text-center truncate max-w-full">{teams[k].name}</span>
    </Link>
  )
  return (
    <section className="card p-5 overflow-hidden relative">
      <div className="absolute inset-x-0 top-0 h-1 flex">
        <div className="flex-1" style={{ background: teams[home].color }} />
        <div className="flex-1" style={{ background: teams[away].color }} />
      </div>
      <p className="text-center text-[11px] font-semibold text-fg-muted mb-3">
        מרכז המשחק · {data.venue} · {data.date.split("-").reverse().join(".")}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {side(home)}
        <div dir="ltr" className="text-4xl sm:text-5xl font-black tabular-nums tracking-tight">
          {ts[away].goals_scoreboard}<span className="text-fg-muted mx-2">–</span>{ts[home].goals_scoreboard}
        </div>
        {side(away)}
      </div>
    </section>
  )
}

function PreviewNote({ coverage, engine }) {
  return (
    <div className="flex gap-2.5 items-start rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50 p-3 text-xs text-amber-900 dark:text-amber-200">
      <FlaskConical className="w-4 h-4 shrink-0 mt-0.5" />
      <p>
        <b>תצוגה מקדימה.</b> כל המספרים כאן חושבו אוטומטית מהווידאו של המשחק (מנוע {engine}), לא נרשמו ביד.
        המצלמה ראתה {coverage.live_minutes} דקות משחק חי והכדור זוהה ב־<Pct n={coverage.ball_seen_pct} /> מהזמן.
        ליד כל נתון מופיע כמה הוא אמין, לפי בדיקה מול סימון ידני.
      </p>
    </div>
  )
}

function TeamCompare({ ts, teams, home, away, accuracy, coverage }) {
  const H = ts[home], A = ts[away]
  const pct = (p, l) => (p + l ? Math.round((100 * p) / (p + l)) : 0)
  const rows = [
    { label: "שערים", h: H.goals_scoreboard, a: A.goals_scoreboard, g: "official" },
    { label: "אחזקת כדור", h: H.possession_pct, a: A.possession_pct, unit: "%", g: coverage.controlled_pct >= 70 ? "good" : "fair" },
    { label: "בעיטות", h: H.shots, a: A.shots, g: grade(accuracy.shot) },
    { label: "בעיטות למסגרת", h: H.shots_on_target, a: A.shots_on_target, g: grade(accuracy.shot) },
    { label: "הצלות שוער", h: H.gk_saves, a: A.gk_saves, g: grade(accuracy.save) },
    { label: "מסירות", h: H.passes, a: A.passes, g: grade(accuracy.pass) },
    { label: "דיוק מסירות", h: pct(H.passes, H.passes_lost), a: pct(A.passes, A.passes_lost), unit: "%", g: grade(accuracy.pass_lost) },
    { label: "יירוטים", h: H.interceptions, a: A.interceptions, g: grade(accuracy.interception) },
    { label: "חטיפות", h: H.steals, a: A.steals, g: grade(accuracy.steal) },
    { label: "זמן בשליש ההתקפה", h: H.att_third_pct, a: A.att_third_pct, unit: "%", g: "fair" },
  ]
  return (
    <Card title="השוואת קבוצות" icon={BarChart3}>
      <div className="flex justify-between text-[11px] font-bold mb-2">
        <span style={{ color: teams[home].color }}>{teams[home].name}</span>
        <span style={{ color: teams[away].color }}>{teams[away].name}</span>
      </div>
      <div className="space-y-3">
        {rows.map((r) => {
          const tot = (r.h || 0) + (r.a || 0)
          const hp = tot ? (100 * r.h) / tot : 50
          const lead = r.h === r.a ? null : r.h > r.a ? "h" : "a"
          return (
            <div key={r.label}>
              <div className="flex items-center justify-between text-sm">
                <span className={`tabular-nums w-14 ${lead === "h" ? "font-black" : "text-fg-muted"}`}>{fmtNum(r.h)}{r.unit || ""}</span>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {r.label} <Chip grade={r.g} />
                </span>
                <span className={`tabular-nums w-14 text-left ${lead === "a" ? "font-black" : "text-fg-muted"}`}>{fmtNum(r.a)}{r.unit || ""}</span>
              </div>
              {/* the bar is laid out in the page's RTL flow so home sits on the right, under its name */}
              <div className="flex h-1.5 mt-1 rounded-full overflow-hidden gap-0.5">
                <div style={{ width: `${hp}%`, background: teams[home].color, opacity: lead === "a" ? 0.45 : 1 }} />
                <div style={{ width: `${100 - hp}%`, background: teams[away].color, opacity: lead === "h" ? 0.45 : 1 }} />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
// A percentage inside a Hebrew sentence: isolate it LTR or "92%" renders as "%92".
const Pct = ({ n }) => <span dir="ltr" className="inline-block">{Math.round(n)}%</span>
const fmtNum = (n) => (n == null ? "–" : Number.isInteger(n) ? n : n.toFixed(1))

function VideoCard({ youtubeId, t }) {
  const src = `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0${t != null ? `&start=${t}&autoplay=1` : ""}`
  return (
    <Card title="הווידאו" icon={PlayCircle} subtitle="לחיצה על בעיטה או אירוע קופצת לרגע הזה בווידאו">
      <div className="aspect-video rounded-xl overflow-hidden bg-black">
        <iframe key={src} src={src} title="וידאו המשחק" className="w-full h-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
      </div>
    </Card>
  )
}

function Momentum({ possession, teams, home, away }) {
  const W = 480, H = 140, mid = H / 2, gap = 14
  const halves = [1, 2].map((h) => possession.filter((p) => p.half === h))
  const n = possession.length
  const bw = (W - gap) / n
  let x = 0
  const bars = []
  halves.forEach((rows, hi) => {
    rows.forEach((p) => {
      const hv = p[`${home}_pct`], av = p[`${away}_pct`]
      const d = (hv - av) / 100 // -1..1, + = home on top
      const hgt = Math.abs(d) * (mid - 6)
      bars.push(
        <rect key={`${hi}-${p.minute_from}`} x={x + 1} width={bw - 2} y={d >= 0 ? mid - hgt : mid} height={Math.max(1, hgt)} rx={2}
          fill={d >= 0 ? teams[home].color : teams[away].color}>
          <title>{`מחצית ${p.half}, דקות ${p.minute_from}–${p.minute_from + 3}: ${teams[home].name} ${hv}% · ${teams[away].name} ${av}%`}</title>
        </rect>,
      )
      x += bw
    })
    if (hi === 0) x += gap
  })
  return (
    <Card title="מומנטום — מי שלט בכדור" icon={Activity} subtitle="אחזקה בכל 3 דקות; למעלה = יתרון לבית, למטה = יתרון לאורחים">
      <svg dir="ltr" viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label="מומנטום אחזקה לאורך המשחק">
        <line x1={0} x2={W} y1={mid} y2={mid} className="stroke-slate-300 dark:stroke-slate-600" />
        {bars}
        <text x={(W - gap) / 4} y={H + 12} textAnchor="middle" className="fill-slate-500 text-[10px]">מחצית 1</text>
        <text x={(W - gap) * 0.75 + gap} y={H + 12} textAnchor="middle" className="fill-slate-500 text-[10px]">מחצית 2</text>
      </svg>
    </Card>
  )
}

// --- rink ------------------------------------------------------------------

function Rink({ rink, children, pad = 0.8 }) {
  const L = rink.length_m, Wd = rink.width_m, g = rink.goal_line_m, bw = rink.box_width_m / 2, bd = rink.box_depth_m
  const line = "stroke-slate-300 dark:stroke-slate-600"
  return (
    <svg dir="ltr" viewBox={`${-L / 2 - pad} ${-Wd / 2 - pad} ${L + 2 * pad} ${Wd + 2 * pad}`} className="w-full" role="img">
      <rect x={-L / 2} y={-Wd / 2} width={L} height={Wd} rx={1.2} className={`fill-slate-50 dark:fill-slate-800/60 ${line}`} strokeWidth={0.12} />
      <line x1={0} x2={0} y1={-Wd / 2} y2={Wd / 2} className={line} strokeWidth={0.08} />
      <circle cx={0} cy={0} r={rink.circle_r_m} fill="none" className={line} strokeWidth={0.08} />
      {[-1, 1].map((s) => {
        const gl = s * (L / 2 - g), fr = s * (L / 2 - g - bd), gw = rink.goal_width_m / 2
        return (
          <g key={s}>
            <path d={`M${gl},${-bw} L${fr},${-bw} L${fr},${bw} L${gl},${bw}`} fill="none" className={line} strokeWidth={0.08} />
            <line x1={gl} x2={gl} y1={-Wd / 2} y2={Wd / 2} className={line} strokeWidth={0.06} strokeDasharray="0.3 0.3" />
            <rect x={s > 0 ? gl : gl - 0.6} y={-gw} width={0.6} height={2 * gw} className="fill-orange-400/70" />
          </g>
        )
      })}
      {children}
    </svg>
  )
}

function ShotMap({ data, home, away, onSeek }) {
  const [team, setTeam] = useState("all")
  const [out, setOut] = useState("all")
  const { teams, rink } = data
  const shots = data.shots.filter((s) => (team === "all" || s.team === team) && (out === "all" || s.outcome === out))
  const count = (k) => data.shots.filter((s) => (team === "all" || s.team === team) && s.outcome === k).length
  return (
    <Card title="מפת בעיטות" icon={Crosshair}
      subtitle={`${teams[home].name} תוקפת ימינה, ${teams[away].name} תוקפת שמאלה · לחיצה על בעיטה פותחת אותה בווידאו`}
      right={<Chip grade={grade(data.accuracy.shot)} />}>
      <div className="flex flex-wrap gap-2 mb-3">
        <Seg value={team} onChange={setTeam} options={[{ key: "all", label: "שתי הקבוצות" }, { key: home, label: teams[home].name }, { key: away, label: teams[away].name }]} />
        <Seg value={out} onChange={setOut} options={[{ key: "all", label: `הכל (${data.shots.filter((s) => team === "all" || s.team === team).length})` },
          ...Object.keys(OUTCOME).map((k) => ({ key: k, label: `${OUTCOME[k].label} (${count(k)})` }))]} />
      </div>
      <Rink rink={rink}>
        {shots.map((s, i) => {
          const c = teams[s.team].color, o = OUTCOME[s.outcome] || OUTCOME.wide, y = -s.y
          const common = { onClick: () => s.t != null && onSeek(s.t), style: { cursor: "pointer" } }
          const tip = <title>{`${teams[s.team].name} · ${o.label} · מחצית ${s.half} ${s.clock} · ${s.dist_m} מ׳ מהשער`}</title>
          if (s.outcome === "goal") {
            return <g key={i} {...common}><circle cx={s.x} cy={y} r={o.r} fill={c} stroke="#facc15" strokeWidth={0.22} />{tip}</g>
          }
          if (s.outcome === "wide") {
            const r = 0.32
            return <g key={i} {...common} stroke={c} strokeWidth={0.14} strokeLinecap="round">
              <line x1={s.x - r} y1={y - r} x2={s.x + r} y2={y + r} /><line x1={s.x - r} y1={y + r} x2={s.x + r} y2={y - r} />
              <circle cx={s.x} cy={y} r={0.5} fill="transparent" stroke="none" />{tip}</g>
          }
          return <g key={i} {...common}><circle cx={s.x} cy={y} r={o.r} fill={s.outcome === "saved" ? c : "transparent"} fillOpacity={0.85}
            stroke={c} strokeWidth={0.14} />{tip}</g>
        })}
      </Rink>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-fg-muted">
        <span>● מלא = נעצר בשוער</span><span>○ חלול = נחסם</span><span>✕ = החוצה</span><span>● עם מסגרת זהב = גול</span>
      </div>
    </Card>
  )
}

// --- players ---------------------------------------------------------------

const pName = (p) => p.name || (p.gk ? "שוער" : `#${p.number}`)

function Players({ data, home, away }) {
  const [sort, setSort] = useState("distance_m")
  const { teams } = data
  const cols = [
    { key: "on_camera_min", label: "דק׳ בפריים" },
    { key: "distance_m", label: "מרחק (מ׳)" },
    { key: "top_speed_kmh", label: "מהירות שיא" },
    { key: "touches", label: "נגיעות" },
    { key: "passes", label: "מסירות" },
    { key: "acc", label: "דיוק" },
    { key: "shots", label: "בעיטות" },
    { key: "won_ball", label: "זכיות בכדור" },
  ]
  const rows = data.players.map((p) => ({ ...p, acc: p.passes + p.passes_lost ? Math.round((100 * p.passes) / (p.passes + p.passes_lost)) : null }))
  const ordered = [...rows].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1))
  return (
    <Card title="שחקנים" icon={Users} subtitle="נמדד רק בזמן שהשחקן בתוך הפריים — לכן הדקות קצרות מהמשחק. זיהוי השחקן לפי מספר החולצה."
      right={<Chip grade="fair" />}>
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="text-fg-muted border-b border-line">
              <th className="text-right font-semibold py-2 px-2">שחקן</th>
              {cols.map((c) => (
                <th key={c.key} className="font-semibold py-2 px-1.5 text-center">
                  <button type="button" onClick={() => setSort(c.key)} className={sort === c.key ? "text-brand font-bold" : "hover:text-brand"}>
                    {c.label}{sort === c.key ? " ▾" : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((p) => (
              <tr key={p.key} className="border-b border-line/60 last:border-0">
                <td className="py-2 px-2">
                  <span className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full text-[10px] font-black text-white flex items-center justify-center shrink-0"
                      style={{ background: teams[p.team].color }}>{p.gk ? "GK" : p.number}</span>
                    {p.slug
                      ? <Link to={entityPath("players", p.slug)} className="font-semibold hover:text-brand truncate">{pName(p)}</Link>
                      : <span className="font-semibold text-fg-muted">{pName(p)}</span>}
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`text-center tabular-nums py-2 px-1.5 ${sort === c.key ? "font-bold" : ""}`}>
                    {p[c.key] == null ? "–" : c.key === "acc" ? `${p[c.key]}%` : fmtNum(p[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function HeatMap({ data, home, away }) {
  const { teams, rink, heat, players } = data
  const [who, setWho] = useState(home)
  const cells = useMemo(() => {
    if (heat[who]) return heat[who]
    const team = who
    const acc = new Map()
    players.filter((p) => p.team === team && !p.gk).forEach((p) => (heat[p.key] || []).forEach(([x, y, s]) => {
      const k = `${x},${y}`; acc.set(k, (acc.get(k) || 0) + s)
    }))
    return [...acc].map(([k, s]) => [...k.split(",").map(Number), s])
  }, [who, heat, players])
  // Normalise to the 97th percentile so one camping spot doesn't wash the rest out,
  // and drop the faintest cells — a team map otherwise paints the whole rink.
  const sorted = cells.map((c) => c[2]).sort((a, b) => a - b)
  const max = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.97)] || 1)
  const color = teams[who]?.color || teams[players.find((p) => p.key === who)?.team]?.color || "#888"
  const fieldPlayers = players.filter((p) => !p.gk && heat[p.key])
  return (
    <Card title="מפת חום" icon={Flame} subtitle={`איפה בילו על המגרש · ${teams[home].name} תוקפת ימינה`}>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[home, away].map((t) => (
          <button key={t} type="button" onClick={() => setWho(t)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${who === t ? "text-white" : "border-line"}`}
            style={who === t ? { background: teams[t].color, borderColor: teams[t].color } : {}}>
            כל {teams[t].name}
          </button>
        ))}
        {fieldPlayers.map((p) => (
          <button key={p.key} type="button" onClick={() => setWho(p.key)}
            className={`px-2 py-1 rounded-lg text-[11px] font-semibold border ${who === p.key ? "text-white" : "border-line text-fg-muted"}`}
            style={who === p.key ? { background: teams[p.team].color, borderColor: teams[p.team].color } : {}}>
            {pName(p)}
          </button>
        ))}
      </div>
      <Rink rink={rink}>
        <clipPath id="rink-clip"><rect x={-rink.length_m / 2} y={-rink.width_m / 2} width={rink.length_m} height={rink.width_m} rx={1.2} /></clipPath>
        <g clipPath="url(#rink-clip)">
          {cells.map(([x, y, s]) => {
            const v = Math.min(1, s / max)
            return v < 0.2 ? null : <rect key={`${x},${y}`} x={x} y={-(y + 1)} width={1} height={1} fill={color} fillOpacity={Math.pow(v, 1.6) * 0.95} />
          })}
        </g>
      </Rink>
    </Card>
  )
}

function Timeline({ data, onSeek }) {
  const [type, setType] = useState("shot")
  const { teams } = data
  const types = ["shot", "steal", "interception", "pass_lost"]
  const list = data.events.filter((e) => e.type === type)
  return (
    <Card title="אירועים לאורך המשחק" icon={PlayCircle} subtitle="לחיצה פותחת את הרגע בווידאו">
      <div className="mb-3">
        <Seg value={type} onChange={setType} options={types.map((k) => ({ key: k, label: `${EVENT_LABEL[k]} (${data.events.filter((e) => e.type === k).length})` }))} />
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
        {list.map((e, i) => (
          <button key={i} type="button" onClick={() => onSeek(e.t)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-line text-[11px] hover:border-brand">
            <span className="w-2 h-2 rounded-full" style={{ background: teams[e.team]?.color }} />
            <span className="tabular-nums">מח׳ {e.half} · {e.clock}</span>
            {e.outcome && <span className="text-fg-muted">{OUTCOME[e.outcome]?.label || e.outcome}</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}

function Accuracy({ accuracy, coverage }) {
  const rows = ["pass", "shot", "interception", "pass_lost", "steal"].filter((k) => accuracy[k])
  return (
    <Card title="כמה זה מדויק?" icon={Info} subtitle="המנוע נבדק מול סימון ידני של קטעים מהמשחק. דיוק = כמה מהאירועים שהמנוע מצא היו נכונים; כיסוי = כמה מהאירועים האמיתיים הוא מצא.">
      <div className="grid sm:grid-cols-2 gap-4">
        <table className="w-full text-xs">
          <thead><tr className="text-fg-muted border-b border-line">
            <th className="text-right py-1.5 font-semibold">אירוע</th><th className="py-1.5 font-semibold">דיוק</th><th className="py-1.5 font-semibold">כיסוי</th><th />
          </tr></thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k} className="border-b border-line/60 last:border-0">
                <td className="py-1.5">{EVENT_LABEL[k]}</td>
                <td className="text-center tabular-nums">{Math.round(accuracy[k].precision * 100)}%</td>
                <td className="text-center tabular-nums">{Math.round(accuracy[k].recall * 100)}%</td>
                <td className="text-left"><Chip grade={grade(accuracy[k])} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="text-xs space-y-1.5 text-slate-700 dark:text-slate-300">
          <li>המצלמה ראתה <b>{coverage.live_minutes}</b> דקות משחק חי.</li>
          <li>הכדור זוהה ב־<b><Pct n={coverage.ball_seen_pct} /></b> מהזמן, ושליטה של שחקן בכדור ב־<b><Pct n={coverage.controlled_pct} /></b>.</li>
          <li>ב־<b><Pct n={coverage.named_touch_pct} /></b> מהנגיעות בכדור ידענו איזה שחקן נגע.</li>
          <li>שערים — מהלוח הרשמי. גולים שהמנוע עצמו זיהה עדיין חלקיים כי המצלמה לא תמיד רואה את השער.</li>
        </ul>
      </div>
    </Card>
  )
}
