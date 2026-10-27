import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Smartphone, Monitor, Eye, RefreshCw, Search, X, ArrowUpDown, Layers, Filter as FunnelIcon, Repeat } from "lucide-react"
import { Squad as Users, PersonFollowing as UserCheck, Warning as AlertTriangle, Bell, Clock } from "@/components/icons/BrandIcons"
import { supabase } from "@/lib/supabase"
import { useTheme } from "@/lib/ThemeContext"
import { seriesColors, singleColor } from "@/lib/chartPalette"
import ChartCard, { SegToggle } from "@/components/charts/ChartCard"
import LineChart from "@/components/charts/LineChart"
import BarChart from "@/components/charts/BarChart"
import RankBar from "@/components/charts/RankBar"
import StatTile from "@/components/charts/StatTile"
import { OgBadge } from "@/components/RoleBadges"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * ניתוח משתמשים — who uses the league's site and apps, what they use, and where they stop.
 *
 * Admin-only (every analytics_* RPC checks is_admin()). Unlike טלמטריה this is per NAMED
 * user by Ariel's decision (2026-09-28). Everything is assembled server-side from data the
 * league already has — supabase/user-analytics.sql — so it costs nothing to run.
 */

const WINDOWS = [
  { id: 7, label: "7 ימים" },
  { id: 30, label: "30 יום" },
  { id: 90, label: "90 יום" },
]

const PLATFORM = {
  web: { label: "אתר", icon: Monitor },
  ios: { label: "iPhone", icon: Smartphone },
  android: { label: "Android", icon: Smartphone },
}

const KIND = {
  screen: "צפייה במסך", like: "לייק", comment: "תגובה", post: "פוסט", bet: "תחזית",
  follow: "מעקב", message: "הודעה פרטית", availability: "אישור הגעה", medical: "בדיקה רפואית",
  claim: "בקשת שיוך", feed_view: "גלילה בפיד", action: "פעולה", error: "שגיאה",
}

const ROLE = {
  admin: "מנהל", league_manager: "מנהל ליגה", judge: "שופט", medic: "חובש",
  coach: "מאמן", content_editor: "עורך תוכן", player: "שחקן",
}

const DOW = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"]

function ago(iso) {
  if (!iso) return "—"
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return "עכשיו"
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק׳`
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע׳`
  const d = Math.floor(s / 86400)
  return d === 1 ? "אתמול" : `לפני ${d} ימים`
}

const fmtDateTime = (iso) => iso
  ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—"
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "2-digit" }) : "—"

function PlatformChips({ platforms = [] }) {
  if (!platforms?.length) return <span className="text-slate-400">—</span>
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {platforms.map(p => {
        const m = PLATFORM[p]; if (!m) return null
        const Icon = m.icon
        return (
          <span key={p} className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            <Icon className="w-3 h-3" /> {m.label}
          </span>
        )
      })}
    </span>
  )
}

const userName = (u) => u.player_name || u.display_name || u.email?.split("@")[0] || "ללא שם"

/* ------------------------------------------------------------------------ */

export default function UserAnalyticsAdmin() {
  const [view, setView] = useState("overview")
  const [days, setDays] = useState(30)
  const [reload, setReload] = useState(0)
  const [openUser, setOpenUser] = useState(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-brand" /> ניתוח משתמשים
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            מי משתמש, במה, מאיזה מכשיר — ואיפה אנשים נתקעים. גלוי למנהלים בלבד.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegToggle label="חלון זמן" value={days} onChange={setDays} options={WINDOWS} />
          <button onClick={() => setReload(r => r + 1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="רענון">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <SegToggle
        label="תצוגה"
        value={view}
        onChange={setView}
        options={[
          { id: "overview", label: "סקירה" },
          { id: "users", label: "משתמשים" },
          { id: "growth", label: "משפך ושימור" },
        ]}
      />

      {view === "overview" && <Overview days={days} reload={reload} />}
      {view === "users" && <UsersList days={days} reload={reload} onOpen={setOpenUser} />}
      {view === "growth" && <Growth reload={reload} />}

      {openUser && <UserDrawer user={openUser} days={days} onClose={() => setOpenUser(null)} />}
    </div>
  )
}

/* ------------------------------ Overview -------------------------------- */

function useRpc(fn, args, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    supabase.rpc(fn, args).then(({ data, error }) => {
      if (!alive) return
      setState({ loading: false, data, error })
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

function Overview({ days, reload }) {
  const { dark } = useTheme()
  const overview = useRpc("analytics_overview", { p_days: days }, [days, reload])
  const features = useRpc("analytics_features", { p_days: days }, [days, reload])
  const heat = useRpc("analytics_heatmap", { p_days: days }, [days, reload])
  const versions = useRpc("analytics_versions", {}, [reload])
  const errors = useRpc("analytics_errors", { p_days: Math.min(days, 30) }, [days, reload])

  if (overview.loading && !overview.data) return <SkeletonPanelRows count={6} />
  if (overview.error) return <ErrorNote error={overview.error} />

  const t = overview.data?.totals || {}
  const daily = overview.data?.daily || []
  const palette = seriesColors(dark)
  const dayMs = (d) => new Date(`${d}T12:00:00`).getTime()
  const series = [
    { id: "users", name: "סה״כ", color: palette[0], key: "users" },
    { id: "web", name: "אתר", color: palette[1], key: "web" },
    { id: "ios", name: "iPhone", color: palette[2], key: "ios" },
    { id: "android", name: "Android", color: palette[4], key: "android" },
  ].map(s => ({
    ...s,
    total: daily.length ? daily[daily.length - 1][s.key] : 0,
    points: daily.map(d => ({ x: dayMs(d.day), y: d[s.key] || 0 })),
  }))
  const step = Math.max(1, Math.ceil(daily.length / 6))
  const xTicks = daily.filter((_, i) => i % step === 0).map(d => ({
    x: dayMs(d.day), label: new Date(d.day).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" }),
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<UserCheck className="w-5 h-5" />} value={t.active_7d ?? 0} label="פעילים ב־7 ימים" accent="brand"
          spark={daily.slice(-14).map(d => d.users)} sparkColor={singleColor(dark)} />
        <StatTile icon={<Users className="w-5 h-5" />} value={t.active ?? 0} label={`פעילים ב־${days} ימים`} sub={`מתוך ${t.accounts ?? 0} חשבונות`} />
        <StatTile icon={<Smartphone className="w-5 h-5" />} value={t.app_users ?? 0} label="משתמשי אפליקציה" sub={`${t.linked_players ?? 0} משויכים לשחקן`} />
        <StatTile icon={<Eye className="w-5 h-5" />} value={t.guests ?? 0} label="ביקורי אורחים (לא מחוברים)" sub={`${t.new_accounts ?? 0} נרשמו בתקופה`} />
      </div>

      <ChartCard
        title="משתמשים פעילים ביום"
        subtitle="חשבון שנכנס או עשה משהו באותו יום, לפי פלטפורמה"
        icon={<Users className="w-4 h-4 text-brand" />}
        legend={<SimpleLegend items={series} />}
        footnote="אפליקציות שעדיין לא מדווחות על מסכים נספרות לפי כניסת החשבון (סשן), לא לפי מסכים."
        table={{ head: ["יום", "סה״כ", "אתר", "iPhone", "Android", "אורחים"], rows: daily.map(d => [fmtDate(d.day), d.users, d.web, d.ios, d.android, d.guests]) }}
      >
        <LineChart series={series} xTicks={xTicks} vbH={200} />
      </ChartCard>

      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard
          title="שימוש בפיצ׳רים"
          subtitle="כמה משתמשים שונים השתמשו בכל חלק באפליקציה"
          icon={<Layers className="w-4 h-4 text-brand" />}
          table={{ head: ["פיצ׳ר", "משתמשים", "אתר", "iPhone", "Android", "אירועים"],
            rows: (features.data || []).map(f => [f.feature, f.users, f.web, f.ios, f.android, f.events]) }}
        >
          <div dir="rtl">
            <RankBar data={(features.data || []).map(f => ({ id: f.feature, name: f.feature, value: f.users }))} color={singleColor(dark)} />
          </div>
        </ChartCard>

        <ChartCard
          title="מתי משתמשים"
          subtitle="פעילות לפי יום ושעה (שעון ישראל)"
          icon={<Clock className="w-4 h-4 text-brand" />}
          table={{ head: ["יום", "שעה", "משתמשים", "אירועים"],
            rows: (heat.data || []).slice().sort((a, b) => a.dow - b.dow || a.hour - b.hour).map(h => [DOW[h.dow], `${h.hour}:00`, h.users, h.events]) }}
        >
          <Heatmap rows={heat.data || []} color={singleColor(dark)} />
        </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-3">
            <Smartphone className="w-4 h-4 text-brand" /> גרסאות אפליקציה בשימוש
          </h3>
          <VersionsTable rows={versions.data || []} />
        </div>
        <div className="card p-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-500" /> איפה משתמשים נתקלים בשגיאות
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">ללא רעש: בקשות שבוטלו ותמונות שלא נטענו מסוננות.</p>
          <ErrorsTable rows={errors.data || []} />
        </div>
      </div>
    </div>
  )
}

function SimpleLegend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
      {items.map(it => (
        <span key={it.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="w-3.5 h-1 rounded-full shrink-0" style={{ background: it.color }} aria-hidden="true" />
          {it.name} <span className="tabular-nums text-slate-400">({it.total} היום)</span>
        </span>
      ))}
    </div>
  )
}

function Heatmap({ rows, color }) {
  const grid = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const r of rows) g[r.dow][r.hour] = Number(r.users) || 0
    return g
  }, [rows])
  const max = Math.max(1, ...grid.flat())
  // Time reads left→right like every other chart here (ChartCard wraps charts in LTR);
  // a fixed-size CSS grid keeps the hour labels on their columns.
  const cols = "1.75rem repeat(24, minmax(0.6rem, 1fr))"
  return (
    <div dir="ltr" className="text-[9px] text-slate-400">
      <div className="grid gap-[2px] mb-[2px]" style={{ gridTemplateColumns: cols }}>
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ""}</span>)}
      </div>
      {grid.map((row, d) => (
        <div key={d} className="grid gap-[2px] mb-[2px]" style={{ gridTemplateColumns: cols }}>
          <span className="text-[10px] text-slate-500 self-center">{DOW[d]}</span>
          {row.map((v, h) => (
            <span key={h} title={`${DOW[d]} ${h}:00 — ${v} משתמשים`}
                  className="aspect-square rounded-[3px] bg-slate-200/70 dark:bg-slate-700/50"
                  style={v ? { background: color, opacity: 0.15 + 0.85 * (v / max) } : undefined} />
          ))}
        </div>
      ))}
      <p className="mt-2 text-[10px]">כהה יותר = יותר משתמשים</p>
    </div>
  )
}

function VersionsTable({ rows }) {
  if (!rows.length) return <p className="text-xs text-slate-400">אין נתונים</p>
  const latest = {}
  for (const r of rows) {
    const code = Number(String(r.version).match(/\((\d+)\)/)?.[1] || 0)
    if (!latest[r.platform] || code > latest[r.platform]) latest[r.platform] = code
  }
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs whitespace-nowrap">
      <thead><tr className="text-slate-500 text-right"><th className="py-1 font-medium">פלטפורמה</th><th className="font-medium">גרסה</th><th className="font-medium">משתמשים</th><th className="font-medium">נראה לאחרונה</th></tr></thead>
      <tbody>
        {rows.map(r => {
          const code = Number(String(r.version).match(/\((\d+)\)/)?.[1] || 0)
          const old = code && code < latest[r.platform]
          return (
            <tr key={r.platform + r.version} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1.5">{PLATFORM[r.platform]?.label || r.platform}</td>
              <td dir="ltr" className={`text-right ${old ? "text-amber-600 dark:text-amber-400" : "font-semibold"}`}>{r.version}{old ? " · ישנה" : ""}</td>
              <td className="tabular-nums">{r.users}</td>
              <td className="text-slate-500">{ago(r.last_seen)}</td>
            </tr>
          )
        })}
      </tbody>
    </table></div>
  )
}

function ErrorsTable({ rows }) {
  if (!rows.length) return <p className="text-xs text-slate-400">אין שגיאות בתקופה 🎉</p>
  return (
    <div className="max-h-72 overflow-y-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-slate-500 text-right"><th className="py-1 font-medium">שגיאה</th><th className="font-medium">איפה</th><th className="font-medium">פעמים</th><th className="font-medium">אנשים</th></tr></thead>
        <tbody>
          {rows.slice(0, 20).map((r, i) => (
            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1.5">{r.name} <span className="text-slate-400">· {PLATFORM[r.platform]?.label || r.platform}</span></td>
              <td dir="ltr" className="text-right text-slate-500 max-w-[10rem] truncate" title={r.path}>{r.path}</td>
              <td className="tabular-nums">{r.events}</td>
              <td className="tabular-nums">{r.users}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ErrorNote({ error }) {
  return (
    <div className="card p-4 text-sm text-red-600 dark:text-red-400">
      שגיאה בטעינת הנתונים: {error?.message === "not_authorized" ? "הלשונית זמינה למנהלים בלבד" : error?.message}
    </div>
  )
}

/* ------------------------------ Users list ------------------------------ */

const COLS = [
  { id: "name", label: "משתמש", get: userName },
  { id: "last_seen", label: "נראה לאחרונה", get: u => u.last_seen ? new Date(u.last_seen).getTime() : 0 },
  { id: "active_days", label: "ימי פעילות", get: u => Number(u.active_days) },
  { id: "screens", label: "מסכים", get: u => Number(u.screens) },
  { id: "interactions", label: "פעולות", get: u => interactions(u) },
  { id: "created_at", label: "נרשם", get: u => new Date(u.created_at).getTime() },
]
const interactions = (u) => ["likes", "comments", "posts", "bets", "availability", "messages"].reduce((s, k) => s + Number(u[k] || 0), 0)

function UsersList({ days, reload, onOpen }) {
  const { loading, data, error } = useRpc("analytics_users", { p_days: days }, [days, reload])
  const [q, setQ] = useState("")
  const [platform, setPlatform] = useState("all")
  const [sort, setSort] = useState({ id: "last_seen", dir: -1 })

  const rows = useMemo(() => {
    let r = data || []
    const needle = q.trim().toLowerCase()
    if (needle) r = r.filter(u => [userName(u), u.display_name, u.email, u.team_name].some(s => s?.toLowerCase().includes(needle)))
    if (platform === "app") r = r.filter(u => u.platforms?.some(p => p === "ios" || p === "android"))
    else if (platform === "web_only") r = r.filter(u => u.platforms?.length && u.platforms.every(p => p === "web"))
    else if (platform === "dormant") r = r.filter(u => !u.last_seen || Date.now() - new Date(u.last_seen).getTime() > 14 * 86400e3)
    const col = COLS.find(c => c.id === sort.id)
    return [...r].sort((a, b) => {
      const av = col.get(a), bv = col.get(b)
      return (typeof av === "string" ? av.localeCompare(bv, "he") : av - bv) * sort.dir
    })
  }, [data, q, platform, sort])

  if (loading && !data) return <SkeletonPanelRows count={8} />
  if (error) return <ErrorNote error={error} />

  const toggleSort = (id) => setSort(s => s.id === id ? { id, dir: -s.dir } : { id, dir: -1 })

  return (
    <div className="card p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, מייל או קבוצה…"
                 className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <SegToggle label="סינון" value={platform} onChange={setPlatform} options={[
          { id: "all", label: "כולם" }, { id: "app", label: "באפליקציה" }, { id: "web_only", label: "רק אתר" }, { id: "dormant", label: "לא פעילים 14+ ימים" },
        ]} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{rows.length} משתמשים · לחיצה על שורה פותחת את כל הפעילות של המשתמש</p>

      <div className="overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full text-sm min-w-[46rem]">
          <thead>
            <tr className="text-right text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              {COLS.map(c => (
                <th key={c.id} className="py-2 px-2 font-medium">
                  <button onClick={() => toggleSort(c.id)} className={`inline-flex items-center gap-1 hover:text-brand ${sort.id === c.id ? "text-brand" : ""}`}>
                    {c.label} <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
              ))}
              <th className="py-2 px-2 font-medium">מכשירים</th>
              <th className="py-2 px-2 font-medium">הכי משתמש ב</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.user_id} onClick={() => onOpen(u)} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar u={u} />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                        {userName(u)} <OgBadge number={u.og_number} size="sm" />
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {u.team_name || (u.player_id ? "" : "לא משויך לשחקן")}
                        {u.roles?.filter(r => r !== "player").map(r => ROLE[r]).filter(Boolean).map(r => ` · ${r}`)}
                        {u.is_admin ? " · מנהל" : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-2 px-2 text-xs whitespace-nowrap">{ago(u.last_seen)}</td>
                <td className="py-2 px-2 tabular-nums">{u.active_days}</td>
                <td className="py-2 px-2 tabular-nums">{u.screens}</td>
                <td className="py-2 px-2 tabular-nums">{interactions(u)}</td>
                <td className="py-2 px-2 text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                <td className="py-2 px-2"><PlatformChips platforms={u.platforms} /></td>
                <td className="py-2 px-2 text-xs">{u.top_feature || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Avatar({ u, size = "w-8 h-8" }) {
  const name = userName(u)
  return u.avatar_url
    ? <img src={u.avatar_url} alt="" className={`${size} rounded-full object-cover shrink-0 bg-slate-100`} />
    : <span className={`${size} rounded-full shrink-0 grid place-items-center bg-brand/10 text-brand text-xs font-bold`}>{name.charAt(0)}</span>
}

/* ------------------------------ User drawer ----------------------------- */

function UserDrawer({ user: u, days, onClose }) {
  const { dark } = useTheme()
  const { loading, data, error } = useRpc("analytics_user_detail", { p_user: u.user_id, p_days: days }, [u.user_id, days])

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [onClose])

  const hours = useMemo(() => {
    const m = Object.fromEntries((data?.hours || []).map(h => [h.hour, h.events]))
    return Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: Number(m[h] || 0) }))
  }, [data])

  return (
    <div className="fixed inset-0 z-[90] flex justify-end" dir="rtl" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full overflow-y-auto bg-slate-50 dark:bg-slate-900 shadow-2xl">
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3">
          <Avatar u={u} size="w-12 h-12" />
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              {userName(u)} <OgBadge number={u.og_number} size="sm" />
            </h3>
            <p className="text-xs text-slate-500 truncate" dir="ltr" style={{ textAlign: "right" }}>{u.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {u.team_name ? `${u.team_name} · ` : ""}
              {[...(u.is_admin ? ["מנהל"] : []), ...(u.roles || []).map(r => ROLE[r]).filter(Boolean)].join(" · ") || "ללא תפקיד"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="סגור"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Mini label="נרשם" value={fmtDate(u.created_at)} />
            <Mini label="נראה לאחרונה" value={ago(u.last_seen)} />
            <Mini label={`ימי פעילות (${days} ימים)`} value={u.active_days} />
            <Mini label="התראות" value={u.push_enabled ? "מופעלות" : "כבויות"} />
            <Mini label="לייקים" value={u.likes} />
            <Mini label="תגובות ופוסטים" value={Number(u.comments) + Number(u.posts)} />
            <Mini label="אישורי הגעה" value={u.availability} />
            <Mini label="תחזיות" value={u.bets} />
          </div>

          <div className="card p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-2"><span className="text-slate-500 w-20 shrink-0">מכשירים</span><PlatformChips platforms={u.platforms} /></div>
            {u.app_versions && (
              <div className="flex items-center gap-2"><span className="text-slate-500 w-20 shrink-0">גרסאות</span>
                <span dir="ltr">{Object.entries(u.app_versions).map(([p, v]) => `${PLATFORM[p]?.label || p} ${v}`).join(" · ")}</span></div>
            )}
            {data?.notifications && (
              <div className="flex items-center gap-2"><span className="text-slate-500 w-20 shrink-0">התראות</span>
                <span>קיבל {data.notifications.received}, קרא {data.notifications.read}</span></div>
            )}
            {u.player_id && (
              <div className="flex items-center gap-2"><span className="text-slate-500 w-20 shrink-0">כרטיס שחקן</span>
                <Link to={`/players/${u.player_id}`} className="text-brand hover:underline">{u.player_name}</Link></div>
            )}
          </div>

          {loading && !data ? <SkeletonPanelRows count={5} /> : error ? <ErrorNote error={error} /> : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="card p-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">במה משתמש</h4>
                  <RankBar data={(data.features || []).map(f => ({ id: f.feature, name: f.feature, value: f.events }))} color={singleColor(dark)} />
                </div>
                <div className="card p-3">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">שעות פעילות</h4>
                  <div dir="ltr"><BarChart data={hours} unit="אירועים" color={singleColor(dark)} /></div>
                </div>
              </div>

              <div className="card p-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">מסכים שנצפו</h4>
                {data.screens?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.screens.map(s => (
                      <span key={s.path + s.platform} className="text-[11px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        <span dir="ltr">{s.path}</span> · {PLATFORM[s.platform]?.label} · <b className="tabular-nums">{s.views}</b>
                      </span>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-400">אין צפיות במסכים בתקופה (אפליקציות ישנות לא מדווחות על מסכים).</p>}
              </div>

              <div className="card p-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">סשנים אחרונים</h4>
                {data.sessions?.length ? (
                  <div className="overflow-x-auto"><table className="w-full text-xs whitespace-nowrap">
                    <thead><tr className="text-right text-slate-500"><th className="py-1 font-medium">התחלה</th><th className="font-medium">משך</th><th className="font-medium">פלטפורמה</th><th className="font-medium">מסכים</th></tr></thead>
                    <tbody>
                      {data.sessions.slice(0, 15).map(s => {
                        const mins = Math.round((new Date(s.end) - new Date(s.start)) / 60000)
                        return (
                          <tr key={s.session_id} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="py-1.5">{fmtDateTime(s.start)}</td>
                            <td>{mins < 1 ? "פחות מדקה" : `${mins} דק׳`}</td>
                            <td>{PLATFORM[s.platform]?.label} <span dir="ltr" className="text-slate-400">{s.version?.startsWith("index-") ? "" : s.version}</span></td>
                            <td className="tabular-nums">{s.screens}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table></div>
                ) : <p className="text-xs text-slate-400">אין סשנים מדווחים בתקופה.</p>}
              </div>

              <div className="card p-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">ציר זמן — כל מה שעשה</h4>
                <Timeline items={data.timeline || []} />
              </div>

              <div className="card p-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">מכשירים מחוברים</h4>
                <ul className="space-y-1.5 text-xs">
                  {(data.devices || []).map((d, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0"><PlatformChips platforms={[d.platform]} />
                        <span dir="ltr" className="text-slate-400 truncate" title={d.user_agent}>{d.user_agent}</span></span>
                      <span className="text-slate-500 shrink-0">{ago(d.last_seen)}</span>
                    </li>
                  ))}
                  {!data.devices?.length && <li className="text-slate-400">אין סשן פעיל</li>}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div className="card p-2.5">
      <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums">{value ?? 0}</div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  )
}

function Timeline({ items }) {
  const [showAll, setShowAll] = useState(false)
  if (!items.length) return <p className="text-xs text-slate-400">אין פעילות בתקופה.</p>
  // Consecutive identical rows (same kind + path) fold into one with a count.
  const folded = []
  for (const it of items) {
    const last = folded[folded.length - 1]
    if (last && last.kind === it.kind && last.path === it.path && last.detail === it.detail && last.platform === it.platform) last.n++
    else folded.push({ ...it, n: 1 })
  }
  const shown = showAll ? folded : folded.slice(0, 40)
  return (
    <>
      <ol className="space-y-1">
        {shown.map((it, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 w-20 shrink-0 tabular-nums">{fmtDateTime(it.at)}</span>
            <span className={`shrink-0 px-1.5 py-0.5 rounded font-semibold ${it.kind === "error" ? "bg-red-500/10 text-red-600" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
              {KIND[it.kind] || it.kind}
            </span>
            <span className="truncate text-slate-600 dark:text-slate-300">
              {it.feature || ""}{it.path ? <span dir="ltr" className="text-slate-400"> {it.path}</span> : null}
              {it.kind === "action" || it.kind === "error" ? <span dir="ltr" className="text-slate-400"> {it.detail}</span> : null}
              {it.kind === "availability" && it.detail ? ` · ${it.detail}` : ""}
            </span>
            {it.platform && <span className="text-slate-400 shrink-0">{PLATFORM[it.platform]?.label}</span>}
            {it.n > 1 && <span className="text-slate-400 shrink-0">×{it.n}</span>}
          </li>
        ))}
      </ol>
      {folded.length > 40 && (
        <button onClick={() => setShowAll(s => !s)} className="mt-2 text-xs font-semibold text-brand">
          {showAll ? "הצג פחות" : `הצג הכל (${folded.length})`}
        </button>
      )}
    </>
  )
}

/* ------------------------------ Funnel + retention ---------------------- */

function Growth({ reload }) {
  const { dark } = useTheme()
  const funnel = useRpc("analytics_funnel", {}, [reload])
  const retention = useRpc("analytics_retention", {}, [reload])

  if ((funnel.loading && !funnel.data) || (retention.loading && !retention.data)) return <SkeletonPanelRows count={6} />
  if (funnel.error) return <ErrorNote error={funnel.error} />

  const steps = funnel.data || []
  const top = Number(steps[0]?.users) || 1
  const cohorts = {}
  for (const r of retention.data || []) {
    (cohorts[r.cohort] ||= { cohort: r.cohort, size: Number(r.size), weeks: {} }).weeks[r.week] = Number(r.active)
  }
  const cohortRows = Object.values(cohorts).sort((a, b) => b.cohort.localeCompare(a.cohort))

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-1">
          <FunnelIcon className="w-4 h-4 text-brand" /> משפך הצטרפות
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">כל החשבונות מאז ההשקה. כל שלב מראה כמה הגיעו אליו — הירידה הגדולה היא המקום לשפר.</p>
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const pct = Math.round((Number(s.users) / top) * 100)
            const prev = i ? Number(steps[i - 1].users) : null
            const drop = prev ? Math.round((1 - Number(s.users) / prev) * 100) : null
            return (
              <li key={s.step}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{s.label}</span>
                  <span className="tabular-nums text-slate-500">
                    {s.users} · {pct}%{drop != null && drop > 0 && s.step <= 5 ? <span className="text-red-500"> (−{drop}%)</span> : null}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: singleColor(dark) }} />
                </div>
              </li>
            )
          })}
        </ol>
        <p className="text-[11px] text-slate-400 mt-3">שלבים 6–7 (אפליקציה, התראות) אינם המשך ישיר של שלב 5 — הם נמדדים מתוך כל הנרשמים.</p>
      </div>

      <div className="card p-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2 mb-1">
          <Repeat className="w-4 h-4 text-brand" /> שימור לפי שבוע הרשמה
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">מי שנרשם בשבוע מסוים — כמה מהם חזרו בכל שבוע אחרי.</p>
        {cohortRows.length ? (
          <div className="overflow-x-auto">
            <table className="text-xs border-separate" style={{ borderSpacing: 3 }}>
              <thead>
                <tr className="text-slate-500">
                  <th className="text-right font-medium pl-2">שבוע הרשמה</th>
                  <th className="font-medium">נרשמו</th>
                  {Array.from({ length: 9 }, (_, w) => <th key={w} className="font-medium w-11">{w === 0 ? "שבוע 0" : `+${w}`}</th>)}
                </tr>
              </thead>
              <tbody>
                {cohortRows.map(c => (
                  <tr key={c.cohort}>
                    <td className="pl-2 whitespace-nowrap">{fmtDate(c.cohort)}</td>
                    <td className="text-center tabular-nums">{c.size}</td>
                    {Array.from({ length: 9 }, (_, w) => {
                      const v = c.weeks[w]
                      if (v === undefined) return <td key={w} />
                      const pct = c.size ? Math.round((v / c.size) * 100) : 0
                      return (
                        <td key={w} title={`${v} מתוך ${c.size}`} className="text-center rounded-md py-1.5 tabular-nums font-semibold"
                            style={{ background: `color-mix(in srgb, ${singleColor(dark)} ${Math.max(6, pct)}%, transparent)`, color: pct > 55 ? "#fff" : undefined }}>
                          {pct}%
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-slate-400">אין הרשמות ב־12 השבועות האחרונים.</p>}
      </div>

      <div className="card p-4 text-xs text-slate-500 dark:text-slate-400 flex gap-2">
        <Bell className="w-4 h-4 shrink-0 text-slate-400" />
        <span>
          צפיות במסכים באפליקציות נאספות רק מגרסאות iPhone ו־Android הבאות. עד אז משתמשי אפליקציה נספרים לפי כניסות ופעולות (לייקים, אישורי הגעה, תחזיות…).
          היסטוריית מסכים נשמרת 90 יום.
        </span>
      </div>
    </div>
  )
}
