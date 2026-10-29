import { useEffect, useMemo, useState } from "react"
import { RefreshCw, Search, Smartphone, Send, Eye, X, MonitorSmartphone } from "lucide-react"
import { Bell, Bell as BellRing, Squad as Users, Warning as AlertTriangle, Checklist as ListChecks, BrandIcon } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { notificationText, notificationIcon, notificationBrandIcon } from "@/lib/notifications"
import { getNotificationLog, getPushDevices, outcomeOf, deviceLabel } from "@/lib/notificationTracker"
import ReadinessAdmin from "@/components/admin/ReadinessAdmin"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * התראות — the notification tracker. Three views:
 *   מעקב    — every notification the app sent in a window: to whom, when, which devices
 *             it reached (push_deliveries, written by send-push) and whether it was read.
 *   מכשירים — every registered push device and how its sends went.
 *   מוכנות  — the existing readiness chase-list (ReadinessAdmin), unchanged.
 *
 * The first two are admin-only (the RPCs refuse anyone else); a coach or league
 * manager who reaches this tab sees only מוכנות, which is what the old tab showed them.
 *
 * Device rows exist only from 2026-10-14 on — older notifications show "לפני המעקב",
 * which means "we don't know", not "failed".
 */

const RANGES = [
  { id: "1", label: "24 שעות", days: 1 },
  { id: "7", label: "7 ימים", days: 7 },
  { id: "30", label: "30 ימים", days: 30 },
]

// Plain-language names for the notification types, for the breakdown and the filter.
// A type missing here falls back to its key, which is still searchable.
const TYPE_LABEL = {
  announcement: "הודעת מנהל", app_update: "עדכון אפליקציה",
  post_like: "לייק לפוסט", post_comment: "תגובה לפוסט", tagged: "תיוג",
  claim_request: "בקשת שיוך לשחקן", claim_approved: "שיוך אושר", claim_rejected: "שיוך נדחה",
  role_granted: "קבלת תפקיד", content_report: "דיווח תוכן",
  game_result: "תוצאת משחק", goal_scored: "גול", game_moved: "שינוי במשחק", game_postponed: "משחק נדחה",
  follow_game_alert: "משחק במעקב מחר",
  follow_game_today: "משחק במעקב היום",
  game_register_reminder: "תזכורת הגעה", game_register_nudge: "תזכורת הגעה חוזרת",
  game_form_sign: "חתימה על טופס", coach_squad_digest: "סיכום סגל למאמן",
  lm_squad_digest: "סיכום סגלים למנהל", lm_officials_digest: "סיכום שופטים למנהל",
  lm_broadcast: "הודעת מנהל ליגה",
  game_change_request: "בקשת שינוי משחק", game_change_approved: "שינוי משחק אושר",
  game_change_rejected: "שינוי משחק נדחה", game_change_opponent: "בקשת שינוי מהיריבה",
  team_join_request: "בקשת הצטרפות", team_join_approved: "הצטרפות אושרה", team_join_rejected: "הצטרפות נדחתה",
  player_submission_request: "כרטיס שחקן חדש", player_submission_approved: "כרטיס שחקן אושר",
  player_submission_rejected: "כרטיס שחקן נדחה",
  medical_submitted: "אישור רפואי הוגש", medical_pending_manager: "רפואי ממתין למנהל",
  medical_coach_approved: "רפואי אושר ע״י מאמן", medical_approved: "רפואי אושר",
  medical_rejected: "רפואי נדחה", medical_revoked: "רפואי בוטל", medical_reinspection: "רפואי לבדיקה חוזרת",
  medical_expiring: "רפואי עומד לפוג", medical_expiring_player: "רפואי של שחקן עומד לפוג",
  medical_date_changed: "תאריך רפואי עודכן",
  coach_open_items: "תזכורת פריטים פתוחים", coach_request: "בקשת אימון", coach_request_rejected: "בקשת אימון נדחתה",
  official_role_request: "בקשת שיפוט/מזכירות", official_role_approved: "שיפוט/מזכירות אושר",
  official_role_rejected: "שיפוט/מזכירות נדחה", card_unlink_request: "בקשת ניתוק מכרטיס",
  card_unlink_approved: "ניתוק מכרטיס אושר", card_unlink_rejected: "ניתוק מכרטיס נדחה",
  official_assigned: "שיבוץ שופט/חובש", official_application: "מועמדות שופט/חובש",
  official_application_approved: "מועמדות אושרה", official_application_rejected: "מועמדות נדחתה",
  unavailability_reported: "דיווח היעדרות", unavailability_approved: "היעדרות אושרה",
  unavailability_rejected: "היעדרות נדחתה",
  loan_call: "קריאה להשאלה", loan_request: "הזמנה להשאלה", loan_join_request: "בקשה להשאלה",
  loan_join_approved: "השאלה אושרה", loan_join_declined: "השאלה נדחתה", loan_accepted: "השאלה התקבלה",
  loan_declined: "השאלה סורבה", loan_cancelled: "השאלה בוטלה", loan_removed: "הוסר מהסגל",
  tournament_invite: "הזמנה לטורניר", tournament_invite_accepted: "טורניר אושר",
  tournament_invite_declined: "טורניר נדחה",
  market_resolved: "שוק הוכרע", market_coins: "מטבעות מרקט",
}
const typeLabel = (t) => TYPE_LABEL[t] || t

const OUTCOME = {
  delivered: { label: "נמסר למכשיר", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500" },
  failed:    { label: "נכשל", cls: "bg-red-500/10 text-red-700 dark:text-red-400", bar: "bg-red-500" },
  no_device: { label: "בפעמון בלבד", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400", bar: "bg-amber-400" },
  skipped:   { label: "לא נשלח בפוש", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", bar: "bg-slate-400" },
  untracked: { label: "לפני המעקב", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", bar: "bg-slate-300 dark:bg-slate-600" },
}

const DELIVERY_TONE = {
  sent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  pruned: "bg-red-500/10 text-red-700 dark:text-red-400",
  emailed: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  skipped: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  no_device: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
}
const DELIVERY_MARK = { sent: "✓", failed: "✗", pruned: "✗ הוסר", emailed: "✓", skipped: "—", no_device: "" }
const PLATFORM_ICON = { ios: "📱", android: "🤖", web: "🌐", email: "✉️", none: "🔕" }

const PLATFORMS = [
  { id: "ios", label: "iPhone" },
  { id: "android", label: "Android" },
  { id: "web", label: "דפדפן" },
]

const recipientOf = (n) => n.recipient_name || n.recipient_email || "משתמש ללא שם"

function Stat({ icon: Icon, label, value, sub, tone = "brand" }) {
  const tones = {
    brand: "text-brand bg-brand/10",
    green: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    amber: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    red: "text-red-600 dark:text-red-400 bg-red-500/10",
  }
  return (
    <div className="card p-3.5 flex items-center gap-3 min-w-0">
      <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${tones[tone]}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">{value}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
        {sub && <div className="text-[10.5px] text-slate-400 dark:text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  )
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

export default function NotificationsAdmin({ isAdmin }) {
  const [view, setView] = useState(isAdmin ? "log" : "readiness")
  if (!isAdmin) return <ReadinessAdmin />

  const VIEWS = [
    { id: "log", label: "מעקב שליחה", icon: ListChecks },
    { id: "devices", label: "מכשירים", icon: MonitorSmartphone },
    { id: "readiness", label: "מוכנות", icon: BellRing },
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/70 w-fit max-w-full overflow-x-auto">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              view === v.id ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}>
            <v.icon className="w-3.5 h-3.5" /> {v.label}
          </button>
        ))}
      </div>
      {view === "log" && <NotificationLog />}
      {view === "devices" && <DevicesView />}
      {view === "readiness" && <ReadinessAdmin />}
    </div>
  )
}

// ---- מעקב שליחה ---------------------------------------------------------------

function NotificationLog() {
  const [range, setRange] = useState("7")
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState("")
  const [type, setType] = useState("")
  const [platform, setPlatform] = useState("")
  const [outcome, setOutcome] = useState("")
  const [recipient, setRecipient] = useState(null)   // { id, name } — click a name to focus on one person
  const [limit, setLimit] = useState(100)

  const load = async () => {
    setRows(null); setError(null)
    const days = RANGES.find(r => r.id === range).days
    try { setRows(await getNotificationLog(new Date(Date.now() - days * 86400000))) }
    catch { setError("שגיאה בטעינת ההתראות"); setRows([]) }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range])
  useEffect(() => { setLimit(100) }, [range, q, type, platform, outcome, recipient])

  const decorated = useMemo(() => (rows || []).map(n => ({
    ...n,
    outcome: outcomeOf(n),
    text: notificationText({ ...n, actor: n.actor_name ? { display_name: n.actor_name } : null }),
  })), [rows])

  const stats = useMemo(() => {
    const tracked = decorated.filter(n => n.outcome !== "untracked")
    const deliveries = decorated.flatMap(n => n.deliveries || [])
    const byPlatform = {}
    for (const d of deliveries) {
      if (!["ios", "android", "web"].includes(d.platform)) continue
      const p = (byPlatform[d.platform] ||= { sent: 0, failed: 0 })
      if (d.status === "sent") p.sent++
      else if (d.status === "failed" || d.status === "pruned") p.failed++
    }
    return {
      total: decorated.length,
      recipients: new Set(decorated.map(n => n.user_id)).size,
      tracked: tracked.length,
      delivered: tracked.filter(n => n.outcome === "delivered").length,
      bellOnly: tracked.filter(n => n.outcome === "no_device").length,
      failed: tracked.filter(n => n.outcome === "failed").length,
      read: decorated.filter(n => n.read_at).length,
      byPlatform,
    }
  }, [decorated])

  // Per-day volume, split by outcome — the "when" at a glance.
  const days = useMemo(() => {
    const n = RANGES.find(r => r.id === range).days
    if (n === 1) {
      // 24h → hourly buckets
      const buckets = Array.from({ length: 24 }, (_, i) => {
        const t = new Date(Date.now() - (23 - i) * 3600000)
        return { key: format(t, "yyyy-MM-dd HH"), label: format(t, "HH"), counts: {} }
      })
      const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]))
      for (const r of decorated) {
        const i = idx[format(new Date(r.created_at), "yyyy-MM-dd HH")]
        if (i != null) buckets[i].counts[r.outcome] = (buckets[i].counts[r.outcome] || 0) + 1
      }
      return buckets
    }
    const buckets = Array.from({ length: n }, (_, i) => {
      const t = new Date(Date.now() - (n - 1 - i) * 86400000)
      return { key: format(t, "yyyy-MM-dd"), label: format(t, "d/M"), counts: {} }
    })
    const idx = Object.fromEntries(buckets.map((b, i) => [b.key, i]))
    for (const r of decorated) {
      const i = idx[format(new Date(r.created_at), "yyyy-MM-dd")]
      if (i != null) buckets[i].counts[r.outcome] = (buckets[i].counts[r.outcome] || 0) + 1
    }
    return buckets
  }, [decorated, range])
  const maxDay = Math.max(1, ...days.map(d => Object.values(d.counts).reduce((a, b) => a + b, 0)))

  const byType = useMemo(() => {
    const m = new Map()
    for (const n of decorated) {
      const t = m.get(n.type) || { type: n.type, icon: notificationBrandIcon(n), count: 0, users: new Set(), delivered: 0, tracked: 0, read: 0 }
      t.count++; t.users.add(n.user_id)
      if (n.outcome !== "untracked") t.tracked++
      if (n.outcome === "delivered") t.delivered++
      if (n.read_at) t.read++
      m.set(n.type, t)
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [decorated])

  const shown = decorated.filter(n => {
    if (recipient && n.user_id !== recipient.id) return false
    if (type && n.type !== type) return false
    if (outcome && n.outcome !== outcome) return false
    if (platform && !(n.deliveries || []).some(d => d.platform === platform)) return false
    if (q.trim()) {
      const hay = `${recipientOf(n)} ${n.recipient_email || ""} ${n.text} ${typeLabel(n.type)}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  })

  const select = "bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <Bell className="w-5 h-5 text-brand" /> מעקב התראות
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${range === r.id ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={load} aria-label="רענון" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {rows === null ? <SkeletonPanelRows /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Stat icon={Send} label="התראות נשלחו" value={stats.total} sub={`ל-${stats.recipients} משתמשים`} />
            <Stat icon={Smartphone} tone="green" label="הגיעו לטלפון / דפדפן" value={`${pct(stats.delivered, stats.tracked)}%`}
              sub={stats.tracked ? `${stats.delivered} מתוך ${stats.tracked} במעקב` : "אין עדיין נתוני מעקב"} />
            <Stat icon={Bell} tone="amber" label="בפעמון בלבד (אין מכשיר)" value={stats.bellOnly}
              sub={stats.failed ? `${stats.failed} נכשלו בכל המכשירים` : null} />
            <Stat icon={Eye} label="נקראו" value={`${pct(stats.read, stats.total)}%`} sub={`${stats.read} מתוך ${stats.total}`} />
          </div>

          {/* Volume over time */}
          <div className="card p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">מתי נשלחו</h3>
              <div className="flex items-center gap-3 flex-wrap">
                {["delivered", "no_device", "failed", "untracked"].map(k => (
                  <span key={k} className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className={`w-2.5 h-2.5 rounded-sm ${OUTCOME[k].bar}`} /> {OUTCOME[k].label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-[3px] h-32" dir="ltr">
              {days.map(d => {
                const total = Object.values(d.counts).reduce((a, b) => a + b, 0)
                return (
                  <div key={d.key} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative"
                    title={`${d.label}: ${total}`}>
                    <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${(total / maxDay) * 100}%` }}>
                      {["delivered", "no_device", "skipped", "failed", "untracked"].map(k => d.counts[k] ? (
                        <div key={k} className={OUTCOME[k].bar} style={{ height: `${(d.counts[k] / total) * 100}%` }} />
                      ) : null)}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-[3px] mt-1" dir="ltr">
              {days.map((d, i) => (
                <div key={d.key} className="flex-1 min-w-0 text-center text-[9.5px] text-slate-400 tabular-nums truncate">
                  {(days.length <= 10 || i % Math.ceil(days.length / 10) === 0) ? d.label : ""}
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
            {/* What — by type */}
            <div className="card overflow-hidden">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 px-4 pt-3.5 pb-2">מה נשלח</h3>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <tr className="text-[11px] text-slate-500 dark:text-slate-400">
                      <th className="text-right font-bold px-4 py-2">סוג</th>
                      <th className="text-right font-bold px-2 py-2">כמות</th>
                      <th className="text-right font-bold px-2 py-2">נמענים</th>
                      <th className="text-right font-bold px-2 py-2">הגיעו</th>
                      <th className="text-right font-bold px-2 py-2">נקראו</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {byType.map(t => (
                      <tr key={t.type} onClick={() => setType(type === t.type ? "" : t.type)}
                        className={`cursor-pointer transition-colors ${type === t.type ? "bg-brand/5" : "hover:bg-slate-50/70 dark:hover:bg-slate-800/40"}`}>
                        <td className="px-4 py-2 text-slate-800 dark:text-slate-100 whitespace-nowrap">
                          <BrandIcon name={t.icon} className="w-4 h-4 ml-1.5 inline-block align-[-3px]" />{typeLabel(t.type)}
                        </td>
                        <td className="px-2 py-2 tabular-nums font-semibold">{t.count}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-500">{t.users.size}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-500">{t.tracked ? `${pct(t.delivered, t.tracked)}%` : "—"}</td>
                        <td className="px-2 py-2 tabular-nums text-slate-500">{pct(t.read, t.count)}%</td>
                      </tr>
                    ))}
                    {!byType.length && <tr><td colSpan={5} className="text-center text-slate-400 py-6">אין התראות בטווח</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Where — by device */}
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">לאיזה מכשיר</h3>
              {PLATFORMS.map(p => {
                const s = stats.byPlatform[p.id] || { sent: 0, failed: 0 }
                const tot = s.sent + s.failed
                return (
                  <button key={p.id} onClick={() => setPlatform(platform === p.id ? "" : p.id)}
                    className={`w-full text-right rounded-xl p-2.5 transition-colors ${platform === p.id ? "bg-brand/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{PLATFORM_ICON[p.id]} {p.label}</span>
                      <span className="tabular-nums text-slate-500">{s.sent} נשלחו{s.failed ? ` · ${s.failed} נכשלו` : ""}</span>
                    </div>
                    <div className="h-1.5 mt-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex" dir="ltr">
                      <div className="bg-emerald-500" style={{ width: `${pct(s.sent, tot)}%` }} />
                      <div className="bg-red-500" style={{ width: `${pct(s.failed, tot)}%` }} />
                    </div>
                  </button>
                )
              })}
              {!stats.tracked && (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  מעקב המכשירים התחיל ב-14.10.2026 — התראות קודמות מופיעות כ״לפני המעקב״.
                </p>
              )}
            </div>
          </div>

          {/* Who + when — the log */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי נמען או תוכן" aria-label="חיפוש לפי נמען או תוכן"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <select value={type} onChange={e => setType(e.target.value)} aria-label="סוג התראה" className={select}>
                <option value="">כל הסוגים</option>
                {byType.map(t => <option key={t.type} value={t.type}>{typeLabel(t.type)}</option>)}
              </select>
              <select value={platform} onChange={e => setPlatform(e.target.value)} aria-label="מכשיר" className={select}>
                <option value="">כל המכשירים</option>
                {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select value={outcome} onChange={e => setOutcome(e.target.value)} aria-label="מצב" className={select}>
                <option value="">כל המצבים</option>
                {Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>

            {recipient && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">מציג רק את:</span>
                <button onClick={() => setRecipient(null)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand/10 text-brand font-semibold">
                  {recipient.name} <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <p className="text-[11px] text-slate-400 tabular-nums">{shown.length} התראות</p>

            {shown.length === 0 ? (
              <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">אין התראות תואמות</p>
            ) : (
              <div className="card divide-y divide-slate-100 dark:divide-slate-700/50 overflow-hidden">
                {shown.slice(0, limit).map(n => <LogRow key={n.id} n={n} onRecipient={setRecipient} />)}
              </div>
            )}
            {shown.length > limit && (
              <button onClick={() => setLimit(l => l + 200)}
                className="w-full text-xs font-semibold py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
                הצגת עוד ({shown.length - limit})
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LogRow({ n, onRecipient }) {
  const o = OUTCOME[n.outcome]
  const devices = (n.deliveries || []).filter(d => d.platform !== "none")
  const noDevice = (n.deliveries || []).find(d => d.platform === "none")
  return (
    <div className="px-4 py-3 flex gap-3 items-start">
      <BrandIcon name={notificationBrandIcon(n)} className="w-5 h-5 mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs">
          <button onClick={() => onRecipient({ id: n.user_id, name: recipientOf(n) })}
            className="font-bold text-slate-900 dark:text-white hover:text-brand truncate max-w-[220px]" title={n.recipient_email || ""}>
            {recipientOf(n)}
          </button>
          <span className="text-slate-400">·</span>
          <span className="text-slate-500 dark:text-slate-400">{typeLabel(n.type)}</span>
          <span className="text-slate-400 tabular-nums mr-auto" dir="ltr">{format(new Date(n.created_at), "dd/MM HH:mm")}</span>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-200 leading-snug break-words">{n.text}</p>
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${o.cls}`}>{o.label}</span>
          {devices.map((d, i) => (
            <span key={i} title={d.detail || ""}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${DELIVERY_TONE[d.status] || DELIVERY_TONE.skipped}`}>
              {PLATFORM_ICON[d.platform]} {deviceLabel(d)} {DELIVERY_MARK[d.status]}
            </span>
          ))}
          {noDevice?.status === "skipped" && noDevice.detail === "market" && (
            <span className="text-[11px] text-slate-400">משחק מרקט — פעמון בלבד</span>
          )}
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${n.read_at ? "text-slate-500 dark:text-slate-400" : "text-slate-400 dark:text-slate-500"}`}>
            <Eye className="w-3 h-3" />
            {n.read_at ? <>נקרא <span dir="ltr" className="tabular-nums">{format(new Date(n.read_at), "dd/MM HH:mm")}</span></> : "לא נקרא"}
          </span>
        </div>
      </div>
    </div>
  )
}

// ---- מכשירים -------------------------------------------------------------------

function DevicesView() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [platform, setPlatform] = useState("")
  const [q, setQ] = useState("")

  const load = async () => {
    setRows(null); setError(null)
    try { setRows(await getPushDevices(new Date(Date.now() - 30 * 86400000))) }
    catch { setError("שגיאה בטעינת המכשירים"); setRows([]) }
  }
  useEffect(() => { load() }, [])

  const all = rows || []
  const counts = {
    users: new Set(all.map(r => r.user_id)).size,
    ios: all.filter(r => r.platform === "ios").length,
    android: all.filter(r => r.platform === "android").length,
    web: all.filter(r => r.platform === "web").length,
    failing: all.filter(r => r.failed > 0 && r.sent === 0).length,
  }
  const shown = all.filter(r => {
    if (platform && r.platform !== platform) return false
    if (q.trim()) {
      const hay = `${r.recipient_name || ""} ${r.recipient_email || ""} ${deviceLabel(r)}`.toLowerCase()
      if (!hay.includes(q.trim().toLowerCase())) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <MonitorSmartphone className="w-5 h-5 text-brand" /> מכשירים רשומים להתראות
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>
      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {rows === null ? <SkeletonPanelRows /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Stat icon={Users} label="משתמשים עם מכשיר" value={counts.users} sub={`${all.length} מכשירים`} />
            <Stat icon={Smartphone} label="iPhone" value={counts.ios} />
            <Stat icon={Smartphone} tone="green" label="Android" value={counts.android} sub={`${counts.web} דפדפנים`} />
            <Stat icon={AlertTriangle} tone={counts.failing ? "red" : "brand"} label="נכשלים בלבד (30 יום)" value={counts.failing} />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {[{ id: "", label: "הכל" }, ...PLATFORMS].map(p => (
              <button key={p.id} onClick={() => setPlatform(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${platform === p.id ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
                {p.label}
              </button>
            ))}
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש משתמש" aria-label="חיפוש משתמש"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-500 dark:text-slate-400">
                    <th className="text-right font-bold px-4 py-2.5">משתמש</th>
                    <th className="text-right font-bold px-3 py-2.5">מכשיר</th>
                    <th className="text-right font-bold px-3 py-2.5">נרשם</th>
                    <th className="text-right font-bold px-3 py-2.5">נראה לאחרונה</th>
                    <th className="text-right font-bold px-3 py-2.5">נשלחו (30 יום)</th>
                    <th className="text-right font-bold px-3 py-2.5">התראה אחרונה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {shown.map(r => (
                    <tr key={r.subscription_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-white">{r.recipient_name || "ללא שם"}</div>
                        {r.recipient_email && <div className="text-[11px] text-slate-400" dir="ltr">{r.recipient_email}</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-700 dark:text-slate-200">
                        {PLATFORM_ICON[r.platform]} {deviceLabel(r)}
                        {r.environment === "sandbox" && <span className="mr-1 text-[10px] text-amber-600">(sandbox)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap" dir="ltr">{format(new Date(r.created_at), "dd/MM/yy")}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap" dir="ltr">{r.last_seen_at ? format(new Date(r.last_seen_at), "dd/MM/yy") : "—"}</td>
                      <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap">
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{r.sent}</span>
                        {r.failed > 0 && <span className="text-red-600 dark:text-red-400 font-semibold"> · {r.failed} נכשלו</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap" dir="ltr">{r.last_sent_at ? format(new Date(r.last_sent_at), "dd/MM HH:mm") : "—"}</td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={6} className="text-center text-slate-400 py-8 text-sm">אין מכשירים תואמים</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            מכשיר שהאפליקציה הוסרה ממנו או שההרשאה בוטלה נמחק אוטומטית בניסיון השליחה הבא — הוא יופיע במעקב השליחה כ״✗ הוסר״.
          </p>
        </>
      )}
    </div>
  )
}
