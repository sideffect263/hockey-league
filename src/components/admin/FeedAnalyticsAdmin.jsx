import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Newspaper, Repeat, Eye, RefreshCw, PlayCircle, Lightbulb, ArrowDownWideNarrow, Rss, Monitor, Smartphone, ExternalLink } from "lucide-react"
import { Squad as Users, DocumentIcon as FileText, InfoIcon as Info, Clock, Trophy } from "@/components/icons/BrandIcons"
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
 *   depth  = feed_impressions — signed-in viewers (web + apps); guests aren't tracked.
 * Admins and club device accounts are left out of both.
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
const fmtDateY = (iso) => new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "2-digit" })
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
          footnote="מבוסס על צופים מחוברים בלבד."
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

      <TopItems items={d.top_items || []} days={d.days} />

      <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <p>
          כניסות ומבקרים נספרים בכל הפלטפורמות, כולל אורחים. נתוני עומק (כרטיסים, זמן, לחיצות) נאספים רק ממשתמשים
          מחוברים — {dp.tracked_viewers ?? 0} צופים — כי אורחים לא נמדדים. מנהלים ומכשירי מועדון ({dp.staff_excluded ?? 0} חשבונות) לא נספרים בשום מספר בלשונית.
        </p>
      </div>
    </div>
  )
}

/** Finer kind from analytics_feed().top_items.kind → label + where the row opens. */
const KIND = {
  game: { label: "תוצאת משחק", icon: Trophy },
  goal: { label: "שער / אבן דרך", icon: Trophy },
  live_update: { label: "עדכון ממשחק", icon: Trophy },
  news: { label: "חדשות", icon: FileText },
  birthday: { label: "יום הולדת", icon: Users },
  preview: { label: "תצוגה מקדימה", icon: Newspaper },
  post: { label: "פוסט", icon: Users },
  market: { label: "ניחושים", icon: Trophy },
  other: { label: "כרטיס מערכת", icon: Rss },
}

const SORTS = [
  { id: "viewers", label: "צופים" },
  { id: "avg_dwell_ms", label: "זמן" },
  { id: "opens", label: "לחיצות" },
  { id: "ctr", label: "CTR" },
  { id: "likes", label: "לייקים" },
]

const CTR_MIN_VIEWS = 10
const ctrOf = (it) => it.views ? (100 * it.opens) / it.views : 0
const isOwnSite = (url) => /^https?:\/\/(www\.)?rinkhockeyil\.com/i.test(url || "")

/** Where tapping the row goes: in-app path (`to`) and, for outside news, the source (`href`). */
function itemLinks(it) {
  const game = it.game_id ? `/games/${it.game_id}` : null
  const post = it.post_id ? `/posts/${it.post_id}` : null
  const source = it.link_url && !isOwnSite(it.link_url) ? it.link_url : null
  if (it.kind === "game" || it.kind === "goal") return { to: game }
  if (post) return { to: post, game: it.kind === "live_update" ? game : null, source }
  if (it.kind === "market") return { to: "/market" }
  if (it.item_key === "top-scorer") return { to: "/statistics" }
  return { to: "/" }
}

function itemTitle(it) {
  const k = it.kind
  if ((k === "game" || k === "goal" || k === "live_update") && it.home_team) {
    const played = it.home_score != null && it.away_score != null
    const match = (
      <>
        {it.home_team}{" "}
        {played ? <span dir="ltr" className="tabular-nums">{it.away_score}–{it.home_score}</span> : "נגד"}{" "}
        {it.away_team}
      </>
    )
    if (k === "game") return match
    return <>{match}<span className="text-slate-500 dark:text-slate-400 font-normal"> · {it.title || (k === "goal" ? "שער" : "")}</span></>
  }
  if (it.item_key === "top-scorer") return "מלכי השערים"
  if (it.item_key === "world" || it.item_key === "row-world") return "חדשות מהעולם (שורה מקובצת)"
  if (k === "market") return `ניחושים · ${it.item_key.replace(/^market-/, "")}`
  return it.title || it.item_key
}

function TopItems({ items, days }) {
  const [sort, setSort] = useState("viewers")
  const [kind, setKind] = useState("all")
  const [limit, setLimit] = useState(15)

  const kinds = useMemo(() => {
    const n = {}
    for (const it of items) n[it.kind] = (n[it.kind] || 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1])
  }, [items])

  const rows = useMemo(() => {
    // A card shown once and tapped once is "100%": CTR only ranks cards with enough showings.
    const val = (it) => sort === "ctr" ? (it.views >= CTR_MIN_VIEWS ? ctrOf(it) : -1) : Number(it[sort]) || 0
    return items
      .filter(it => kind === "all" || it.kind === kind)
      .sort((a, b) => val(b) - val(a) || b.viewers - a.viewers)
  }, [items, sort, kind])

  const shown = rows.slice(0, limit)

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
          <Trophy className="w-4 h-4 text-brand" /> הפריטים הנצפים ביותר
        </h3>
        <SegToggle label="מיון" value={sort} onChange={setSort} options={SORTS} />
      </div>
      <details className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
        <summary className="cursor-pointer select-none">
          {days} הימים האחרונים (חלון הזמן למעלה) · {items.length} הפריטים עם הכי הרבה צופים · בלי מנהלים ומכשירי מועדון · <span className="text-brand">איך נספר?</span>
        </summary>
        <p className="mt-1">
          <b>צופים</b> = משתמשים מחוברים שונים שהכרטיס היה לפחות חצי מסך מולם בתקופה.
          {" "}<b>זמן</b> = ממוצע לצופה (סך כל הפעמים שלו על הכרטיס); החציון מופיע במעבר עכבר.
          {" "}<b>לחיצות</b> = כניסות מהכרטיס (קישור, עמוד משחק, סרטון); <b>CTR</b> = לחיצות מתוך הופעות הכרטיס על המסך (מיון לפי CTR — רק פריטים עם {CTR_MIN_VIEWS} הופעות ומעלה בראש).
          {" "}<b>לייקים</b> = שניתנו בתקופה. זמן ולחיצות הם סך הכול של הצופה על הפריט, גם אם התחיל לפני התקופה.
        </p>
      </details>

      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="סינון לפי סוג">
        {[["all", items.length], ...kinds].map(([k, n]) => (
          <button key={k} type="button" onClick={() => { setKind(k); setLimit(15) }} aria-pressed={kind === k}
            className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${kind === k
              ? "bg-brand text-white border-brand font-semibold"
              : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand"}`}>
            {k === "all" ? "הכל" : KIND[k]?.label || k} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {!shown.length ? <p className="text-xs text-slate-400">אין נתונים בתקופה</p> : (
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((it, i) => <TopItemRow key={it.item_key} it={it} rank={i + 1} />)}
        </ol>
      )}

      {rows.length > limit && (
        <button type="button" onClick={() => setLimit(l => l + 25)}
          className="mt-3 w-full min-h-[40px] rounded-lg text-[13px] font-semibold text-brand bg-surface-sunken hover:opacity-80">
          הצג עוד ({rows.length - limit} נוספים)
        </button>
      )}
    </div>
  )
}

function TopItemRow({ it, rank }) {
  const k = KIND[it.kind] || KIND.other
  const Icon = it.is_video ? PlayCircle : k.icon
  const links = itemLinks(it)
  const when = it.game_date || it.published_at
  const label = it.kind === "news" && it.is_video ? "חדשות · סרטון" : k.label
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className="w-6 shrink-0 text-slate-400 tabular-nums text-sm pt-0.5">{rank}</span>
      <Icon className={`w-4 h-4 mt-1 shrink-0 ${it.is_video ? "text-red-500" : "text-slate-400"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          {links.to ? (
            <Link to={links.to} target="_blank" rel="noopener" className="font-medium text-sm text-slate-900 dark:text-white line-clamp-2 hover:text-brand hover:underline underline-offset-2">
              {itemTitle(it)}
            </Link>
          ) : <p className="font-medium text-sm text-slate-900 dark:text-white line-clamp-2">{itemTitle(it)}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="px-1.5 py-0.5 rounded bg-surface-sunken text-fg font-medium">{label}</span>
            {when && <span dir="ltr">{fmtDateY(when)}</span>}
            {it.source_name && it.kind === "news" && <span>{it.source_name}</span>}
            {links.game && <Link to={links.game} target="_blank" rel="noopener" className="text-brand hover:underline">עמוד המשחק</Link>}
            {links.source && (
              <a href={links.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                למקור <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <dl className="mt-2 md:mt-0 grid grid-cols-5 gap-1 w-full max-w-[340px] md:w-[340px] shrink-0">
          <Metric label="צופים" value={it.viewers} />
          <Metric label="זמן" value={secs(it.avg_dwell_ms)} title={`חציון ${secs(it.median_dwell_ms)}`} />
          <Metric label="לחיצות" value={it.opens} />
          <Metric label="CTR" value={`${ctrOf(it).toFixed(ctrOf(it) < 10 ? 1 : 0)}%`} title={`${it.opens} לחיצות מתוך ${it.views} הופעות`} />
          <Metric label="לייקים" value={it.likes || 0} />
        </dl>
      </div>
    </li>
  )
}

function Metric({ label, value, title }) {
  return (
    <div className="rounded-md bg-surface-sunken px-1 py-1 text-center" title={title}>
      <dt className="text-[10px] text-fg-muted">{label}</dt>
      <dd className="text-[12px] sm:text-[13px] font-semibold text-fg-strong tabular-nums whitespace-nowrap">{value}</dd>
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
