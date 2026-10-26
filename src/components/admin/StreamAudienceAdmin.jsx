import { useEffect, useMemo, useState } from "react"
import { Radio, Users, Clock, Eye, Repeat, RefreshCw, Info, Lightbulb } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/lib/ThemeContext"
import { seriesColors } from "@/lib/chartPalette"
import { IL_TZ } from "@/lib/ilTime"
import ChartCard from "@/components/charts/ChartCard"
import LineChart from "@/components/charts/LineChart"
import StatTile from "@/components/charts/StatTile"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * צפייה בשידורים — how many watched a game day's live streams, and for how long.
 *
 * Admin-only. The numbers come from the stream-audience edge function:
 *   minutes / watching-at-once = Cloudflare Stream analytics (per video, per minute),
 *   people = app page views of a game page during each broadcast (an upper bound).
 */

const ilDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: IL_TZ }).format(new Date(d))
const hhmm = (iso) => iso ? new Intl.DateTimeFormat("he-IL", { timeZone: IL_TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—"
const fmtDay = (day) => new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "numeric" }).format(new Date(`${day}T12:00:00`))
const hours = (m) => m >= 120 ? `${Math.round(m / 6) / 10} שעות` : `${m} דק׳`

export default function StreamAudienceAdmin() {
  const { dark } = useTheme()
  const [days, setDays] = useState(null)
  const [day, setDay] = useState(null)
  const [state, setState] = useState({ loading: false, data: null, error: null })
  const [reload, setReload] = useState(0)

  // Game days that had a Cloudflare stream, newest first.
  useEffect(() => {
    supabase.from("game_videos").select("created_at").eq("provider", "cloudflare")
      .order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => {
        const list = [...new Set((data || []).map(r => ilDay(r.created_at)))]
        setDays(list)
        setDay(d => d || list[0] || null)
      })
  }, [])

  useEffect(() => {
    if (!day) return
    let alive = true
    setState(s => ({ ...s, loading: true, error: null }))
    supabase.functions.invoke("stream-audience", { body: { day } }).then(({ data, error }) => {
      if (!alive) return
      if (error || data?.error) setState({ loading: false, data: null, error: data?.error || error?.message || "שגיאה" })
      else setState({ loading: false, data, error: null })
    })
    return () => { alive = false }
  }, [day, reload])

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Radio className="w-5 h-5 text-brand" /> צפייה בשידורים
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">כמה צפו בשידורים החיים של יום משחקים, ולכמה זמן</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input py-1.5 text-sm" value={day || ""} onChange={e => setDay(e.target.value)} disabled={!days?.length}>
            {(days || []).map(d => <option key={d} value={d}>{fmtDay(d)} · {d.split("-").reverse().join(".")}</option>)}
          </select>
          <button className="btn-secondary p-2" onClick={() => setReload(r => r + 1)} aria-label="רענון" title="רענון">
            <RefreshCw className={`w-4 h-4 ${state.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {days && !days.length ? (
        <p className="card p-6 text-sm text-slate-500">עוד לא היו שידורים.</p>
      ) : state.loading || !state.data && !state.error ? (
        <div className="card p-4"><SkeletonPanelRows rows={6} /></div>
      ) : state.error ? (
        <p className="card p-4 text-sm text-red-600 dark:text-red-400">שגיאה בטעינת הנתונים: {String(state.error)}</p>
      ) : !state.data.games.length ? (
        <p className="card p-6 text-sm text-slate-500">אין שידורים ביום הזה.</p>
      ) : (
        <Body d={state.data} dark={dark} />
      )}
    </div>
  )
}

function Body({ d, dark }) {
  const palette = seriesColors(dark)
  const games = d.games.map((g, i) => ({ ...g, name: `${g.home} – ${g.away}`, color: palette[i % palette.length] }))
  const t = d.totals
  const insights = useMemo(() => buildInsights(games, t), [games, t])

  // One line per game, on a shared clock axis (minutes since the day's first broadcast).
  const series = games.map(g => ({
    id: g.gameId, name: g.name, color: g.color, total: g.peak1,
    points: g.series.map(p => ({ x: p.t, y: p.v })),
  }))
  const allT = games.flatMap(g => g.series.map(p => p.t))
  const t0 = Math.min(...allT), t1 = Math.max(...allT)
  const xTicks = []
  for (let x = Math.ceil(t0 / 1800000) * 1800000; x <= t1; x += 1800000) xTicks.push({ x, label: hhmm(new Date(x).toISOString()) })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Clock className="w-5 h-5" />} accent="brand" value={hours(t.liveMinutes + t.replayMinutes)}
          label="סה״כ זמן צפייה" sub={`${t.liveMinutes} דק׳ בשידור חי · ${t.replayMinutes} דק׳ בהקלטה`} />
        <StatTile icon={<Users className="w-5 h-5" />} value={t.people}
          label="פתחו דף משחק בזמן השידורים" sub="גבול עליון — ראו הערה למטה" />
        <StatTile icon={<Eye className="w-5 h-5" />} value={Math.round(t.peak5)}
          label="שיא צופים בו־זמנית" sub="ממוצע 5 דקות, המשחק הצפוי ביותר" />
        <StatTile icon={<Repeat className="w-5 h-5" />} value={`${pct(t.replayMinutes, t.liveMinutes + t.replayMinutes)}%`}
          label="מהצפייה הייתה בהקלטה" sub="אחרי שהשידור החי נגמר" />
      </div>

      {insights.length > 0 && (
        <div className="card p-4 border-r-4 border-brand">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-amber-500" /> מה בולט
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc pr-5">
            {insights.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      <ChartCard
        title="צופים בו־זמנית לאורך היום"
        subtitle="כמה צפו בכל דקה של השידור החי, לפי משחק"
        icon={<Eye className="w-4 h-4 text-brand" />}
        legend={<Legend items={series} />}
        table={{ head: ["משחק", "שעה", "צופים"], rows: games.flatMap(g => g.series.filter(p => p.v > 0).map(p => [g.name, hhmm(new Date(p.t).toISOString()), p.v])) }}
      >
        <LineChart series={series} xTicks={xTicks} vbH={200} endLabels={false} />
      </ChartCard>

      <div className="card p-4 overflow-x-auto">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-3">לפי משחק</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-slate-500 dark:text-slate-400 text-right">
              <th className="py-1.5 pl-3 font-medium"></th>
              {games.map(g => (
                <th key={g.gameId} className="py-1.5 px-2 font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
                  <span className="inline-block w-2.5 h-2.5 rounded-full ml-1.5 align-middle" style={{ background: g.color }} />{g.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            <Row label="שעת השידור" games={games} cell={g => <span dir="ltr">{hhmm(g.parts[0].start)}</span>} />
            <Row label="אורך השידור" games={games} cell={g => { const real = g.parts.filter(p => p.minutes >= 5).length; return `${g.liveSpanMin} דק׳${real > 1 ? ` (${real} חלקים)` : ""}` }} />
            <Row label="דקות צפייה בשידור חי" games={games} cell={g => g.liveMinutes} best={g => g.liveMinutes} />
            <Row label="צופים בממוצע בו־זמנית" games={games} cell={g => g.avgConcurrent} best={g => g.avgConcurrent} />
            <Row label="שיא בו־זמנית (ממוצע 5 דק׳)" games={games} cell={g => <>{g.peak5} <span className="text-[11px] text-slate-400" dir="ltr">({hhmm(g.peak5At)})</span></>} best={g => g.peak5} />
            <Row label="הדקה הכי צפויה" games={games} cell={g => g.peak1} best={g => g.peak1} />
            <Row label="פתחו דף משחק בזמן השידור" games={games} cell={g => <>{g.people} <span className="text-[11px] text-slate-400">({g.signedIn} מחוברים)</span></>} best={g => g.people} />
            <Row label="אתר · iPhone · Android" games={games} cell={g => <span>{g.byPlatform.web} · {g.byPlatform.ios} · {g.byPlatform.android}</span>} />
            <Row label="זמן צפייה משוער לאדם" games={games} cell={g => g.people ? `~${Math.round(g.liveMinutes / g.people)} דק׳` : "—"} best={g => g.people ? g.liveMinutes / g.people : 0} />
            <Row label="דקות צפייה בהקלטה" games={games} cell={g => g.replayMinutes} best={g => g.replayMinutes} />
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-1">
        <p className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300"><Info className="w-4 h-4" /> איך לקרוא את המספרים</p>
        <p><b>צופים בו־זמנית</b> — דקות הצפייה בכל דקה לפי Cloudflare. Cloudflare מעגל כל דקה כלפי מטה, אז המספר האמיתי מעט גבוה יותר.</p>
        <p><b>פתחו דף משחק</b> — גבול עליון: האפליקציה לא רושמת איזה משחק נפתח או אם הסרטון הופעל, וטלפון לא מחובר שנפתח פעמיים נספר פעמיים.</p>
        <p><b>זמן צפייה לאדם</b> — חלוקה גסה של דקות הצפייה במספר האנשים; אין עדיין מדידה של צפייה לכל אדם.</p>
      </div>
    </div>
  )
}

function Row({ label, games, cell, best }) {
  const top = best ? Math.max(...games.map(best)) : null
  return (
    <tr>
      <td className="py-2 pl-3 text-[12px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{label}</td>
      {games.map(g => (
        <td key={g.gameId} className={`py-2 px-2 tabular-nums ${best && games.length > 1 && best(g) === top && top > 0 ? "font-bold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"}`}>
          {cell(g)}
        </td>
      ))}
    </tr>
  )
}

function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
      {items.map(it => (
        <span key={it.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="w-3.5 h-1 rounded-full shrink-0" style={{ background: it.color }} aria-hidden="true" />
          {it.name}
        </span>
      ))}
    </div>
  )
}

function pct(a, b) { return b ? Math.round((a / b) * 100) : 0 }

function buildInsights(games, t) {
  const out = []
  if (games.length > 1) {
    const perPerson = games.filter(g => g.people).map(g => ({ g, m: g.liveMinutes / g.people }))
    const stay = perPerson.sort((a, b) => b.m - a.m)[0]
    if (stay) out.push(`הצופים נשארו הכי הרבה ב${stay.g.name} — כ־${Math.round(stay.m)} דקות לאדם.`)
    const crowd = [...games].sort((a, b) => b.people - a.people)[0]
    if (crowd && crowd !== stay?.g) out.push(`הכי הרבה אנשים פתחו את ${crowd.name} (${crowd.people}), אבל נשארו פחות זמן.`)
    // A false start of a minute or two is not a broken broadcast.
    const split = games.filter(g => g.parts.filter(p => p.minutes >= 5).length > 1)
    if (split.length) out.push(`${split.map(g => g.name).join(", ")} שודר בכמה חלקים — שידור שנקטע מאבד צופים.`)
  }
  const replayPct = pct(t.replayMinutes, t.liveMinutes + t.replayMinutes)
  if (replayPct >= 25) out.push(`${replayPct}% מזמן הצפייה היה בהקלטה, אחרי השידור — ההקלטות שוות קידום.`)
  return out
}
