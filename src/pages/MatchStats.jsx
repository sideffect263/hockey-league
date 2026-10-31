import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, Crosshair, PlayCircle, Activity, FlaskConical, Check, X, RotateCcw, SkipForward, Plus, Loader2, HandHeart } from "lucide-react"
import { StatsIcon as BarChart3, Squad as Users, InfoIcon as Info, Help as HelpCircle, Flame } from "@/components/icons/BrandIcons"
import { useSeo } from "@/lib/seo"
import { useSlugId, entityPath } from "@/lib/slugs"
import { getTeams } from "@/lib/api"
import TeamLogo from "@/components/TeamLogo"
import { TeamBlend, FLScore } from "@/components/fl/Floodlight"
import { useAuth } from "@/lib/AuthContext"
import { loadYouTubeApi } from "@/lib/youtubeApi"
import { getMyVotes, getVoteCounts, saveVote, addMissed } from "@/lib/matchStats"

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
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const { player, ready, playClip } = useClipPlayer(data?.youtube_id, boxRef)

  useSeo({ title: "מרכז המשחק · סטטיסטיקות מהווידאו", noindex: true })

  const seek = (t, type) => {
    playClip(t, type)
    videoRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  if (idLoading || loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4" aria-busy="true" aria-label="טוען">
        <div className="h-48 rounded-[26px] bg-surface-sunken animate-none" />
        <div className="h-64 rounded-card bg-surface-sunken" />
      </div>
    )
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
      <Link to={`/games/${param}`} className="inline-flex items-center gap-1 min-h-11 text-[14px] font-semibold text-fg-strong hover:underline">
        <ArrowRight className="w-4 h-4" /> לעמוד המשחק
      </Link>

      <Scoreboard data={data} home={home} away={away} />
      <PreviewNote coverage={coverage} engine={data.engine} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 lg:order-2">
          <div ref={videoRef}>
            <VideoCard boxRef={boxRef} ready={ready} />
          </div>
          <CrowdReview data={data} gameId={gameId} player={player} ready={ready} playClip={playClip} />
        </div>
        <div className="space-y-4 lg:order-1">
          <TeamCompare ts={ts} teams={teams} home={home} away={away} accuracy={accuracy} coverage={coverage} />
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
    <section className={`fl-card p-4 sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[20px] sm:text-[22px] font-extrabold leading-tight text-fg-strong">
            {Icon && <Icon className="w-5 h-5" aria-hidden="true" />} {title}
          </h2>
          {subtitle && <p className="text-[12px] text-fg-muted mt-1">{subtitle}</p>}
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
    <div className="flex flex-wrap rounded-control bg-surface-sunken p-[3px] gap-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`min-h-11 px-3 text-[13px] rounded-[10px] transition-colors ${
            value === o.key ? "bg-surface text-fg-strong font-semibold shadow-sm" : "text-fg-muted font-medium"}`}>
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
  const team = (k) => rows.find((t) => t.name === teams[k].name) || { name: teams[k].name, primary_color: teams[k].color }
  const side = (k, role) => (
    <Link to={entityPath("teams", teams[k].slug)} className="flex flex-col items-center gap-2 min-w-0 rounded-2xl p-1 hover:bg-white/5">
      <TeamLogo team={team(k)} px={64} />
      <span className="font-extrabold text-[16px] sm:text-[20px] text-center leading-tight line-clamp-2 text-white">{teams[k].name}</span>
      <span className="text-[12px] text-white/75">{role}</span>
    </Link>
  )
  return (
    <TeamBlend as="section" home={team(home)} away={team(away)} className="rounded-[26px] px-4 pt-4 pb-5">
      <p className="text-center text-[12px] font-bold text-white/85 mb-3">
        מרכז המשחק · {data.venue} · <bdi dir="ltr">{data.date.split("-").reverse().join(".")}</bdi>
      </p>
      {/* Physical left → right: away, score, home. */}
      <div dir="ltr" className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <div dir="rtl" className="min-w-0 flex justify-center">{side(away, "חוץ")}</div>
        <FLScore home={ts[home].goals_scoreboard} away={ts[away].goals_scoreboard} size={56} />
        <div dir="rtl" className="min-w-0 flex justify-center">{side(home, "בית")}</div>
      </div>
    </TeamBlend>
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

function VideoCard({ boxRef, ready }) {
  return (
    <Card title="הווידאו" icon={PlayCircle} subtitle="לחיצה על בעיטה או אירוע מנגנת את הרגע הזה">
      <div className="aspect-video rounded-xl overflow-hidden bg-black relative [&_iframe]:w-full [&_iframe]:h-full">
        <div ref={boxRef} className="absolute inset-0" />
        {!ready && <Loader2 className="w-6 h-6 text-white/60 animate-spin absolute inset-0 m-auto" />}
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
          const common = { onClick: () => s.t != null && onSeek(s.t, "shot"), style: { cursor: "pointer" } }
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
          <button key={i} type="button" onClick={() => onSeek(e.t, e.type)}
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

// --- video player + crowd review --------------------------------------------

// Seconds before/after the engine's moment to play, per type (same windows as the lab review).
const CLIP = { pass: [2.5, 2], pass_lost: [2.5, 2.5], steal: [2.5, 2], interception: [3, 2], shot: [3, 3] }

/** A YouTube player the page controls: playClip(t, type) plays a few seconds around t, then pauses. */
function useClipPlayer(videoId, boxRef) {
  const player = useRef(null)
  const stopAt = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!videoId) return
    let dead = false
    loadYouTubeApi().then((YT) => {
      if (dead || !boxRef.current) return
      const el = document.createElement("div"); boxRef.current.appendChild(el)
      player.current = new YT.Player(el, {
        videoId, width: "100%", height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
        events: { onReady: () => !dead && setReady(true) },
      })
    })
    const iv = setInterval(() => {
      const p = player.current
      if (stopAt.current != null && p?.getCurrentTime && p.getCurrentTime() >= stopAt.current) { p.pauseVideo(); stopAt.current = null }
    }, 150)
    return () => { dead = true; clearInterval(iv); try { player.current?.destroy() } catch { /* already gone */ } }
  }, [videoId, boxRef])
  const playClip = useCallback((t, type) => {
    const p = player.current
    if (!p?.seekTo) return
    const [pre, post] = CLIP[type] || [3, 2.5]
    p.seekTo(Math.max(0, t - pre), true); p.playVideo(); stopAt.current = t + post
  }, [])
  return { player, ready, playClip }
}

const REVIEW_TYPES = ["shot", "steal", "interception", "pass_lost", "pass"]       // queue priority
const ACTUAL_TYPES = ["pass", "shot", "steal", "interception", "pass_lost", "goal", "nothing"]
const ACTUAL_LABEL = { ...EVENT_LABEL, goal: "גול", nothing: "לא היה כלום" }

// The claim as a sentence that names the team's role — a bare "team" on a turnover was read both ways in the lab.
function claim(e, teams) {
  const n = teams[e.team]?.name || ""
  switch (e.type) {
    case "shot": return `בעיטה של ${n}`
    case "pass": return `מסירה של ${n}`
    case "pass_lost": return `${n} איבדה את הכדור במסירה`
    case "steal": return `${n} חטפה את הכדור`
    case "interception": return `${n} יירטה מסירה`
    default: return `${EVENT_LABEL[e.type] || e.type} · ${n}`
  }
}

function CrowdReview({ data, gameId, player, ready, playClip }) {
  const { user, openAuth } = useAuth()
  const { teams, engine } = data
  const [mine, setMine] = useState(null)            // Map event_id -> my vote row
  const [counts, setCounts] = useState(new Map())
  const [cur, setCur] = useState(null)              // event being reviewed
  const [wrongMode, setWrongMode] = useState(false)
  const [missed, setMissed] = useState(null)        // { t } while adding a missed event
  const [pick, setPick] = useState({ type: null, team: null })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(0)

  useEffect(() => {
    if (!user || !gameId) return
    getMyVotes(gameId, engine).then((rows) => setMine(new Map(rows.filter((r) => r.event_id != null).map((r) => [r.event_id, r]))))
      .catch(() => setMine(new Map()))
    getVoteCounts(gameId, engine).then(setCounts).catch(() => {})
  }, [user, gameId, engine])

  // Least-checked events first, shots and turnovers before passes, never one I already answered.
  const queue = useMemo(() => {
    if (!mine) return []
    const n = (e) => { const c = counts.get(e.id); return c ? c.n_correct + c.n_wrong + c.n_unsure : 0 }
    return data.events
      .filter((e) => REVIEW_TYPES.includes(e.type) && !mine.has(e.id))
      .sort((a, b) => n(a) - n(b) || REVIEW_TYPES.indexOf(a.type) - REVIEW_TYPES.indexOf(b.type) || a.t - b.t)
  }, [data.events, mine, counts])

  const next = useCallback((skipId) => {
    const e = queue.find((q) => q.id !== skipId && q.id !== cur?.id) || null
    setCur(e); setWrongMode(false); setPick({ type: null, team: null }); setErr(null)
    if (e) playClip(e.t, e.type)
  }, [queue, cur, playClip])

  const answer = async (verdict, actual = {}) => {
    if (!cur || busy) return
    setBusy(true); setErr(null)
    try {
      const row = await saveVote({ existingId: mine.get(cur.id)?.id, gameId, engine, event: cur, verdict,
        actualType: actual.type ?? null, actualTeam: actual.team ?? null })
      const id = cur.id
      setMine((m) => new Map(m).set(id, row))
      setCounts((c) => {
        const o = c.get(id) || { event_id: id, n_correct: 0, n_wrong: 0, n_unsure: 0 }
        return new Map(c).set(id, { ...o, [`n_${verdict}`]: o[`n_${verdict}`] + 1 })
      })
      setDone((d) => d + 1)
      const nextE = queue.find((q) => q.id !== id) || null
      setCur(nextE); setWrongMode(false); setPick({ type: null, team: null })
      if (nextE) playClip(nextE.t, nextE.type)
    } catch (e) {
      setErr("השמירה נכשלה — נסו שוב")
    } finally { setBusy(false) }
  }

  const startMissed = () => {
    const p = player.current
    p?.pauseVideo?.()
    setMissed({ t: Math.round((p?.getCurrentTime?.() || 0) * 10) / 10 }); setPick({ type: null, team: null })
  }
  const saveMissed = async () => {
    if (!missed || !pick.type || !pick.team || busy) return
    setBusy(true); setErr(null)
    try {
      await addMissed({ gameId, engine, t: missed.t, type: pick.type, team: pick.team })
      setMissed(null); setDone((d) => d + 1)
    } catch { setErr("השמירה נכשלה — נסו שוב") } finally { setBusy(false) }
  }

  // Keyboard: V נכון · X לא נכון · U לא בטוח · R שוב · N דלג (Hebrew layout keys too)
  useEffect(() => {
    if (!cur) return
    const onKey = (ev) => {
      if (ev.target.closest?.("input, textarea, [contenteditable]") || ev.metaKey || ev.ctrlKey) return
      const k = ev.key.toLowerCase()
      if (wrongMode || missed) return
      if (k === "v" || k === "ה") answer("correct")
      else if (k === "x" || k === "ס") setWrongMode(true)
      else if (k === "u" || k === "ו") answer("unsure")
      else if (k === "r" || k === "ר") playClip(cur.t, cur.type)
      else if (k === "n" || k === "מ") next(cur.id)
      else return
      ev.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const total = data.events.filter((e) => REVIEW_TYPES.includes(e.type)).length
  const myCount = mine ? mine.size : 0

  const teamBtns = (val, set) => Object.keys(teams).map((k) => (
    <button key={k} type="button" onClick={() => set(k)}
      className={`px-3 py-2 rounded-xl text-sm font-bold border-2 transition-colors ${val === k ? "text-white" : "border-line"}`}
      style={val === k ? { background: teams[k].color, borderColor: teams[k].color } : { color: teams[k].color }}>
      {teams[k].name}
    </button>
  ))
  const typeBtns = (types, val, set) => types.map((k) => (
    <button key={k} type="button" onClick={() => set(k)}
      className={`px-3 py-2 rounded-xl text-sm font-semibold border ${val === k ? "bg-brand text-white border-brand" : "border-line hover:border-brand"}`}>
      {ACTUAL_LABEL[k]}
    </button>
  ))

  return (
    <Card title="עזרו לדייק את הסטטיסטיקה" icon={HandHeart}
      subtitle="צופים ברגע מהמשחק ואומרים אם המחשב צדק. כל תשובה משפרת את המנוע ואת המספרים בעמוד.">
      {!user ? (
        <div className="text-center py-3 space-y-2">
          <p className="text-sm text-fg-muted">כדי לעזור צריך להתחבר — זה לוקח כמה שניות.</p>
          <button type="button" onClick={openAuth} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold">התחברו ועזרו</button>
        </div>
      ) : !mine ? (
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-fg-muted" />
      ) : missed ? (
        <div className="space-y-3">
          <p className="text-sm font-bold">מה המחשב פספס ב־<span dir="ltr">{fmtT(missed.t)}</span> בסרטון?</p>
          <div className="flex flex-wrap gap-2">{typeBtns(ACTUAL_TYPES.filter((k) => k !== "nothing"), pick.type, (type) => setPick((p) => ({ ...p, type })))}</div>
          <div className="flex flex-wrap gap-2">{teamBtns(pick.team, (team) => setPick((p) => ({ ...p, team })))}</div>
          <div className="flex gap-2">
            <button type="button" disabled={!pick.type || !pick.team || busy} onClick={saveMissed}
              className="btn-primary px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">שמירה</button>
            <button type="button" onClick={() => setMissed(null)} className="px-4 py-2 rounded-xl text-sm border border-line">ביטול</button>
          </div>
        </div>
      ) : !cur ? (
        <div className="text-center py-2 space-y-3">
          {queue.length === 0 ? (
            <p className="text-sm font-semibold">בדקת את כל {total} האירועים — תודה ענקית! 🙏</p>
          ) : (
            <>
              <p className="text-sm text-fg-muted">
                {myCount > 0 ? <>כבר בדקת <b>{myCount}</b> אירועים. נשארו {queue.length}.</> : <>יש {total} אירועים לבדוק. כל אחד לוקח כמה שניות.</>}
              </p>
              <button type="button" disabled={!ready} onClick={() => next(null)}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40 inline-flex items-center gap-2">
                <PlayCircle className="w-4 h-4" /> {myCount > 0 ? "להמשיך לבדוק" : "להתחיל לבדוק"}
              </button>
            </>
          )}
          <button type="button" disabled={!ready} onClick={startMissed} className="block mx-auto text-xs text-fg-muted hover:text-brand">
            <Plus className="w-3 h-3 inline" /> המחשב פספס משהו ברגע שבסרטון עכשיו?
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-fg-muted">המחשב חושב שהיה כאן:</p>
              <p className="text-lg font-black flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: teams[cur.team]?.color }} />
                {claim(cur, teams)}
                {cur.outcome && <span className="text-sm font-semibold text-fg-muted">· {OUTCOME[cur.outcome]?.label || cur.outcome}</span>}
              </p>
              <p className="text-[11px] text-fg-muted">מחצית {cur.half} · <span dir="ltr">{cur.clock}</span></p>
            </div>
            <button type="button" onClick={() => playClip(cur.t, cur.type)} title="לנגן שוב (R)"
              className="shrink-0 p-2 rounded-xl border border-line hover:border-brand"><RotateCcw className="w-4 h-4" /></button>
          </div>

          {!wrongMode ? (
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} onClick={() => answer("correct")}
                className="py-3 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex flex-col items-center gap-0.5">
                <Check className="w-5 h-5" /> נכון <span className="text-[10px] font-normal opacity-80 hidden sm:block">V</span>
              </button>
              <button type="button" disabled={busy} onClick={() => setWrongMode(true)}
                className="py-3 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 flex flex-col items-center gap-0.5">
                <X className="w-5 h-5" /> לא נכון <span className="text-[10px] font-normal opacity-80 hidden sm:block">X</span>
              </button>
              <button type="button" disabled={busy} onClick={() => answer("unsure")}
                className="py-3 rounded-xl font-bold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 disabled:opacity-50 flex flex-col items-center gap-0.5">
                <HelpCircle className="w-5 h-5" /> לא בטוח <span className="text-[10px] font-normal opacity-70 hidden sm:block">U</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-red-300/60 dark:border-red-800/60 p-3">
              <p className="text-sm font-bold">אז מה באמת קרה?</p>
              <div className="flex flex-wrap gap-2">{typeBtns(ACTUAL_TYPES, pick.type, (type) => setPick((p) => ({ ...p, type })))}</div>
              {pick.type && pick.type !== "nothing" && (
                <div className="flex flex-wrap gap-2 items-center"><span className="text-xs text-fg-muted">של איזו קבוצה?</span>{teamBtns(pick.team, (team) => setPick((p) => ({ ...p, team })))}</div>
              )}
              <div className="flex gap-2">
                <button type="button" disabled={busy || !pick.type || (pick.type !== "nothing" && !pick.team)}
                  onClick={() => answer("wrong", pick)} className="btn-primary px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">שמירה</button>
                <button type="button" onClick={() => setWrongMode(false)} className="px-4 py-2 rounded-xl text-sm border border-line">חזרה</button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-fg-muted">
            <button type="button" onClick={() => next(cur.id)} className="inline-flex items-center gap-1 hover:text-brand">
              <SkipForward className="w-3.5 h-3.5" /> דלג (N)
            </button>
            <span>{done > 0 ? `בדקת ${done} עכשיו · ` : ""}{myCount} מתוך {total}</span>
            <button type="button" onClick={startMissed} className="inline-flex items-center gap-1 hover:text-brand">
              <Plus className="w-3.5 h-3.5" /> פספסו משהו?
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </Card>
  )
}
