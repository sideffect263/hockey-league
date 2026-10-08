import { useEffect, useMemo, useState } from "react"
import {
  Newspaper, Users, Repeat, Eye, Clock, RefreshCw, PlayCircle, FileText, Info,
  Lightbulb, ArrowDownWideNarrow, Rss, Trophy, Monitor, Smartphone,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/lib/ThemeContext"
import { seriesColors, singleColor } from "@/lib/chartPalette"
import ChartCard, { SegToggle } from "@/components/charts/ChartCard"
import LineChart from "@/components/charts/LineChart"
import BarChart from "@/components/charts/BarChart"
import StatTile from "@/components/charts/StatTile"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * ניתוח פיד — is the feed used, how deep do people scroll, and which content holds them.
 *
 * Admin-only, AGGREGATES only: analytics_feed() (supabase/feed-analytics.sql) never returns
 * a per-user row — feed_impressions stays private per feed-personalization.sql.
 *
 * Two coverages, and the tab says which number comes from which:
 *   reach  = app_events page views of '/' — every visitor, web + iOS + Android, guests too.
 *   depth  = feed_impressions — signed-in WEB viewers only (native doesn't log cards yet).
 */

const WINDOWS = [
  { id: 7, label: "7 ימים" },
  { id: 14, label: "14 יום" },
  { id: 30, label: "30 יום" },
  { id: 90, label: "90 יום" },
]

const PLATFORM = {
  web: { label: "אתר", icon: Monitor },
  ios: { label: "iPhone", icon: Smartphone },
  android: { label: "Android", icon: Smartphone },
}

const TYPE = {
  news_video: { label: "סרטונים (חדשות עולם)", icon: PlayCircle },
  news_article: { label: "כתבות (חדשות עולם)", icon: FileText },
  post: { label: "פוסטים של משתמשים", icon: Users },
  game: { label: "תוצאות משחקים", icon: Trophy },
  goal: { label: "אבני דרך / שערים", icon: Trophy },
}

const secs = (ms) => ms == null ? "—" : `${(Number(ms) / 1000).toFixed(Number(ms) < 10000 ? 1 : 0)} שנ׳`
const pct = (a, b) => b ? Math.round((100 * a) / b) : 0
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }) : "—"

export default function FeedAnalyticsAdmin() {
  const { dark } = useTheme()
  const [days, setDays] = useState(14)
  const [reload, setReload] = useState(0)
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    supabase.rpc("analytics_feed", { p_days: days }).then(({ data, error }) => {
      if (alive) setState({ loading: false, data, error })
    })
    return () => { alive = false }
  }, [days, reload])

  const d = state.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-brand" /> ניתוח פיד
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            כמה אנשים נכנסים לפיד, כמה עמוק הם גוללים, ואיזה תוכן מחזיק אותם. נתונים מצטברים בלבד.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegToggle label="חלון זמן" value={days} onChange={setDays} options={WINDOWS} />
          <button onClick={() => setReload(r => r + 1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="רענון">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {state.loading && !d ? <SkeletonPanelRows count={6} />
        : state.error ? (
          <div className="card p-4 text-sm text-red-600 dark:text-red-400">
            שגיאה בטעינת הנתונים: {String(state.error?.message || "").includes("not_authorized") ? "הלשונית זמינה למנהלים בלבד" : state.error?.message}
          </div>
        ) : d ? <Body d={d} dark={dark} /> : null}
    </div>
  )
}

function Body({ d, dark }) {
  const r = d.reach || {}
  const dp = d.depth || {}
  const palette = seriesColors(dark)
  const types = d.by_type || []
  const video = types.find(t => t.item_type === "news_video")
  const article = types.find(t => t.item_type === "news_article")

  const insights = useMemo(() => buildInsights(d), [d])

  const daily = d.daily || []
  const dayMs = (x) => new Date(`${x}T12:00:00`).getTime()
  const series = [
    { id: "visitors", name: "סה״כ", color: palette[0], key: "visitors" },
    { id: "web", name: "אתר", color: palette[1], key: "web" },
    { id: "ios", name: "iPhone", color: palette[2], key: "ios" },
    { id: "android", name: "Android", color: palette[4], key: "android" },
  ].map(s => ({
    ...s,
    total: daily.length ? daily[daily.length - 1][s.key] || 0 : 0,
    points: daily.map(x => ({ x: dayMs(x.day), y: x[s.key] || 0 })),
  }))
  const step = Math.max(1, Math.ceil(daily.length / 6))
  const xTicks = daily.filter((_, i) => i % step === 0).map(x => ({ x: dayMs(x.day), label: fmtDate(x.day) }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Users className="w-5 h-5" />} accent="brand" value={r.feed_visitors ?? 0}
          label="נכנסו לפיד" sub={`${pct(r.feed_visitors, r.site_visitors)}% מכל המבקרים (${r.site_visitors ?? 0})`}
          spark={daily.map(x => x.visitors)} sparkColor={singleColor(dark)} />
        <StatTile icon={<Repeat className="w-5 h-5" />} value={r.returning ?? 0}
          label="חזרו לפיד ביותר מיום אחד" sub={`${pct(r.returning, r.feed_visitors)}% מבאי הפיד`} />
        <StatTile icon={<Eye className="w-5 h-5" />} value={r.feed_page_views ?? 0}
          label="כניסות לפיד" sub={`${r.feed_signed_in ?? 0} מחוברים · ${r.feed_guests ?? 0} אורחים`} />
        <StatTile icon={<Clock className="w-5 h-5" />} value={secs(dp.median_dwell_ms)}
          label="זמן חציוני על כרטיס" sub={`${dp.card_views ?? 0} צפיות בכרטיסים · ${dp.opens ?? 0} לחיצות`} />
      </div>

      {insights.length > 0 && (
        <div className="card p-4 border-r-4 border-brand">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-amber-500" /> מה הנתונים אומרים
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 list-disc pr-5">
            {insights.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      <ChartCard
        title="מבקרים בפיד ביום"
        subtitle="מבקרים שונים שפתחו את הפיד (דף הבית), לפי פלטפורמה — כולל אורחים"
        icon={<Users className="w-4 h-4 text-brand" />}
        legend={<Legend items={series} />}
        table={{ head: ["יום", "סה״כ", "אתר", "iPhone", "Android"], rows: daily.map(x => [fmtDate(x.day), x.visitors, x.web, x.ios, x.android]) }}
      >
        <LineChart series={series} xTicks={xTicks} vbH={200} />
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-3">
            <Smartphone className="w-4 h-4 text-brand" /> לפי פלטפורמה
          </h3>
          <Table
            head={["פלטפורמה", "מבקרים", "מחוברים", "כניסות", "כניסות למבקר"]}
            rows={(r.by_platform || []).map(p => [
              PLATFORM[p.platform]?.label || p.platform, p.visitors, p.signed_in, p.views,
              (p.views / Math.max(1, p.visitors)).toFixed(1),
            ])}
          />
        </div>

        <ChartCard
          title="עומק גלילה"
          subtitle="כמה כרטיסים שונים כל צופה ראה בתקופה"
          icon={<ArrowDownWideNarrow className="w-4 h-4 text-brand" />}
          footnote="מבוסס על צופים מחוברים באתר בלבד."
          table={{ head: ["כרטיסים", "צופים"], rows: (dp.scroll || []).map(s => [s.bucket, s.viewers]) }}
        >
          <BarChart data={(dp.scroll || []).map(s => ({ label: s.bucket, value: s.viewers }))} unit="צופים" color={singleColor(dark)} />
        </ChartCard>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-1">
          <PlayCircle className="w-4 h-4 text-brand" /> איזה סוג תוכן עובד
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
          "התעכבו" = צופה שהכרטיס היה מולו 5 שניות או יותר. זמן = חציון לכרטיס.
        </p>
        {video && article && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Compare icon={PlayCircle} label="סרטון" t={video} />
            <Compare icon={FileText} label="כתבה" t={article} />
          </div>
        )}
        <Table
          head={["סוג", "פריטים", "צופים לפריט", "זמן", "התעכבו", "לחיצות", "לייקים", "תגובות"]}
          rows={types.map(t => [
            TYPE[t.item_type]?.label || t.item_type, t.items, t.avg_viewers, secs(t.median_dwell_ms),
            `${pct(t.engaged, t.viewers)}%`, t.opens, t.likes, t.comments,
          ])}
        />
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-1">
          <Rss className="w-4 h-4 text-brand" /> לפי מקור
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
          "פורסמו" = פריטים שנכנסו לפיד בתקופה. מקור עם הרבה פרסומים ומעט צופים לפריט — מציף את הפיד.
        </p>
        <Table
          head={["מקור", "פורסמו", "נצפו", "צופים לפריט", "זמן", "התעכבו", "לחיצות", "לייקים"]}
          rows={(d.sources || []).map(s => [
            <span key="n" className="inline-flex items-center gap-1">{s.has_video && <PlayCircle className="w-3.5 h-3.5 text-red-500 shrink-0" aria-label="סרטונים" />}{s.source_name}</span>,
            s.published, s.seen_items, s.avg_viewers ?? "—", secs(s.median_dwell_ms),
            `${pct(s.engaged, s.viewers)}%`, s.opens, s.likes,
          ])}
        />
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-brand" /> הפריטים הנצפים ביותר
        </h3>
        <ol className="space-y-2">
          {(d.top_items || []).map((it, i) => (
            <li key={it.item_key} className="flex items-start gap-3 text-sm">
              <span className="w-5 shrink-0 text-slate-400 tabular-nums">{i + 1}</span>
              {it.is_video ? <PlayCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" /> : <FileText className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-white line-clamp-2">{it.title || it.item_key}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {it.source_name || TYPE[it.item_type]?.label || it.item_type} · {fmtDate(it.published_at)} · {it.viewers} צופים · {secs(it.median_dwell_ms)} · {it.opens} לחיצות{it.likes ? ` · ${it.likes} ❤` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>
          כניסות ומבקרים נספרים בכל הפלטפורמות, כולל אורחים. נתוני עומק (כרטיסים, זמן, לחיצות) נאספים כרגע רק ממשתמשים
          מחוברים באתר — {dp.tracked_viewers ?? 0} צופים — כי האפליקציות עדיין לא מדווחות על כרטיסים. התמונה האמיתית רחבה יותר.
        </p>
      </div>
    </div>
  )
}

function Compare({ icon: Icon, label, t }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">{secs(t.median_dwell_ms)}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">זמן חציוני · {pct(t.engaged, t.viewers)}% התעכבו · {t.items} פריטים</p>
    </div>
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

function Table({ head, rows }) {
  if (!rows.length) return <p className="text-xs text-slate-400">אין נתונים בתקופה</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap">
        <thead><tr className="text-slate-500 text-right">{head.map(h => <th key={h} className="py-1 pl-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              {row.map((c, j) => <td key={j} className={`py-1.5 pl-3 ${j ? "tabular-nums" : "font-medium text-slate-800 dark:text-slate-200"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Plain-language takeaways, computed from the same numbers the tables show. */
function buildInsights(d) {
  const out = []
  const r = d.reach || {}
  const dp = d.depth || {}
  const types = d.by_type || []
  const video = types.find(t => t.item_type === "news_video")
  const article = types.find(t => t.item_type === "news_article")

  if (r.site_visitors) {
    out.push(`הפיד הוא דף הבית: ${pct(r.feed_visitors, r.site_visitors)}% מהמבקרים באתר ובאפליקציות עברו בו (${r.feed_visitors} מתוך ${r.site_visitors}).`)
  }
  const plat = Object.fromEntries((r.by_platform || []).map(p => [p.platform, p.views / Math.max(1, p.visitors)]))
  if (plat.ios && plat.web && plat.ios >= 1.5 * plat.web) {
    out.push(`משתמשי iPhone חוזרים לפיד הרבה יותר: ${plat.ios.toFixed(1)} כניסות למבקר, לעומת ${plat.web.toFixed(1)} באתר.`)
  }
  if (r.feed_visitors && r.feed_guests) {
    out.push(`${pct(r.feed_guests, r.feed_visitors)}% מבאי הפיד הם אורחים לא מחוברים — הם לא יכולים לעשות לייק או להגיב.`)
  }
  if (video && article && article.median_dwell_ms) {
    const x = Number(video.median_dwell_ms) / Number(article.median_dwell_ms)
    if (x >= 1.3) out.push(`סרטונים מחזיקים פי ${x.toFixed(1)} יותר זמן מכתבות, אבל הם רק ${video.items} מתוך ${video.items + article.items} פריטים.`)
  }
  const scroll = dp.scroll || []
  const shallow = scroll.find(s => s.ord === 1)?.viewers || 0
  const totalScroll = scroll.reduce((a, s) => a + s.viewers, 0)
  if (totalScroll && shallow / totalScroll >= 0.25) {
    out.push(`${pct(shallow, totalScroll)}% מהצופים ראו 3 כרטיסים או פחות — מה שבראש הפיד הוא כל מה שהם רואים.`)
  }
  const flood = (d.sources || []).filter(s => s.published >= 10 && s.avg_viewers != null)
    .sort((a, b) => a.avg_viewers - b.avg_viewers)[0]
  if (flood) out.push(`${flood.source_name} פרסם ${flood.published} פריטים בתקופה, עם ${flood.avg_viewers} צופים בממוצע לפריט.`)
  if (dp.card_views && (dp.likes + dp.comments) / dp.card_views < 0.01) {
    out.push(`מעט מאוד תגובות: ${dp.likes} לייקים ו־${dp.comments} תגובות על ${dp.card_views} צפיות בכרטיסים.`)
  }
  return out
}
